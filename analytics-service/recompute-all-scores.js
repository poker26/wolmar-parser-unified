#!/usr/bin/env node
// Батч-пересчёт всех fraud-сигналов и suspicious_score для ВСЕХ пользователей.
// Зачем: скоринг "ленивый" (pull-to-compute) — поля *_score пишутся только когда
// в UI открывают соответствующую вкладку, и только для пользователей, которых
// сигнал флагует прямо сейчас. Из-за этого у ранее отмеченных, но «исправившихся»
// пользователей оставались устаревшие баллы (см. wolmar_analytics_signals.md).
// Скрипт делает полный проход: (0) обнуляет все 10 сигнальных колонок (триггер
// update_suspicious_score пересчитывает suspicious_score=0), затем (1) последовательно
// дёргает каждый сигнальный эндпоинт на localhost:3002 — каждый пишет свежие баллы
// только реально флагнутым юзерам. Итог = честный full recompute без ручных кликов.
// Запуск по cron в непиковое время (во время прохода баллы временно занижены).
//
// Использование:
//   node recompute-all-scores.js            # полный проход (с обнулением)
//   node recompute-all-scores.js --no-reset # только дёрнуть эндпоинты, без обнуления

const http = require('http');
try { require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') }); } catch (_) {}
const { Pool } = require('pg');

const PORT = process.env.ANALYTICS_PORT || 3002;
const HOST = '127.0.0.1';
const REQ_TIMEOUT_MS = 300000; // 5 мин на тяжёлый эндпоинт (linked/carousel)
const RESET = !process.argv.includes('--no-reset');

const pool = new Pool({
    user: process.env.DB_USER || 'postgres.your-tenant-id',
    host: process.env.DB_HOST || 'sup.begemot26.ru',
    database: process.env.DB_NAME || 'postgres',
    password: process.env.DB_PASSWORD || process.env.POSTGRES_PASSWORD,
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    ssl: false,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    max: 4,
    allowExitOnIdle: true
});

const SIGNAL_COLUMNS = [
    'fast_bids_score', 'autobid_traps_score', 'linked_accounts_score', 'carousel_score',
    'self_boost_score', 'decoy_tactics_score', 'pricing_strategies_score',
    'circular_buyers_score', 'abandonment_score', 'technical_bidders_score'
];

// ВАЖНО про порядок и про fast_bids:
//  • /fast-manual-bids НЕ считает с нуля — он early-return'ит, если ни у кого нет
//    fast_bids_score>0, и лишь «дорефинивает» уже засеянных. Поэтому после обнуления
//    его нельзя использовать для восстановления — fast_bids засеваем SQL'ом ниже
//    (seedFastBids, алгоритм из wolmar-analytics-clean: интервалы ручных ставок).
//  • /autobid-traps зависит от fast_bids_score>0 (берёт «накрутчиков» по нему),
//    поэтому ОБЯЗАН идти ПОСЛЕ seedFastBids. Он стоит первым в списке ниже.
// Остальные 8 сигналов считаются с нуля независимо — порядок между ними не важен.
const ENDPOINTS = [
    '/api/analytics/autobid-traps',
    '/api/analytics/circular-buyers',
    '/api/analytics/linked-accounts',
    '/api/analytics/carousel-analysis',
    '/api/analytics/abandonment-analysis',
    '/api/analytics/pricing-strategies',
    '/api/analytics/self-boost',
    '/api/analytics/technical-bidders',
    '/api/analytics/decoy-tactics',
];

// Засев fast_bids_score с нуля (канонический алгоритм из wolmar-analytics-clean):
// лоты с >3 ручными ставками → интервалы между подряд идущими ручными ставками →
// per-bidder: <1с (critical) ⇒ 50, >5 ставок <5с ⇒ 30, >10 ставок <30с ⇒ 15.
async function seedFastBids() {
    const r = await pool.query(`
        WITH manual_bids_only AS (
            SELECT lot_id, bidder_login, bid_timestamp
            FROM lot_bids
            WHERE is_auto_bid = false
              AND lot_id IN (
                SELECT lot_id FROM lot_bids WHERE is_auto_bid = false
                GROUP BY lot_id HAVING COUNT(*) > 3
              )
        ),
        bid_intervals AS (
            SELECT bidder_login,
                EXTRACT(EPOCH FROM (bid_timestamp - LAG(bid_timestamp)
                    OVER (PARTITION BY lot_id ORDER BY bid_timestamp))) AS gap
            FROM manual_bids_only
        ),
        agg AS (
            SELECT bidder_login,
                COUNT(*) AS cnt,
                COUNT(*) FILTER (WHERE gap < 1) AS critical_count,
                COUNT(*) FILTER (WHERE gap < 5) AS suspicious_count
            FROM bid_intervals
            WHERE gap IS NOT NULL AND gap < 30
            GROUP BY bidder_login
        ),
        scored AS (
            SELECT bidder_login,
                CASE WHEN critical_count > 0 THEN 50
                     WHEN suspicious_count > 5 THEN 30
                     WHEN cnt > 10 THEN 15
                     ELSE 0 END AS score
            FROM agg
        )
        INSERT INTO winner_ratings (winner_login, fast_bids_score, last_analysis_date)
        SELECT bidder_login, score, NOW() FROM scored WHERE score > 0
        ON CONFLICT (winner_login) DO UPDATE
            SET fast_bids_score = EXCLUDED.fast_bids_score,
                last_analysis_date = EXCLUDED.last_analysis_date
    `);
    return r.rowCount;
}

function hit(path) {
    return new Promise((resolve) => {
        const t0 = Date.now();
        const req = http.get({ host: HOST, port: PORT, path, timeout: REQ_TIMEOUT_MS }, (res) => {
            let body = '';
            res.on('data', (c) => { body += c; });
            res.on('end', () => {
                const ms = Date.now() - t0;
                let count = '';
                try {
                    const j = JSON.parse(body);
                    const arr = j.data || j.results || j.users || j.carousels || j.pairs || [];
                    if (Array.isArray(arr)) count = `${arr.length} rows`;
                } catch (_) {}
                resolve({ path, ok: res.statusCode >= 200 && res.statusCode < 300, code: res.statusCode, ms, count });
            });
        });
        req.on('timeout', () => { req.destroy(new Error('timeout')); });
        req.on('error', (e) => resolve({ path, ok: false, code: 0, ms: Date.now() - t0, count: e.message }));
    });
}

async function bandCounts() {
    const r = await pool.query(`
        SELECT
            COUNT(*) FILTER (WHERE suspicious_score >= 50) AS critical,
            COUNT(*) FILTER (WHERE suspicious_score >= 35 AND suspicious_score < 50) AS high,
            COUNT(*) FILTER (WHERE suspicious_score >= 20 AND suspicious_score < 35) AS suspicious,
            COUNT(*) FILTER (WHERE suspicious_score > 0 AND suspicious_score < 20) AS attention,
            COUNT(*) FILTER (WHERE suspicious_score = 0) AS zero,
            MAX(suspicious_score) AS maxv
        FROM winner_ratings
    `);
    return r.rows[0];
}

(async () => {
    const started = new Date();
    console.log(`\n=== recompute-all-scores @ ${started.toISOString()} (reset=${RESET}) ===`);

    if (RESET) {
        const setZero = SIGNAL_COLUMNS.map((c) => `${c} = 0`).join(', ');
        const r = await pool.query(`UPDATE winner_ratings SET ${setZero}`);
        console.log(`[0] обнулено сигнальных колонок у ${r.rowCount} строк (триггер пересчитал suspicious_score)`);
    } else {
        console.log('[0] обнуление пропущено (--no-reset)');
    }

    // fast_bids засеваем SQL'ом ВСЕГДА и ДО эндпоинтов (autobid-traps от него зависит).
    try {
        const seeded = await seedFastBids();
        console.log(`[seed] fast_bids_score проставлен ${seeded} пользователям`);
    } catch (e) {
        console.error(`[seed] FAIL fast_bids: ${e.message}`);
    }

    let failed = 0;
    for (const path of ENDPOINTS) {
        const r = await hit(path);
        const tag = r.ok ? 'OK  ' : 'FAIL';
        if (!r.ok) failed++;
        console.log(`[${tag}] ${path}  (${r.code}, ${(r.ms / 1000).toFixed(1)}s) ${r.count}`);
    }

    const b = await bandCounts();
    console.log(`bands: КРИТ=${b.critical} ВЫС=${b.high} ПОДОЗР=${b.suspicious} ВНИМ=${b.attention} zero=${b.zero} max=${b.maxv}`);
    console.log(`=== done in ${((Date.now() - started.getTime()) / 1000).toFixed(0)}s, failures=${failed} ===`);

    await pool.end();
    process.exit(failed > 0 ? 1 : 0);
})().catch(async (e) => {
    console.error('FATAL:', e.message);
    try { await pool.end(); } catch (_) {}
    process.exit(1);
});

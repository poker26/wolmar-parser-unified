// Крон-точка входа для пересчёта прогнозов текущего аукциона (очередь wolmar-forecasts).
//   node temporal/start-forecast.js            — посчитать недостающие прогнозы текущего аукциона
//   node temporal/start-forecast.js 1015       — конкретный аукцион
//   node temporal/start-forecast.js --force    — пересчитать, даже если покрытие уже полное
//   node temporal/start-forecast.js progress|stop [номер]
//
// Идемпотентность: если воркфлоу для этого аукциона уже идёт — пишем «уже идёт» и выходим
// с кодом 0 (как в start-meshok-harvest.js), чтобы cron не плодил дубли и не слал письма.
'use strict';

const { Pool } = require('pg');
const config = require('../config');
const { resolveCurrentAuctionNumber } = require('../utils/current-auction');
const { startForecast, getForecastProgress, stopForecast } = require('./client');

// Ниже этого покрытия считаем, что аукцион не просчитан и работа нужна.
// Часть лотов честно остаётся без цены (no_similar_lots / category_excluded),
// поэтому строка в lot_price_predictions есть, а predicted_price может быть NULL —
// считаем именно СТРОКИ, иначе порог не достижим никогда.
const COVERAGE_TARGET = parseFloat(process.env.FORECAST_COVERAGE_TARGET || '0.98');

async function coverage(pool, auctionNumber) {
    const r = await pool.query(
        `SELECT COUNT(*)::int AS lots, COUNT(p.lot_id)::int AS preds
           FROM auction_lots al
           LEFT JOIN lot_price_predictions p ON p.lot_id = al.id
          WHERE al.auction_number = $1`,
        [String(auctionNumber)]
    );
    const { lots, preds } = r.rows[0];
    return { lots, preds, ratio: lots ? preds / lots : 1 };
}

(async () => {
    const args = process.argv.slice(2);
    const cmd = args.find((a) => ['progress', 'stop'].includes(a)) || 'start';
    const force = args.includes('--force');
    const explicit = args.find((a) => /^\d+$/.test(a)) || null;

    const pool = new Pool(config.dbConfig);
    let auctionNumber;
    try {
        auctionNumber = await resolveCurrentAuctionNumber(pool, explicit);
        if (!auctionNumber) throw new Error('Не найдено ни одного аукциона wolmar с числовым номером');

        if (cmd === 'progress') {
            console.log(JSON.stringify(await getForecastProgress(auctionNumber)));
            return;
        }
        if (cmd === 'stop') {
            console.log(JSON.stringify(await stopForecast(auctionNumber)));
            return;
        }

        const c = await coverage(pool, auctionNumber);
        console.log(`аукцион ${auctionNumber}: лотов ${c.lots}, с прогнозом ${c.preds} (${(c.ratio * 100).toFixed(1)}%)`);
        if (!force && c.ratio >= COVERAGE_TARGET) {
            console.log('покрытие полное — пересчёт не нужен (--force чтобы пересчитать)');
            return;
        }

        const r = await startForecast(auctionNumber);
        console.log('forecast запущен:', JSON.stringify(r));
    } catch (e) {
        // Воркфлоу с этим id уже идёт — это норма для cron, не ошибка.
        if (/already started|WorkflowExecutionAlreadyStarted/i.test(e.message)) {
            console.log(`forecast для аукциона ${auctionNumber} уже идёт — пропускаем`);
            return;
        }
        throw e;
    } finally {
        await pool.end();
    }
})().then(() => process.exit(0)).catch((e) => { console.error('FATAL', e.message); process.exit(1); });

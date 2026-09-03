// Активити смены аукциона. Здесь весь side-effect: HTTP к wolmar.ru и pg.
// Воркфлоу (parser-workflows.auctionRolloverWorkflow) остаётся детерминированным —
// он лишь исполняет план, который целиком строится здесь, одним вызовом.
'use strict';

const https = require('https');
const { Pool } = require('pg');
const config = require('../config');
const { parseCurrentAuctions } = require('./wolmar-auction-series');

let pool = null;
function getPool() {
    if (!pool) pool = new Pool(config.dbConfig);
    return pool;
}

// --- HTTP ---------------------------------------------------------------
// wolmar.ru отдаёт 301 на www — идём по редиректу. Puppeteer тут не нужен:
// у wolmar нет анти-бот защиты, обычный GET проходит (в отличие от auction.ru).
function httpGet(url, redirects = 3) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (wolmar-parser rollover)' } }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
                res.resume();
                return httpGet(new URL(res.headers.location, url).toString(), redirects - 1).then(resolve, reject);
            }
            if (res.statusCode !== 200) {
                res.resume();
                return reject(new Error(`GET ${url} → HTTP ${res.statusCode}`));
            }
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (c) => { body += c; });
            res.on('end', () => resolve(body));
        }).on('error', reject);
    });
}

// --- Дискавери ----------------------------------------------------------
// В шапке сайта есть блок <div class="dot_menu"> с ИДУЩИМИ торгами:
//   <a href="/auction/2242">Аукцион VIP №1016</a>
// href — внутренний wolmar-id (для URL), подпись — НАШ номер аукциона.
// Таких блоков на странице несколько (авторизация, справка, аукционы) — берём тот,
// где есть VIP. Архивный список внизу главной содержит ТЕ ЖЕ подписи за все годы,
// поэтому парсить страницу целиком нельзя: возьмём аукцион 2016 года.
//
async function discoverCurrentVip() {
    const html = await httpGet('https://www.wolmar.ru/');
    const auction = parseCurrentAuctions(html).find((item) => item.series === 'vip');
    if (auction) return { wolmarId: auction.wolmarId, num: auction.displayNumber };
    // Молчаливое «ничего не нашли» — худший исход (ровно так сломался enum auction.ru):
    // лучше упасть и увидеть это в логе, чем каждую ночь тихо ничего не делать.
    throw new Error('Не удалось найти текущий VIP-аукцион в шапке wolmar.ru — изменилась вёрстка?');
}

async function discoverCurrentStandart() {
    const html = await httpGet('https://www.wolmar.ru/');
    const auction = parseCurrentAuctions(html).find((item) => item.series === 'standart');
    if (auction) {
        return {
            wolmarId: auction.wolmarId,
            num: auction.displayNumber,
            auctionNumber: auction.auctionNumber,
        };
    }
    throw new Error('Не удалось найти текущий Standart-аукцион в шапке wolmar.ru — изменилась вёрстка?');
}

// --- Состояние ----------------------------------------------------------
// Своя табличка отметок: по данным лотов «уже финализировали?» не определить
// однозначно (часть категорий может остаться active), а история Temporal живёт
// недолго. Одна строка на аукцион, три отметки.
async function ensureRolloverSchema() {
    await getPool().query(`
        CREATE TABLE IF NOT EXISTS auction_rollover_state (
            auction_number text PRIMARY KEY,
            parsed_at      timestamptz,
            finalized_at   timestamptz,
            forecasted_at  timestamptz
        )`);
    return true;
}

const STEP_COLUMN = { parsed: 'parsed_at', finalized: 'finalized_at', forecasted: 'forecasted_at' };

async function markRolloverStep(auctionNumber, step) {
    const col = STEP_COLUMN[step];
    if (!col) throw new Error(`Неизвестный шаг rollover: ${step}`);
    await getPool().query(
        `INSERT INTO auction_rollover_state (auction_number, ${col}) VALUES ($1, now())
         ON CONFLICT (auction_number) DO UPDATE SET ${col} = now()`,
        [String(auctionNumber)]
    );
    return true;
}

// --- План ---------------------------------------------------------------
// Возвращает ровно то, что воркфлоу должен исполнить, в порядке исполнения.
// opts.maxFinalize — сколько закрытых аукционов дофинализировать за прогон
// (по умолчанию 1: полный проход по ~5-6 тыс. лотов идёт часы, накопившийся
// хвост разбирается за несколько ночей, а не одной бесконечной задачей).
async function planRollover(opts = {}) {
    const force = !!opts.force;
    const maxFinalize = Number.isFinite(opts.maxFinalize) ? opts.maxFinalize : 1;
    const maxAgeDays = Number.isFinite(opts.finalizeMaxAgeDays) ? opts.finalizeMaxAgeDays : 21;
    const coverageTarget = Number.isFinite(opts.coverageTarget) ? opts.coverageTarget : 0.98;
    const db = getPool();
    await ensureRolloverSchema();

    const site = await discoverCurrentVip();

    // (1) Закрытые аукционы, где остались лоты в статусе active — ставки не финальные.
    //     parsing_number = wolmar-id для URL; без него аукцион не переразобрать.
    const fin = await db.query(
        `SELECT al.auction_number AS num,
                max(al.parsing_number)::text AS wolmar_id,
                count(*) FILTER (WHERE al.lot_status = 'active')::int AS active_lots,
                max(al.auction_end_date) AS ends_at,
                (max(al.auction_end_date) > now() - ($1 || ' days')::interval) AS fresh
           FROM auction_lots al
          WHERE al.source_site = 'wolmar.ru' AND al.auction_number ~ '^[0-9]+$'
          GROUP BY 1
         HAVING max(al.auction_end_date) < now()
            AND count(*) FILTER (WHERE al.lot_status = 'active') > 0
            AND max(al.parsing_number) IS NOT NULL
          ORDER BY al.auction_number::int DESC`,
        [String(maxAgeDays)]
    );
    const marked = await db.query(`SELECT auction_number FROM auction_rollover_state WHERE finalized_at IS NOT NULL`);
    const alreadyFinalized = new Set(marked.rows.map((r) => r.auction_number));

    // Смена аукциона занимается ТОЛЬКО свежезакрывшимся аукционом. Хвост из старых
    // (там осели единицы-сотни лотов, чьи страницы не дочитались месяцы назад) сюда не
    // тянем: полный переразбор такого аукциона — часы работы единственного браузера,
    // а ценности в этом почти нет. Хвост показываем числом (finalizeBacklog) и разбираем
    // осознанно: --all --max-finalize=N.
    const candidates = fin.rows.filter((r) => (opts.finalizeAll ? true : r.fresh));
    const finalize = candidates
        .filter((r) => force || !alreadyFinalized.has(r.num))
        .slice(0, maxFinalize)
        .map((r) => ({ num: r.num, wolmarId: r.wolmar_id, activeLots: r.active_lots, endsAt: r.ends_at }));

    // (2) Новый аукцион. «Скачан ли он» определяем НЕ по «лотов > 0» (после первой же
    //     страницы это правда, а лотов 80 из 5000) и не по счётчику на сайте (он есть не
    //     на всех страницах), а по двум признакам:
    //       • отметка parsed_at в auction_rollover_state — аукцион уже забирали этим воркфлоу;
    //       • объём: у последних аукционов ~5-6 тыс. лотов, взяли меньше 90% медианы —
    //         значит забор не закончен (оборвался или идёт прямо сейчас).
    //     Оба признака переживают перезапуск и не требуют лишних запросов к сайту.
    const cnt = await db.query(
        `SELECT count(*)::int AS c FROM auction_lots WHERE source_site = 'wolmar.ru' AND auction_number = $1`,
        [site.num]
    );
    const med = await db.query(
        `SELECT percentile_disc(0.5) WITHIN GROUP (ORDER BY c)::int AS m FROM (
             SELECT count(*)::int AS c FROM auction_lots
              WHERE source_site = 'wolmar.ru' AND auction_number ~ '^[0-9]+$' AND auction_number <> $1
              GROUP BY auction_number
              ORDER BY auction_number::int DESC
              LIMIT 5
         ) t`,
        [site.num]
    );
    const parsedMark = await db.query(
        `SELECT parsed_at FROM auction_rollover_state WHERE auction_number = $1`, [site.num]
    );
    const dbLots = cnt.rows[0].c;
    const expected = med.rows[0].m || 0;
    const looksComplete = expected > 0 && dbLots >= Math.floor(expected * 0.9);
    const alreadyParsed = parsedMark.rows.length > 0 && parsedMark.rows[0].parsed_at != null;
    const parse = (force || !(alreadyParsed || looksComplete)) ? { num: site.num, wolmarId: site.wolmarId } : null;

    // (3) Прогнозы: для только что скачанного аукциона — всегда; иначе для текущего,
    //     если покрытие просело (лоты доехали позже, чем считались прогнозы).
    let forecast = null;
    if (parse) {
        forecast = parse.num;
    } else {
        const cov = await db.query(
            `SELECT count(*)::int AS lots, count(p.lot_id)::int AS preds
               FROM auction_lots al
               LEFT JOIN lot_price_predictions p ON p.lot_id = al.id
              WHERE al.source_site = 'wolmar.ru' AND al.auction_number = $1`,
            [site.num]
        );
        const { lots, preds } = cov.rows[0];
        if (lots > 0 && preds / lots < coverageTarget) forecast = site.num;
    }

    return {
        site,
        finalize,
        parse,
        forecast,
        // Диагностика для лога и дашборда — почему план получился таким.
        finalizeBacklog: fin.rows.filter((r) => !alreadyFinalized.has(r.num)).length,
        finalizeBacklogFresh: candidates.filter((r) => !alreadyFinalized.has(r.num)).length,
        currentAuctionLots: dbLots,
        expectedLots: expected,
        alreadyParsed,
    };
}

module.exports = {
    planRollover,
    markRolloverStep,
    ensureRolloverSchema,
    discoverCurrentVip,
    discoverCurrentStandart,
};

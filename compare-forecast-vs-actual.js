// Сверка прогнозов с фактическими ценами закрытия аукциона.
//   node compare-forecast-vs-actual.js [номер_аукциона]
//
// Считаем только по ПРОДАННЫМ лотам, у которых есть и прогноз, и цена ухода.
// Метрика — отношение прогноз/факт: она симметрична по смыслу («в N раз мимо»)
// и не разваливается на дешёвых лотах, в отличие от абсолютной разницы.
'use strict';

const { Pool } = require('pg');
const config = require('./config');

const AUCTION = process.argv[2] || '1015';
const pool = new Pool(config.dbConfig);

const median = (a) => {
    if (!a.length) return null;
    const s = [...a].sort((x, y) => x - y);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pct = (n, d) => (d ? (100 * n / d).toFixed(1) + '%' : '—');
const money = (v) => Math.round(v).toLocaleString('ru-RU') + '₽';

function stats(rows) {
    const ratios = rows.map((r) => r.pred / r.actual);
    const ape = rows.map((r) => Math.abs(r.pred - r.actual) / r.actual);
    const within = (t) => ratios.filter((x) => x >= 1 - t && x <= 1 + t).length;
    return {
        n: rows.length,
        mdape: median(ape),
        bias: median(ratios),
        w10: within(0.10), w25: within(0.25), w50: within(0.50),
        over: ratios.filter((x) => x > 1).length,
    };
}

function printBlock(title, rows) {
    if (!rows.length) { console.log(`\n${title}: нет данных`); return; }
    const s = stats(rows);
    console.log(`\n${title} (${s.n} лотов)`);
    console.log(`  медианная ошибка (MdAPE): ${(s.mdape * 100).toFixed(1)}%`);
    console.log(`  смещение (медиана прогноз/факт): ${s.bias.toFixed(3)} ${s.bias > 1 ? '— завышаем' : '— занижаем'}`);
    console.log(`  попали ±10%: ${pct(s.w10, s.n)} · ±25%: ${pct(s.w25, s.n)} · ±50%: ${pct(s.w50, s.n)}`);
    console.log(`  прогноз выше факта: ${pct(s.over, s.n)}`);
}

(async () => {
    const cov = await pool.query(
        `SELECT count(*)::int lots,
                count(p.lot_id)::int preds,
                count(p.predicted_price)::int with_price,
                count(*) FILTER (WHERE al.winning_bid > 0 AND al.winner_login IS NOT NULL)::int sold
           FROM auction_lots al
           LEFT JOIN lot_price_predictions p ON p.lot_id = al.id
          WHERE al.auction_number = $1`, [AUCTION]);
    const c = cov.rows[0];
    console.log(`=== Аукцион ${AUCTION} ===`);
    console.log(`лотов ${c.lots} · продано ${c.sold} · прогнозов ${c.preds} · из них с ценой ${c.with_price} (${pct(c.with_price, c.lots)})`);

    const q = await pool.query(
        `SELECT al.lot_number, al.condition, al.metal, al.category,
                left(al.coin_description, 70) AS descr,
                al.winning_bid::float AS actual,
                p.predicted_price::float AS pred,
                p.prediction_method AS method,
                p.sample_size::int AS sample_size,
                p.confidence_score::float AS conf
           FROM auction_lots al
           JOIN lot_price_predictions p ON p.lot_id = al.id
          WHERE al.auction_number = $1
            AND p.predicted_price IS NOT NULL AND p.predicted_price > 0
            AND al.winning_bid > 0 AND al.winner_login IS NOT NULL`, [AUCTION]);
    const rows = q.rows;

    printBlock('ВСЕГО', rows);

    console.log('\n--- по методу ---');
    for (const m of ['statistical_model', 'single_similar_lot']) {
        printBlock(m, rows.filter((r) => r.method === m));
    }

    console.log('\n--- по числу аналогов ---');
    const buckets = [[2, 2], [3, 4], [5, 9], [10, 1e9]];
    for (const [lo, hi] of buckets) {
        printBlock(`аналогов ${lo}${hi > 1e8 ? '+' : '-' + hi}`, rows.filter((r) => r.sample_size >= lo && r.sample_size <= hi));
    }

    console.log('\n--- по цене ухода ---');
    const price = [[0, 5000], [5000, 20000], [20000, 100000], [100000, 1e12]];
    for (const [lo, hi] of price) {
        printBlock(`${money(lo)}–${hi > 1e11 ? '∞' : money(hi)}`, rows.filter((r) => r.actual >= lo && r.actual < hi));
    }

    const withRatio = rows.map((r) => ({ ...r, ratio: r.pred / r.actual }));
    const show = (title, list) => {
        console.log(`\n${title}`);
        for (const r of list) {
            console.log(`  лот ${r.lot_number} ${r.condition || '—'} · прогноз ${money(r.pred)} · факт ${money(r.actual)} ` +
                `· ×${r.ratio.toFixed(2)} · ${r.method}/${r.sample_size} · ${r.descr}`);
        }
    };
    show('ТОП-10 переоценили (прогноз >> факт):', [...withRatio].sort((a, b) => b.ratio - a.ratio).slice(0, 10));
    show('ТОП-10 недооценили (факт >> прогноз):', [...withRatio].sort((a, b) => a.ratio - b.ratio).slice(0, 10));

    await pool.end();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });

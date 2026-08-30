// Активити форкаст-пилота. Здесь живут все side-effect'ы (pg + Puppeteer-free генератор):
// workflow обязан быть детерминированным, поэтому БД и тяжёлый расчёт — только тут.
'use strict';

const { Context } = require('@temporalio/activity');
const { Pool } = require('pg');
const config = require('../config');
const { ValuationService } = require('../valuation-service');
const { resolveCurrentAuctionNumber } = require('../utils/current-auction');

// Singleton pool — переживает между активити в рамках процесса воркера.
let pool = null;
function getPool() {
    if (!pool) pool = new Pool(config.dbConfig);
    return pool;
}

// Singleton генератор. У него ОДИН pg Client внутри (improved-predictions-generator.init()),
// поэтому конкурентный доступ небезопасен → у воркера maxConcurrentActivityTaskExecutions=1.
let valuationService = null;
async function getValuationService() {
    if (!valuationService) valuationService = new ValuationService({ db: getPool() });
    return valuationService;
}

// Резолв текущего аукциона — общий хелпер (utils/current-auction.js).
// Раньше здесь был свой запрос без фильтра источника: он находил meshok-лот с
// будущим auction_end_date, возвращал String(null) === 'null', countLots давал 0,
// и workflow завершался мгновенно, ничего не посчитав.
async function resolveAuction(inputNumber) {
    const n = await resolveCurrentAuctionNumber(getPool(), inputNumber);
    if (!n) throw new Error('Не найдено ни одного аукциона для расчёта прогнозов');
    return n;
}

async function countLots(auctionNumber) {
    const db = getPool();
    const r = await db.query(
        'SELECT COUNT(*)::int AS c FROM auction_lots WHERE auction_number = $1',
        [String(auctionNumber)]
    );
    return r.rows[0].c;
}

// Обрабатывает одну страницу лотов [offset, offset+limit). Heartbeat на каждый лот →
// если активити упадёт/перезапустится, Temporal знает прогресс и не зависнет на timeout.
async function predictChunk(auctionNumber, offset, limit) {
    const db = getPool();
    const valuations = await getValuationService();
    const lots = await db.query(
        `SELECT al.id, al.lot_number, al.condition, al.metal, al.weight,
                al.fineness, al.pure_metal_weight, al.year, al.letters,
                al.winning_bid, al.coin_description, al.auction_number,
                al.category, al.auction_end_date, al.slab_status,
                al.grading_company_code, al.slab_grade_code, al.grade_source,
                linked.type_id, linked.grade AS link_grade,
                linked.link_quality_status
         FROM auction_lots al
         LEFT JOIN LATERAL (
             SELECT ltl.type_id, ltl.grade, lq.status AS link_quality_status
             FROM lot_type_link ltl
             LEFT JOIN lot_type_link_quality lq
               ON lq.lot_id = ltl.lot_id
              AND lq.type_id = ltl.type_id
              AND lq.audit_version = 'hard-consistency-v1'
             WHERE ltl.lot_id = al.id
             ORDER BY CASE lq.status
                 WHEN 'consistent' THEN 0
                 WHEN 'unverified' THEN 1
                 WHEN 'conflict' THEN 2
                 ELSE 1
             END, ltl.id
             LIMIT 1
         ) linked ON true
         WHERE al.auction_number = $1
         ORDER BY al.lot_number::int
         OFFSET $2 LIMIT $3`,
        [String(auctionNumber), offset, limit]
    );

    let processed = 0;
    let errors = 0;
    for (const lot of lots.rows) {
        try {
            const valuation = await valuations.valuateLot(lot, { loadIdentity: false });
            const p = valuation.prediction;
            if (p) {
                await db.query(
                    `INSERT INTO lot_price_predictions
                        (lot_id, predicted_price, metal_value, numismatic_premium,
                         confidence_score, prediction_method, sample_size)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)
                     ON CONFLICT (lot_id) DO UPDATE SET
                         predicted_price = EXCLUDED.predicted_price,
                         metal_value = EXCLUDED.metal_value,
                         numismatic_premium = EXCLUDED.numismatic_premium,
                         confidence_score = EXCLUDED.confidence_score,
                         prediction_method = EXCLUDED.prediction_method,
                         sample_size = EXCLUDED.sample_size,
                         created_at = NOW()`,
                    [lot.id, p.predicted_price, p.metal_value, p.numismatic_premium,
                     p.confidence_score, p.prediction_method, p.sample_size]
                );
            }
            processed++;
        } catch (e) {
            errors++;
        }
        Context.current().heartbeat({ offset: offset + processed + errors });
    }
    return { processed, errors };
}

module.exports = { resolveAuction, countLots, predictChunk };

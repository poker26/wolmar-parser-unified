// Активити форкаст-пилота. Здесь живут все side-effect'ы (pg + Puppeteer-free генератор):
// workflow обязан быть детерминированным, поэтому БД и тяжёлый расчёт — только тут.
'use strict';

const { Context } = require('@temporalio/activity');
const { Pool } = require('pg');
const config = require('../config');
const ImprovedPredictionsGenerator = require('../improved-predictions-generator');
const { resolveCurrentAuctionNumber } = require('../utils/current-auction');

// Singleton pool — переживает между активити в рамках процесса воркера.
let pool = null;
function getPool() {
    if (!pool) pool = new Pool(config.dbConfig);
    return pool;
}

// Singleton генератор. У него ОДИН pg Client внутри (improved-predictions-generator.init()),
// поэтому конкурентный доступ небезопасен → у воркера maxConcurrentActivityTaskExecutions=1.
let generator = null;
let generatorReady = false;
async function getGenerator() {
    if (!generator) generator = new ImprovedPredictionsGenerator();
    if (!generatorReady) {
        await generator.init();
        generatorReady = true;
    }
    return generator;
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
    const gen = await getGenerator();
    const lots = await db.query(
        `SELECT id, lot_number, condition, metal, weight, fineness, pure_metal_weight,
                year, letters, winning_bid, coin_description, auction_number,
                category, auction_end_date
         FROM auction_lots
         WHERE auction_number = $1
         ORDER BY lot_number::int
         OFFSET $2 LIMIT $3`,
        [String(auctionNumber), offset, limit]
    );

    let processed = 0;
    let errors = 0;
    for (const lot of lots.rows) {
        try {
            const p = await gen.predictPrice(lot);
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

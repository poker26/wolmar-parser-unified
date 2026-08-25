// Активити форкаст-пилота. Здесь живут все side-effect'ы (pg + Puppeteer-free генератор):
// workflow обязан быть детерминированным, поэтому БД и тяжёлый расчёт — только тут.
'use strict';

const { Context } = require('@temporalio/activity');
const { Pool } = require('pg');
const config = require('../config');
const ImprovedPredictionsGenerator = require('../improved-predictions-generator');

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

// Зеркало findCorrectAuctionNumber из generate-predictions-with-progress.js:
// сначала проверяем, есть ли лоты у переданного номера; иначе активный; иначе последний.
async function resolveAuction(inputNumber) {
    const db = getPool();
    if (inputNumber) {
        const r = await db.query(
            'SELECT COUNT(*)::int AS c FROM auction_lots WHERE auction_number = $1',
            [String(inputNumber)]
        );
        if (r.rows[0].c > 0) return String(inputNumber);
    }
    const active = await db.query(
        `SELECT auction_number FROM auction_lots
         WHERE auction_end_date > NOW()
         ORDER BY auction_end_date ASC LIMIT 1`
    );
    if (active.rows.length) return String(active.rows[0].auction_number);
    const last = await db.query(
        'SELECT auction_number FROM auction_lots ORDER BY auction_number DESC LIMIT 1'
    );
    if (last.rows.length) return String(last.rows[0].auction_number);
    throw new Error('Не найдено ни одного аукциона для расчёта прогнозов');
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

'use strict';

const crypto = require('node:crypto');
const { Pool } = require('pg');
const config = require('../config');
const { normalizeGrade } = require('../app-v1/valuation/grade');

const METHOD = 'auction_houses_exact_grade_percentiles';
const MODEL_VERSION = 'mvp-v1';
const MAX_COMPARABLES = 250;

function percentile(sorted, fraction) {
    if (!sorted.length) return null;
    if (sorted.length === 1) return sorted[0];
    const position = (sorted.length - 1) * fraction;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    if (lower === upper) return sorted[lower];
    return Math.round(sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower));
}

function confidenceFor(count) {
    if (count < 3) return null;
    if (count < 5) return 0.35;
    if (count < 10) return 0.6;
    if (count < 20) return 0.8;
    return 0.95;
}

async function insertSnapshot(pool, item, result) {
    const basis = {
        rules: {
            sources: ['wolmar.ru', 'numismat.ru'],
            saleStatus: 'closed',
            priceBasis: 'hammer',
            currency: 'RUB',
            gradeMatch: 'normalized_exact',
            minimumComparables: 3,
            maximumComparables: MAX_COMPARABLES,
            percentiles: [0.25, 0.5, 0.75],
        },
        typeId: item.type_id,
        normalizedGrade: result.gradeCode,
        lotIds: result.rows.map((row) => Number(row.lot_id)),
    };
    const inserted = await pool.query(
        `INSERT INTO collection_valuation (
            id, item_id, currency, low_minor, median_minor, high_minor,
            grade_code, comparable_count, confidence, status, method,
            model_version, basis, abstain_reason
         ) VALUES ($1,$2,'RUB',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13)
         RETURNING id, status, comparable_count, calculated_at`,
        [
            crypto.randomUUID(), item.id,
            result.lowMinor, result.medianMinor, result.highMinor,
            result.gradeCode, result.rows.length, result.confidence,
            result.status, METHOD, MODEL_VERSION, JSON.stringify(basis), result.abstainReason,
        ],
    );
    return inserted.rows[0];
}

async function calculateCollectionValuation({ itemId }, dependencies = {}) {
    const pool = dependencies.pool || new Pool({ ...config.dbConfig, max: 1 });
    const ownsPool = !dependencies.pool;
    try {
        const itemResult = await pool.query(
            `SELECT id, type_id, grade_code
             FROM collection_item
             WHERE id = $1 AND deleted_at IS NULL`,
            [itemId],
        );
        const item = itemResult.rows[0];
        if (!item) return { itemId, skipped: 'missing' };

        const gradeCode = normalizeGrade(item.grade_code);
        if (!item.type_id) {
            const snapshot = await insertSnapshot(pool, item, {
                status: 'insufficient_data', gradeCode, rows: [],
                lowMinor: null, medianMinor: null, highMinor: null,
                confidence: null, abstainReason: 'type_required',
            });
            return { itemId, ...snapshot };
        }
        if (!gradeCode) {
            const snapshot = await insertSnapshot(pool, item, {
                status: 'insufficient_data', gradeCode: null, rows: [],
                lowMinor: null, medianMinor: null, highMinor: null,
                confidence: null, abstainReason: 'grade_required',
            });
            return { itemId, ...snapshot };
        }

        const comparableResult = await pool.query(
            `SELECT al.id lot_id,
                    round(al.winning_bid * 100)::bigint price_minor,
                    al.auction_end_date
             FROM lot_type_link l
             JOIN auction_lots al ON al.id = l.lot_id
             WHERE l.type_id = $1
               AND collection_normalize_grade(
                    COALESCE(NULLIF(l.grade, ''), NULLIF(al.condition, ''))
               ) = $2
               AND al.source_site IN ('wolmar.ru', 'numismat.ru')
               AND al.lot_status = 'closed'
               AND al.auction_end_date IS NOT NULL
               AND al.auction_end_date <= now()
               AND al.winning_bid > 0
               AND COALESCE(NULLIF(al.currency, ''), 'RUB') = 'RUB'
             ORDER BY al.auction_end_date DESC, al.id DESC
             LIMIT $3`,
            [item.type_id, gradeCode, MAX_COMPARABLES],
        );
        const rows = comparableResult.rows.filter((row) => {
            const value = Number(row.price_minor);
            return Number.isSafeInteger(value) && value > 0;
        });
        if (rows.length < 3) {
            const snapshot = await insertSnapshot(pool, item, {
                status: 'insufficient_data', gradeCode, rows,
                lowMinor: null, medianMinor: null, highMinor: null,
                confidence: null, abstainReason: 'not_enough_exact_grade_sales',
            });
            return { itemId, ...snapshot };
        }

        const prices = rows.map((row) => Number(row.price_minor)).sort((a, b) => a - b);
        const snapshot = await insertSnapshot(pool, item, {
            status: 'ready', gradeCode, rows,
            lowMinor: percentile(prices, 0.25),
            medianMinor: percentile(prices, 0.5),
            highMinor: percentile(prices, 0.75),
            confidence: confidenceFor(rows.length),
            abstainReason: null,
        });
        return { itemId, ...snapshot };
    } finally {
        if (ownsPool) await pool.end();
    }
}

module.exports = {
    MAX_COMPARABLES,
    METHOD,
    MODEL_VERSION,
    calculateCollectionValuation,
    confidenceFor,
    percentile,
};

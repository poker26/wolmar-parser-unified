'use strict';

const crypto = require('node:crypto');
const { Pool } = require('pg');
const config = require('../config');
const { ProductAnalytics, comparableBucket, safeRecorder } = require('../app-v1/analytics/service');
const { METHOD_VERSION, ValuationService } = require('../valuation-service');

const METHOD = 'unified_valuation_service';

function rublesToMinor(value) {
    if (value == null || !Number.isFinite(Number(value))) return null;
    return Math.round(Number(value) * 100);
}

function analyticsReason(reason) {
    if (reason === 'type_required') return reason;
    if (reason === 'no_similar_lots') return 'not_enough_exact_grade_sales';
    return 'other';
}

async function insertSnapshot(pool, item, result, recordEvent) {
    const comparableCount = Number(result.comparableCount || 0);
    const exactComparableCount = Number(result.prediction?.exact_comparable_count ?? comparableCount);
    const basis = {
        valuationFingerprint: result.fingerprint,
        typeId: result.profile.typeId,
        profile: result.profile,
        comparableBasis: result.basis,
        predictionMethod: result.method,
        lotIds: result.prediction?.comparable_lot_ids || [],
    };
    const inserted = await pool.query(
        `INSERT INTO collection_valuation (
            id, item_id, currency, low_minor, median_minor, high_minor,
            grade_code, comparable_count, confidence, status, method,
            model_version, basis, abstain_reason, slab_status,
            grading_company_code, grade_source, basis_level,
            exact_comparable_count, expanded_comparable_count
         ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,
            $15,$16,$17,$18,$19,$20
         )
         RETURNING id, status, comparable_count, calculated_at`,
        [
            crypto.randomUUID(), item.id, result.currency,
            rublesToMinor(result.low), rublesToMinor(result.median), rublesToMinor(result.high),
            result.profile.gradeCode, comparableCount, result.confidence,
            result.status, result.method, result.methodVersion,
            JSON.stringify(basis), result.abstainReason,
            result.profile.slabStatus, result.profile.gradingCompanyCode,
            result.profile.gradeSource, result.basis,
            exactComparableCount, comparableCount,
        ],
    );
    const snapshot = inserted.rows[0];
    const ready = result.status === 'ready';
    await recordEvent({
        userId: item.user_id,
        eventName: ready ? 'collection_valuation_ready' : 'collection_valuation_abstained',
        properties: ready
            ? { comparableBucket: comparableBucket(comparableCount) }
            : {
                reason: analyticsReason(result.abstainReason),
                comparableBucket: comparableBucket(comparableCount),
            },
        sourceId: snapshot.id,
    });
    return snapshot;
}

function missingTypeResult(item) {
    const profile = {
        typeId: null,
        gradeCode: item.grade_code || null,
        gradeSource: item.grade_source || 'unknown',
        slabStatus: item.slab_status || 'unknown',
        gradingCompanyCode: item.grading_company_code || null,
        valuationDate: new Date().toISOString().slice(0, 10),
        currency: 'RUB',
    };
    return {
        status: 'insufficient_data', currency: 'RUB', low: null, median: null, high: null,
        confidence: 0, comparableCount: 0, basis: 'identity_required', method: 'type_required',
        methodVersion: METHOD_VERSION, abstainReason: 'type_required', profile,
        fingerprint: null, prediction: { comparable_lot_ids: [], exact_comparable_count: 0 },
    };
}

async function calculateCollectionValuation({ itemId }, dependencies = {}) {
    const pool = dependencies.pool || new Pool({ ...config.dbConfig, max: 1 });
    const recordEvent = dependencies.recordEvent || safeRecorder(new ProductAnalytics({ pool }));
    const ownsPool = !dependencies.pool;
    let valuationService = dependencies.valuationService || null;
    const ownsValuationService = !valuationService;
    try {
        const itemResult = await pool.query(
            `SELECT id, user_id, type_id, grade_code, grade_source,
                    slab_status, grading_company_code
             FROM collection_item
             WHERE id = $1 AND deleted_at IS NULL`,
            [itemId],
        );
        const item = itemResult.rows[0];
        if (!item) return { itemId, skipped: 'missing' };

        let result;
        if (!item.type_id) {
            result = missingTypeResult(item);
        } else {
            valuationService ||= new ValuationService({ db: pool });
            result = await valuationService.valuateCollectionItem(item);
        }
        const snapshot = await insertSnapshot(pool, item, result, recordEvent);
        return { itemId, ...snapshot };
    } finally {
        if (ownsValuationService && valuationService) await valuationService.close();
        if (ownsPool) await pool.end();
    }
}

module.exports = {
    METHOD,
    MODEL_VERSION: METHOD_VERSION,
    calculateCollectionValuation,
    insertSnapshot,
    rublesToMinor,
};

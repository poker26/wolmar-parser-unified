'use strict';

const crypto = require('node:crypto');
const { ProductAnalytics, comparableBucket, safeRecorder } = require('../analytics/service');
const { METHOD_VERSION, ValuationService } = require('../../valuation-service');

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
        estimateKind: result.estimateKind,
        rangeAvailable: result.rangeAvailable,
        lotIds: result.prediction?.comparable_lot_ids || [],
    };
    // The table keeps ordered low/median/high values for existing constraints and
    // aggregate queries. A point estimate is stored as median=low=high, while the
    // public contract uses rangeAvailable=false and does not expose a false range.
    const storedLow = result.rangeAvailable ? result.low : result.median;
    const storedHigh = result.rangeAvailable ? result.high : result.median;
    const inserted = await pool.query(
        `INSERT INTO collection_valuation (
            id, item_id, currency, low_minor, median_minor, high_minor,
            grade_code, comparable_count, confidence, status, method,
            model_version, basis, abstain_reason, slab_status,
            grading_company_code, grading_company_raw, grade_source, basis_level,
            exact_comparable_count, expanded_comparable_count
         ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,
            $15,$16,$17,$18,$19,$20,$21
         )
         RETURNING *`,
        [
            crypto.randomUUID(), item.id, result.currency,
            rublesToMinor(storedLow), rublesToMinor(result.median), rublesToMinor(storedHigh),
            result.profile.gradeCode, comparableCount, result.confidence,
            result.status, result.method, result.methodVersion,
            JSON.stringify(basis), result.abstainReason,
            result.profile.slabStatus, result.profile.gradingCompanyCode,
            item.grading_company_raw || null, result.profile.gradeSource, result.basis,
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
        estimateKind: 'none', rangeAvailable: false,
        methodVersion: METHOD_VERSION, abstainReason: 'type_required', profile,
        fingerprint: null, prediction: { comparable_lot_ids: [], exact_comparable_count: 0 },
    };
}

async function calculateCollectionValuation({ itemId }, dependencies = {}) {
    const { pool } = dependencies;
    if (!pool || typeof pool.query !== 'function') throw new TypeError('A pg-compatible pool is required');
    const recordEvent = dependencies.recordEvent
        || safeRecorder(dependencies.analytics || new ProductAnalytics({ pool }));
    let valuationService = dependencies.valuationService || null;
    const ownsValuationService = !valuationService;
    try {
        const itemResult = await pool.query(
            `SELECT id, user_id, type_id, grade_code, grade_source,
                    slab_status, grading_company_code, grading_company_raw
             FROM collection_item
             WHERE id = $1 AND deleted_at IS NULL`,
            [itemId],
        );
        const item = itemResult.rows[0];
        if (!item) return { itemId, skipped: 'missing' };

        const result = item.type_id
            ? await (valuationService ||= new ValuationService({ db: pool })).valuateCollectionItem(item)
            : missingTypeResult(item);
        const snapshot = await insertSnapshot(pool, item, result, recordEvent);
        return { itemId, ...snapshot, snapshot };
    } finally {
        if (ownsValuationService && valuationService) await valuationService.close();
    }
}

module.exports = {
    METHOD,
    MODEL_VERSION: METHOD_VERSION,
    calculateCollectionValuation,
    insertSnapshot,
    rublesToMinor,
};

'use strict';

const crypto = require('node:crypto');
const ImprovedPredictionsGenerator = require('./improved-predictions-generator');
const { normalizeGrade } = require('./domain/grade');

const METHOD_VERSION = 'improved-type-slab-v1';

function valuationDate(value) {
    const date = value == null ? new Date() : new Date(value);
    if (!Number.isFinite(date.getTime())) throw new TypeError('valuationDate must be a valid date');
    return date;
}

function normalizedProfile(target, date = new Date()) {
    const typeId = Number(target.type_id ?? target.typeId);
    const slabStatus = ['slabbed', 'raw'].includes(target.slab_status ?? target.slabStatus)
        ? (target.slab_status ?? target.slabStatus)
        : 'unknown';
    const gradingCompanyCode = slabStatus === 'slabbed'
        ? (target.grading_company_code ?? target.gradingCompanyCode ?? null)
        : null;
    return {
        typeId: Number.isSafeInteger(typeId) && typeId > 0 ? typeId : null,
        gradeCode: normalizeGrade(
            target.slab_grade_code
            ?? target.grade_code
            ?? target.gradeCode
            ?? target.link_grade
            ?? target.condition,
        ),
        gradeSource: target.grade_source ?? target.gradeSource ?? 'unknown',
        slabStatus,
        gradingCompanyCode,
        valuationDate: valuationDate(date).toISOString().slice(0, 10),
        currency: String(target.currency || 'RUB').toUpperCase(),
    };
}

function fingerprintFor(profile) {
    return crypto.createHash('sha256')
        .update(JSON.stringify({ ...profile, methodVersion: METHOD_VERSION }))
        .digest('hex');
}

function canonicalResult(prediction, target, date) {
    const profile = normalizedProfile(target, date);
    const ready = Number(prediction?.predicted_price) > 0;
    return {
        status: ready ? 'ready' : 'insufficient_data',
        currency: profile.currency,
        low: prediction?.low_price ?? null,
        median: ready ? Number(prediction.predicted_price) : null,
        high: prediction?.high_price ?? null,
        confidence: prediction?.confidence_score == null ? 0 : Number(prediction.confidence_score),
        comparableCount: Number(prediction?.sample_size || 0),
        basis: prediction?.comparable_basis || (profile.typeId ? 'type_id' : 'legacy_text'),
        method: prediction?.prediction_method || 'no_similar_lots',
        methodVersion: METHOD_VERSION,
        abstainReason: ready ? null : prediction?.prediction_method || 'no_similar_lots',
        profile,
        fingerprint: fingerprintFor(profile),
        prediction,
    };
}

class ValuationService {
    constructor({ db = null, generator = null, clock = () => new Date() } = {}) {
        this.db = db;
        this.generator = generator || new ImprovedPredictionsGenerator();
        this.clock = clock;
        this.ownsGenerator = !generator;
        if (db) this.generator.dbClient = db;
    }

    async init() {
        if (!this.generator.dbClient) await this.generator.init();
        if (!this.db) this.db = this.generator.dbClient;
        return this;
    }

    async close() {
        if (this.ownsGenerator) await this.generator.close();
    }

    async loadLot(lotId) {
        if (!this.db) throw new Error('ValuationService is not initialized');
        const result = await this.db.query(
            `SELECT al.*,
                    linked.type_id,
                    linked.grade AS link_grade,
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
             WHERE al.id = $1`,
            [lotId],
        );
        return result.rows[0] || null;
    }

    async valuateTarget(target, at = null) {
        const prediction = await this.generator.predictPrice(target);
        return canonicalResult(prediction, target, at || this.clock());
    }

    async valuateLot(rawLot, { loadIdentity = true, valuationDate: at = null } = {}) {
        let lot = rawLot;
        const hasIdentityField = Object.hasOwn(lot, 'type_id') || Object.hasOwn(lot, 'typeId');
        if (loadIdentity && !hasIdentityField && Number.isSafeInteger(Number(lot.id))) {
            lot = await this.loadLot(Number(lot.id)) || lot;
        }
        const profile = normalizedProfile(lot, at || this.clock());
        if (profile.typeId && lot.link_quality_status !== 'conflict') {
            return this.valuateType({
                typeId: profile.typeId,
                gradeCode: profile.gradeCode,
                gradeSource: profile.gradeSource,
                slabStatus: profile.slabStatus,
                gradingCompanyCode: profile.gradingCompanyCode,
                valuationDate: at,
            });
        }
        return this.valuateTarget(lot, at);
    }

    async targetForType(typeId, {
        gradeCode = null,
        slabStatus = 'unknown',
        gradingCompanyCode = null,
    } = {}) {
        if (!this.db) throw new Error('ValuationService is not initialized');
        const representative = await this.db.query(
            `SELECT al.*, $1::integer AS type_id, ltl.grade AS link_grade
             FROM lot_type_link ltl
             JOIN auction_lots al ON al.id = ltl.lot_id
             LEFT JOIN lot_type_link_quality lq
               ON lq.lot_id = ltl.lot_id
              AND lq.type_id = ltl.type_id
              AND lq.audit_version = 'hard-consistency-v1'
             WHERE ltl.type_id = $1
               AND al.winning_bid > 0
               AND al.lot_status IS DISTINCT FROM 'active'
               AND COALESCE(lq.status, 'unverified') <> 'conflict'
             ORDER BY
               CASE WHEN $2::text IS NULL THEN 0
                    WHEN collection_normalize_grade(COALESCE(
                        NULLIF(al.slab_grade_code, ''), NULLIF(ltl.grade, ''), NULLIF(al.condition, '')
                    )) = collection_normalize_grade($2) THEN 0 ELSE 1 END,
               CASE WHEN $3::text NOT IN ('slabbed', 'raw') THEN 0
                    WHEN al.slab_status = $3 THEN 0 ELSE 1 END,
               CASE WHEN $4::text IS NULL THEN 0
                    WHEN al.grading_company_code = $4 THEN 0 ELSE 1 END,
               al.auction_end_date DESC NULLS LAST, al.id DESC
             LIMIT 1`,
            [typeId, gradeCode, slabStatus, gradingCompanyCode],
        );
        if (representative.rows[0]) {
            return {
                ...representative.rows[0],
                id: 0,
                auction_number: null,
                type_id: Number(typeId),
            };
        }
        const catalog = await this.db.query(
            `SELECT id AS type_id, name_full AS coin_description, year, metal
             FROM coin_type WHERE id = $1`,
            [typeId],
        );
        if (!catalog.rows[0]) return null;
        return {
            ...catalog.rows[0],
            id: 0,
            lot_number: `type:${typeId}`,
            auction_number: null,
            category: 'Монеты',
        };
    }

    async valuateType({
        typeId,
        gradeCode = null,
        gradeSource = 'unknown',
        slabStatus = 'unknown',
        gradingCompanyCode = null,
        valuationDate: at = null,
    }) {
        const effectiveGradeCode = gradeCode || (slabStatus === 'slabbed' ? null : 'XF');
        const effectiveGradeSource = gradeCode
            ? gradeSource
            : (effectiveGradeCode ? 'heuristic' : gradeSource);
        const target = await this.targetForType(Number(typeId), {
            gradeCode: effectiveGradeCode,
            slabStatus,
            gradingCompanyCode,
        });
        if (!target) {
            const profile = {
                typeId,
                gradeCode: effectiveGradeCode,
                gradeSource: effectiveGradeSource,
                slabStatus,
                gradingCompanyCode,
                currency: 'RUB',
            };
            return canonicalResult({ prediction_method: 'type_not_found' }, profile, at || this.clock());
        }
        target.condition = effectiveGradeCode;
        target.link_grade = effectiveGradeCode;
        target.slab_grade_code = slabStatus === 'slabbed' ? effectiveGradeCode : null;
        target.grade_source = effectiveGradeSource;
        target.slab_status = slabStatus;
        target.grading_company_code = slabStatus === 'slabbed' ? gradingCompanyCode : null;
        return this.valuateTarget(target, at);
    }

    async valuateCollectionItem(item, options = {}) {
        return this.valuateType({
            typeId: item.type_id ?? item.typeId,
            gradeCode: item.grade_code ?? item.gradeCode ?? null,
            gradeSource: item.grade_source ?? item.gradeSource ?? 'unknown',
            slabStatus: item.slab_status ?? item.slabStatus ?? 'unknown',
            gradingCompanyCode: item.grading_company_code ?? item.gradingCompanyCode ?? null,
            valuationDate: options.valuationDate,
        });
    }
}

module.exports = {
    METHOD_VERSION,
    ValuationService,
    canonicalResult,
    fingerprintFor,
    normalizedProfile,
};

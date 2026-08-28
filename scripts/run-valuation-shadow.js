'use strict';

const crypto = require('node:crypto');
const { pool } = require('../catalog/db');
const { ComparableRepository } = require('../app-v1/valuation/comparable-repository');
const { MetalAdjustment } = require('../app-v1/valuation/metal-adjustment');
const { valuateCoin } = require('../domain/valuation');
const { resolveCurrentAuctionNumber } = require('../utils/current-auction');

function options(argv) {
    const read = (name, fallback = null) => {
        const prefix = `--${name}=`;
        const value = argv.find((arg) => arg.startsWith(prefix));
        return value ? value.slice(prefix.length) : fallback;
    };
    const target = read('target', 'auction');
    const limit = Number(read('limit', '100'));
    if (!['auction', 'collection'].includes(target)) throw new Error('--target must be auction or collection');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 5000) throw new Error('--limit must be 1..5000');
    return {
        target,
        auction: read('auction'),
        limit,
        write: argv.includes('--write') && argv.includes('--confirmed'),
    };
}

function rublesToMinor(value) {
    if (value == null || !Number.isFinite(Number(value))) return null;
    return Math.round(Number(value) * 100);
}

function auctionAssetKind(row) {
    const text = `${row.category || ''} ${row.coin_description || ''}`;
    return /(?:бумага|банкнот|бон(?:а|ы|ов)?\b|paper\s+money)/iu.test(text)
        ? 'paper_money'
        : 'coin';
}

async function auctionTargets({ auction, limit }) {
    const auctionNumber = await resolveCurrentAuctionNumber(pool, auction);
    if (!auctionNumber) return [];
    const params = [auctionNumber, limit];
    const result = await pool.query(
        `SELECT al.id::text AS target_id,
                al.id AS lot_id,
                al.category,
                al.coin_description,
                ltl.type_id,
                COALESCE(NULLIF(al.slab_grade_code, ''), NULLIF(ltl.grade, ''), NULLIF(al.condition, '')) AS grade_code,
                al.grade_source,
                al.slab_status,
                al.grading_company_code,
                lpp.predicted_price AS legacy_median,
                lpp.prediction_method AS legacy_method
         FROM auction_lots al
         JOIN lot_type_link ltl ON ltl.lot_id = al.id
         LEFT JOIN lot_price_predictions lpp ON lpp.lot_id = al.id
         WHERE al.auction_number = $1
           AND COALESCE(al.category, '') !~* 'бон'
           AND COALESCE(al.coin_description, '') !~* '(бумага|банкнот|paper[[:space:]]+money)'
         ORDER BY al.id
         LIMIT $2`,
        params,
    );
    return result.rows.map((row) => ({
        targetKind: 'auction_lot',
        targetId: row.target_id,
        input: {
            typeId: Number(row.type_id),
            identityFallback: {
                lotId: Number(row.lot_id),
                assetKind: auctionAssetKind(row),
            },
            gradeCode: row.grade_code,
            gradeSource: row.grade_source,
            slabStatus: row.slab_status,
            gradingCompanyCode: row.grading_company_code,
            valuationDate: new Date(),
            currency: 'RUB',
        },
        legacyMedian: row.legacy_median == null ? null : Number(row.legacy_median),
        legacyMethod: row.legacy_method,
    }));
}

async function collectionTargets({ limit }) {
    const result = await pool.query(
        `SELECT ci.id::text AS target_id,
                ci.type_id,
                ci.grade_code,
                ci.grade_source,
                ci.slab_status,
                ci.grading_company_code,
                latest.median_minor,
                latest.method AS legacy_method
         FROM collection_item ci
         LEFT JOIN LATERAL (
             SELECT cv.median_minor, cv.method
             FROM collection_valuation cv
             WHERE cv.item_id = ci.id
             ORDER BY cv.calculated_at DESC, cv.id DESC
             LIMIT 1
         ) latest ON true
         WHERE ci.deleted_at IS NULL
         ORDER BY ci.created_at, ci.id
         LIMIT $1`,
        [limit],
    );
    return result.rows.map((row) => ({
        targetKind: 'collection_item',
        targetId: row.target_id,
        input: {
            typeId: row.type_id == null ? null : Number(row.type_id),
            gradeCode: row.grade_code,
            gradeSource: row.grade_source,
            slabStatus: row.slab_status,
            gradingCompanyCode: row.grading_company_code,
            valuationDate: new Date(),
            currency: 'RUB',
        },
        legacyMedian: row.median_minor == null ? null : Number(row.median_minor) / 100,
        legacyMethod: row.legacy_method,
    }));
}

async function save(runId, target, result) {
    await pool.query(
        `INSERT INTO valuation_shadow_result (
            run_id, target_kind, target_id, input, result, status,
            low_minor, median_minor, high_minor, confidence, basis_level,
            exact_comparable_count, expanded_comparable_count, method_version,
            legacy_median_minor, legacy_method
         ) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
            runId, target.targetKind, target.targetId, JSON.stringify(target.input), JSON.stringify(result),
            result.status, rublesToMinor(result.low), rublesToMinor(result.median), rublesToMinor(result.high),
            result.confidence, result.basisLevel, result.exactComparableCount,
            result.expandedComparableCount, result.methodVersion,
            rublesToMinor(target.legacyMedian), target.legacyMethod,
        ],
    );
}

function deltaPercent(shadow, legacy) {
    if (!(shadow > 0) || !(legacy > 0)) return null;
    return Math.round(((shadow - legacy) / legacy) * 1000) / 10;
}

async function main() {
    const config = options(process.argv.slice(2));
    const repository = new ComparableRepository({ pool });
    const metalAdjustment = new MetalAdjustment({ pool });
    const targets = config.target === 'auction'
        ? await auctionTargets(config)
        : await collectionTargets(config);
    const runId = crypto.randomUUID();
    const rows = [];
    for (const target of targets) {
        try {
            const result = await valuateCoin(target.input, {
                findComparables: (criteria) => repository.findComparables(criteria),
                resolveTypeId: (fallback) => repository.resolveTypeId(fallback),
                adjustComparables: (rows, context) => metalAdjustment.adjust(rows, context),
            });
            if (config.write) await save(runId, target, result);
            rows.push({
                targetKind: target.targetKind,
                targetId: target.targetId,
                status: result.status,
                basisLevel: result.basisLevel,
                exactComparableCount: result.exactComparableCount,
                expandedComparableCount: result.expandedComparableCount,
                legacyMedian: target.legacyMedian,
                shadowMedian: result.median,
                deltaPercent: deltaPercent(result.median, target.legacyMedian),
                abstainReason: result.abstainReason,
            });
        } catch (error) {
            const result = {
                status: 'failed', confidence: 'low', basisLevel: null,
                exactComparableCount: 0, expandedComparableCount: 0,
                methodVersion: 'slab-aware-v1-shadow', error: error.message,
            };
            if (config.write) await save(runId, target, result);
            rows.push({ targetKind: target.targetKind, targetId: target.targetId, status: 'failed', error: error.message });
        }
    }
    const summary = rows.reduce((out, row) => {
        out[row.status] = (out[row.status] || 0) + 1;
        const basis = row.basisLevel || row.abstainReason || 'none';
        out.byBasis[basis] = (out.byBasis[basis] || 0) + 1;
        return out;
    }, { mode: config.write ? 'write' : 'dry-run', runId, targets: rows.length, byBasis: {} });
    console.log(JSON.stringify({ summary, rows }, null, 2));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
}).finally(() => pool.end());

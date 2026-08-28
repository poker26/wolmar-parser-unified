'use strict';

const crypto = require('node:crypto');
const { pool } = require('../catalog/db');
const { ComparableRepository } = require('../app-v1/valuation/comparable-repository');
const { MetalAdjustment } = require('../app-v1/valuation/metal-adjustment');
const { matchType, parseTitle } = require('../catalog/coin-matcher');
const { auditLotTypeLink } = require('../domain/identity-link-quality');
const { valuateCoin } = require('../domain/valuation');

function parseOptions(argv) {
    const read = (name, fallback) => {
        const prefix = `--${name}=`;
        const found = argv.find((arg) => arg.startsWith(prefix));
        return found ? found.slice(prefix.length) : fallback;
    };
    const limit = Number(read('limit', '100'));
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error('--limit must be 1..1000');
    const from = new Date(read('from', '2026-01-01T00:00:00Z'));
    const to = new Date(read('to', new Date().toISOString()));
    const scenario = read('scenario', 'auction');
    const linkQualityPolicy = read('link-quality', 'none');
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from >= to) {
        throw new Error('--from and --to must define a valid increasing date interval');
    }
    if (!['auction', 'collection-photo'].includes(scenario)) {
        throw new Error('--scenario must be auction or collection-photo');
    }
    if (!['none', 'all-conflicts', 'denomination-only'].includes(linkQualityPolicy)) {
        throw new Error('--link-quality must be none, all-conflicts or denomination-only');
    }
    return {
        limit,
        from,
        to,
        scenario,
        linkQualityPolicy,
        seed: read('seed', 'slab-aware-v1'),
        write: argv.includes('--write') && argv.includes('--confirmed'),
        details: argv.includes('--details'),
        summaryOnly: argv.includes('--summary-only'),
        identityAudit: argv.includes('--identity-audit'),
    };
}

function minor(value) {
    return value == null || !Number.isFinite(Number(value)) ? null : Math.round(Number(value) * 100);
}

function percentile(values, fraction) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const position = (sorted.length - 1) * fraction;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    if (lower === upper) return sorted[lower];
    return sorted[lower] + ((sorted[upper] - sorted[lower]) * (position - lower));
}

async function targets(config) {
    const result = await pool.query(
        `SELECT al.id,
                al.auction_number,
                al.source_site,
                al.auction_end_date,
                al.winning_bid AS actual,
                al.category,
                al.coin_description,
                ltl.type_id,
                COALESCE(NULLIF(al.slab_grade_code, ''), NULLIF(ltl.grade, ''), NULLIF(al.condition, '')) AS grade_code,
                al.grade_source,
                al.slab_grade_code,
                al.slab_status,
                al.grading_company_code,
                ct.name_full AS type_name,
                ct.country AS type_country,
                ct.era AS type_era,
                ct.year AS type_year,
                ct.year_start AS type_year_start,
                ct.year_end AS type_year_end,
                ct.denomination_text AS type_denomination_text,
                ct.denomination_value AS type_denomination_value,
                ct.mint AS type_mint,
                ltl.match_method,
                ltl.match_confidence,
                lpp.predicted_price AS legacy_median,
                lpp.prediction_method AS legacy_method
         FROM auction_lots al
         JOIN lot_type_link ltl ON ltl.lot_id = al.id
         JOIN coin_type ct ON ct.id = ltl.type_id
         LEFT JOIN lot_price_predictions lpp ON lpp.lot_id = al.id
         WHERE al.lot_status = 'closed'
           AND al.auction_end_date >= $1
           AND al.auction_end_date < $2
           AND al.winning_bid > 0
           AND COALESCE(NULLIF(al.currency, ''), 'RUB') = 'RUB'
           AND COALESCE(al.category, '') !~* 'бон'
           AND COALESCE(al.coin_description, '') !~* '(бумага|банкнот|paper[[:space:]]+money)'
         ORDER BY md5(al.id::text || $3)
         LIMIT $4`,
        [config.from, config.to, config.seed, config.limit],
    );
    return result.rows.map((row) => {
        const collectionPhoto = config.scenario === 'collection-photo';
        const photoSlabbed = collectionPhoto && row.slab_status === 'slabbed';
        const photoGrade = photoSlabbed && row.slab_grade_code ? row.slab_grade_code : null;
        return {
            id: Number(row.id),
            source: row.source_site,
            actual: Number(row.actual),
            legacyMedian: collectionPhoto || row.legacy_median == null ? null : Number(row.legacy_median),
            legacyMethod: collectionPhoto ? null : row.legacy_method,
            audit: {
                auctionNumber: row.auction_number,
                auctionEndDate: row.auction_end_date,
                category: row.category,
                description: row.coin_description,
                typeId: Number(row.type_id),
                typeName: row.type_name,
                typeCountry: row.type_country,
                typeEra: row.type_era,
                typeYear: row.type_year == null ? null : Number(row.type_year),
                typeYearStart: row.type_year_start == null ? null : Number(row.type_year_start),
                typeYearEnd: row.type_year_end == null ? null : Number(row.type_year_end),
                typeDenominationText: row.type_denomination_text,
                typeDenominationValue: row.type_denomination_value == null
                    ? null
                    : Number(row.type_denomination_value),
                typeMint: row.type_mint,
                matchMethod: row.match_method,
                matchConfidence: row.match_confidence == null ? null : Number(row.match_confidence),
                gradeCode: row.grade_code,
                gradeSource: row.grade_source,
                slabStatus: row.slab_status,
                gradingCompanyCode: row.grading_company_code,
                scenario: config.scenario,
            },
            input: {
                typeId: Number(row.type_id),
                identityFallback: {
                    lotId: Number(row.id),
                    auctionNumber: row.auction_number,
                    assetKind: 'coin',
                },
                gradeCode: collectionPhoto ? photoGrade : row.grade_code,
                gradeSource: collectionPhoto
                    ? (photoGrade ? 'slab_label' : 'unknown')
                    : row.grade_source,
                slabStatus: collectionPhoto
                    ? (photoSlabbed ? 'slabbed' : 'raw')
                    : row.slab_status,
                gradingCompanyCode: collectionPhoto && !photoSlabbed
                    ? null
                    : row.grading_company_code,
                valuationDate: row.auction_end_date,
                currency: 'RUB',
            },
        };
    });
}

async function save(runId, target, result) {
    await pool.query(
        `INSERT INTO valuation_shadow_result (
            run_id, evaluation_kind, target_kind, target_id, input, result, status,
            low_minor, median_minor, high_minor, confidence, basis_level,
            exact_comparable_count, expanded_comparable_count, method_version,
            legacy_median_minor, legacy_method, actual_minor
         ) VALUES ($1,'backtest','auction_lot',$2,$3::jsonb,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
            runId, String(target.id), JSON.stringify(target.input),
            JSON.stringify({ ...result, actual: target.actual, targetAudit: target.audit }),
            result.status, minor(result.low), minor(result.median), minor(result.high), result.confidence,
            result.basisLevel, result.exactComparableCount, result.expandedComparableCount,
            result.methodVersion, minor(target.legacyMedian), target.legacyMethod, minor(target.actual),
        ],
    );
}

function rowMetrics(target, result) {
    const ready = result.status === 'ready' && result.median > 0;
    const ape = ready ? Math.abs(result.median - target.actual) / target.actual : null;
    const signedError = ready ? (result.median - target.actual) / target.actual : null;
    return {
        targetId: target.id,
        source: target.source,
        actual: target.actual,
        status: result.status,
        basisLevel: result.basisLevel,
        exactComparableCount: result.exactComparableCount,
        expandedComparableCount: result.expandedComparableCount,
        median: result.median,
        low: result.low,
        high: result.high,
        ape,
        signedError,
        intervalHit: ready ? target.actual >= result.low && target.actual <= result.high : null,
        legacyMedian: target.legacyMedian,
        legacyApe: target.legacyMedian > 0
            ? Math.abs(target.legacyMedian - target.actual) / target.actual
            : null,
        abstainReason: result.abstainReason,
        audit: target.audit,
    };
}

function summarize(rows, config, runId) {
    const ready = rows.filter((row) => row.ape != null);
    const apes = ready.map((row) => row.ape);
    const legacy = rows.filter((row) => row.legacyApe != null).map((row) => row.legacyApe);
    const paired = rows.filter((row) => row.ape != null && row.legacyApe != null);
    const byBasis = {};
    const byMatchMethod = {};
    const byIdentityAudit = {};
    for (const row of rows) {
        const key = row.basisLevel || row.abstainReason || 'none';
        const bucket = byBasis[key] ||= { total: 0, ready: 0, apes: [], hits: 0 };
        bucket.total++;
        if (row.ape != null) {
            bucket.ready++;
            bucket.apes.push(row.ape);
            if (row.intervalHit) bucket.hits++;
        }
        const matchKey = row.audit?.matchMethod || 'unknown';
        const matchBucket = byMatchMethod[matchKey] ||= { total: 0, ready: 0, apes: [], hits: 0 };
        matchBucket.total++;
        if (row.ape != null) {
            matchBucket.ready++;
            matchBucket.apes.push(row.ape);
            if (row.intervalHit) matchBucket.hits++;
        }
        const identityKey = row.audit?.identityAudit || 'not_run';
        const identityBucket = byIdentityAudit[identityKey] ||= { total: 0, ready: 0, apes: [], hits: 0 };
        identityBucket.total++;
        if (row.ape != null) {
            identityBucket.ready++;
            identityBucket.apes.push(row.ape);
            if (row.intervalHit) identityBucket.hits++;
        }
    }
    for (const bucket of [
        ...Object.values(byBasis),
        ...Object.values(byMatchMethod),
        ...Object.values(byIdentityAudit),
    ]) {
        bucket.mdapePercent = bucket.apes.length ? Math.round(percentile(bucket.apes, 0.5) * 1000) / 10 : null;
        bucket.intervalCoveragePercent = bucket.ready ? Math.round((bucket.hits / bucket.ready) * 1000) / 10 : null;
        delete bucket.apes;
        delete bucket.hits;
    }
    return {
        mode: config.write ? 'write' : 'dry-run',
        runId,
        from: config.from.toISOString(),
        to: config.to.toISOString(),
        scenario: config.scenario,
        linkQualityPolicy: config.linkQualityPolicy,
        seed: config.seed,
        total: rows.length,
        ready: ready.length,
        readyCoveragePercent: rows.length ? Math.round((ready.length / rows.length) * 1000) / 10 : 0,
        mdapePercent: apes.length ? Math.round(percentile(apes, 0.5) * 1000) / 10 : null,
        p90ApePercent: apes.length ? Math.round(percentile(apes, 0.9) * 1000) / 10 : null,
        meanSignedErrorPercent: ready.length
            ? Math.round((ready.reduce((sum, row) => sum + row.signedError, 0) / ready.length) * 1000) / 10
            : null,
        intervalCoveragePercent: ready.length
            ? Math.round((ready.filter((row) => row.intervalHit).length / ready.length) * 1000) / 10
            : null,
        legacyMdapePercent: legacy.length ? Math.round(percentile(legacy, 0.5) * 1000) / 10 : null,
        legacyCoverage: legacy.length,
        pairedCoverage: paired.length,
        newMdapeOnPairedPercent: paired.length
            ? Math.round(percentile(paired.map((row) => row.ape), 0.5) * 1000) / 10
            : null,
        pairedWinRatePercent: paired.length
            ? Math.round((paired.filter((row) => row.ape < row.legacyApe).length / paired.length) * 1000) / 10
            : null,
        pairedTieRatePercent: paired.length
            ? Math.round((paired.filter((row) => row.ape === row.legacyApe).length / paired.length) * 1000) / 10
            : null,
        byBasis,
        byMatchMethod,
        byIdentityAudit,
    };
}

async function auditIdentity(target) {
    try {
        const parsed = parseTitle(target.audit.description);
        const rematched = await matchType(pool, parsed);
        target.audit.rematchedTypeId = rematched?.id == null ? null : Number(rematched.id);
        target.audit.rematchConfidence = rematched?.conf == null ? null : Number(rematched.conf);
        target.audit.canonicalRematch = !rematched
            ? 'unverified'
            : Number(rematched.id) === target.audit.typeId ? 'confirmed' : 'conflict';
        const quality = auditLotTypeLink({
            lot: parsed,
            type: {
                name: target.audit.typeName,
                country: target.audit.typeCountry,
                year: target.audit.typeYear,
                yearStart: target.audit.typeYearStart,
                yearEnd: target.audit.typeYearEnd,
                denominationText: target.audit.typeDenominationText,
                denominationValue: target.audit.typeDenominationValue,
                mint: target.audit.typeMint,
            },
        });
        target.audit.identityAudit = quality.status;
        target.audit.identityAuditReasons = quality.reasons;
        target.audit.identityAuditEvidence = quality.evidence;
    } catch (error) {
        target.audit.identityAudit = 'error';
        target.audit.identityAuditError = error.message;
    }
}

async function main() {
    const config = parseOptions(process.argv.slice(2));
    const repository = new ComparableRepository({ pool, linkQualityPolicy: config.linkQualityPolicy });
    const metalAdjustment = new MetalAdjustment({ pool });
    const sample = await targets(config);
    const runId = crypto.randomUUID();
    const rows = [];
    for (let index = 0; index < sample.length; index++) {
        const target = sample[index];
        if (config.identityAudit) await auditIdentity(target);
        const result = await valuateCoin(target.input, {
            findComparables: (criteria) => repository.findComparables(criteria),
            resolveTypeId: (fallback) => repository.resolveTypeId(fallback),
            adjustComparables: (comparables, context) => metalAdjustment.adjust(comparables, context),
        });
        if (config.write) await save(runId, target, result);
        rows.push(rowMetrics(target, result));
        if ((index + 1) % 25 === 0) console.error(`processed=${index + 1}`);
    }
    const summary = summarize(rows, config, runId);
    const worst = [...rows]
        .filter((row) => row.ape != null)
        .sort((a, b) => b.ape - a.ape)
        .slice(0, 20)
        .map((row) => ({ ...row, apePercent: Math.round(row.ape * 1000) / 10, signedError: undefined }));
    const output = config.summaryOnly ? { summary } : (config.details ? { summary, rows } : { summary, worst });
    console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
}).finally(() => pool.end());

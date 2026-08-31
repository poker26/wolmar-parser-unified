'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const { Pool } = require('pg');

const root = process.env.WOLMAR_ROOT || path.resolve(__dirname, '..');
const samplePerStratum = Math.min(20, Math.max(1, Number(process.env.SAMPLE_PER_STRATUM) || 2));
const config = require(path.join(root, 'config'));
const { ValuationService } = require(path.join(root, 'valuation-service'));
const { analyzeKrauseReference } = require(
    process.env.KRAUSE_REFERENCE_MODULE || path.join(root, 'domain/krause-reference'),
);
const pool = new Pool({ ...config.dbConfig, max: 1, allowExitOnIdle: true });
const quiet = process.env.QUIET === '1';
const includeDetails = process.env.DETAILS !== '0';

function priceBucket(price) {
    if (price < 5) return 'under_5';
    if (price < 25) return '5_24';
    if (price < 100) return '25_99';
    return '100_plus';
}

function salesBucket(count) {
    return count < 10 ? '3_9' : '10_plus';
}

function quantile(sorted, fraction) {
    if (!sorted.length) return null;
    return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}

function distribution(rows) {
    const ratios = rows.map((row) => row.rub_per_krause_usd).sort((a, b) => a - b);
    return {
        count: ratios.length,
        p10: quantile(ratios, 0.10),
        p25: quantile(ratios, 0.25),
        median: quantile(ratios, 0.50),
        p75: quantile(ratios, 0.75),
        p90: quantile(ratios, 0.90),
    };
}

function metalGroup(value) {
    const metal = String(value || '').trim().toLowerCase();
    if (/(^|[^a-z])au([^a-z]|$)|gold|золот/.test(metal)) return 'gold';
    if (/(^|[^a-z])ag([^a-z]|$)|silver|сереб/.test(metal)) return 'silver';
    if (/(^|[^a-z])(pt|pd)([^a-z]|$)|platin|pallad|платин|паллад/.test(metal)) return 'other_precious';
    return 'base_or_unknown';
}

function foldFor(typeId) {
    return crypto.createHash('sha256').update(String(typeId)).digest()[0] % 5;
}

function factorMetrics(evaluated, total) {
    const factors = evaluated.map((row) => row.factor_error).sort((a, b) => a - b);
    return {
        total,
        evaluated: evaluated.length,
        coverage: total ? Number((evaluated.length / total).toFixed(3)) : null,
        median_factor_error: quantile(factors, 0.50),
        p75_factor_error: quantile(factors, 0.75),
        p90_factor_error: quantile(factors, 0.90),
        within_2x: evaluated.length
            ? Number((evaluated.filter((row) => row.factor_error <= 2).length / evaluated.length).toFixed(3))
            : null,
    };
}

function evaluateModel(train, test, segmentFor, { enforceSupport = false } = {}) {
    const grouped = new Map();
    for (const row of train) {
        const segment = segmentFor(row);
        const values = grouped.get(segment) || [];
        values.push(row);
        grouped.set(segment, values);
    }
    const model = new Map();
    for (const [segment, rows] of grouped) {
        if (rows.length < 4) continue;
        const ratios = rows.map((row) => row.rub_per_krause_usd).sort((a, b) => a - b);
        const prices = rows.map((row) => row.xf_usd).sort((a, b) => a - b);
        model.set(segment, {
            count: rows.length,
            multiplier: quantile(ratios, 0.50),
            support_low_usd: quantile(prices, 0.10),
            support_high_usd: quantile(prices, 0.90),
        });
    }
    const evaluated = [];
    for (const row of test) {
        const segment = segmentFor(row);
        const parameters = model.get(segment);
        if (!parameters) continue;
        if (enforceSupport && (
            row.xf_usd < parameters.support_low_usd || row.xf_usd > parameters.support_high_usd
        )) continue;
        const predicted = row.xf_usd * parameters.multiplier;
        evaluated.push({
            type_id: row.type_id,
            segment,
            factor_error: Number(Math.max(predicted / row.market_rub, row.market_rub / predicted).toFixed(3)),
        });
    }
    return {
        metrics: factorMetrics(evaluated, test.length),
        segments: Object.fromEntries([...model.entries()].sort(([left], [right]) => left.localeCompare(right))),
        evaluated,
    };
}

function crossValidate(rows, segmentFor, { enforceSupport = false } = {}) {
    const evaluated = [];
    for (let fold = 0; fold < 5; fold += 1) {
        const train = rows.filter((row) => foldFor(row.type_id) !== fold);
        const test = rows.filter((row) => foldFor(row.type_id) === fold);
        evaluated.push(...evaluateModel(train, test, segmentFor, { enforceSupport }).evaluated);
    }
    return factorMetrics(evaluated, rows.length);
}

async function withoutGeneratorLogs(operation) {
    if (!quiet) return operation();
    const log = console.log;
    console.log = () => {};
    try {
        return await operation();
    } finally {
        console.log = log;
    }
}

async function candidates() {
    const result = await pool.query(`
        WITH eligible AS (
            SELECT ltl.type_id, count(*)::int count
            FROM lot_type_link ltl
            JOIN auction_lots al ON al.id = ltl.lot_id
            LEFT JOIN lot_type_link_quality lq
              ON lq.lot_id = ltl.lot_id
             AND lq.type_id = ltl.type_id
             AND lq.audit_version = 'hard-consistency-v1'
            WHERE al.winning_bid > 0
              AND al.lot_status IS DISTINCT FROM 'active'
              AND (al.auction_end_date IS NULL OR al.auction_end_date < now())
              AND COALESCE(lq.status, 'unverified') <> 'conflict'
            GROUP BY ltl.type_id
            HAVING count(*) >= 3
        )
        SELECT ct.id, ct.name_full, ct.country, ct.year, ct.ref_source, ct.metal,
               ct.ref_issues, e.count AS eligible_sales
        FROM coin_type ct
        JOIN eligible e ON e.type_id = ct.id
        WHERE ct.ref_source LIKE 'scwc%'
          AND jsonb_typeof(ct.ref_issues) = 'array'
          AND jsonb_array_length(ct.ref_issues) > 0
        ORDER BY md5(ct.id::text)
    `);
    const strata = new Map();
    for (const row of result.rows) {
        const analysis = analyzeKrauseReference(row.ref_issues);
        if (!analysis.usableXf) continue;
        const xf = analysis.xf.usd;
        const stratum = `${row.ref_source}:${priceBucket(xf)}:${salesBucket(row.eligible_sales)}`;
        const selected = strata.get(stratum) || [];
        if (selected.length < samplePerStratum) {
            selected.push({ ...row, xf_usd: xf, stratum });
            strata.set(stratum, selected);
        }
    }
    return [...strata.values()].flat();
}

async function main() {
    const selected = await candidates();
    const service = new ValuationService({ db: pool });
    const ready = [];
    const abstained = [];
    for (const row of selected) {
        const result = await withoutGeneratorLogs(() => service.valuateType({
            typeId: Number(row.id),
            gradeCode: 'XF',
            gradeSource: 'heuristic',
            slabStatus: 'unknown',
        }));
        if (result.status !== 'ready' || !(result.median > 0)) {
            abstained.push({
                type_id: row.id,
                name: row.name_full,
                stratum: row.stratum,
                eligible_sales: row.eligible_sales,
                reason: result.abstainReason,
                comparable_count: result.comparableCount,
            });
            continue;
        }
        ready.push({
            type_id: row.id,
            name: row.name_full,
            country: row.country,
            year: row.year,
            metal: row.metal,
            metal_group: metalGroup(row.metal),
            source: row.ref_source,
            stratum: row.stratum,
            eligible_sales: row.eligible_sales,
            comparable_count: result.comparableCount,
            confidence: result.confidence,
            xf_usd: row.xf_usd,
            market_rub: result.median,
            rub_per_krause_usd: Number((result.median / row.xf_usd).toFixed(2)),
            metal_floor_applied: result.prediction?.metal_floor_applied === true,
        });
    }

    const withoutMetalFloor = ready.filter((row) => !row.metal_floor_applied);
    const strongMarketEvidence = withoutMetalFloor.filter((row) => (
        row.comparable_count >= 5 && row.confidence >= 0.75
    ));
    const segmentFor = (row) => `${priceBucket(row.xf_usd)}:${row.metal_group}`;
    const globalCrossValidation = crossValidate(strongMarketEvidence, () => 'all');
    const segmentedCrossValidation = crossValidate(
        strongMarketEvidence,
        segmentFor,
    );
    const supportedSegmentedCrossValidation = crossValidate(
        strongMarketEvidence,
        segmentFor,
        { enforceSupport: true },
    );
    const fittedSegments = evaluateModel(
        strongMarketEvidence,
        [],
        (row) => `${priceBucket(row.xf_usd)}:${row.metal_group}`,
    ).segments;
    const byPriceBucket = {};
    for (const bucket of ['under_5', '5_24', '25_99', '100_plus']) {
        byPriceBucket[bucket] = distribution(withoutMetalFloor.filter((row) => (
            priceBucket(row.xf_usd) === bucket
        )));
    }
    const output = {
        config: { sample_per_stratum: samplePerStratum, selected: selected.length },
        summary: {
            ready: ready.length,
            abstained: abstained.length,
            metal_floor_cases: ready.length - withoutMetalFloor.length,
            rub_per_krause_usd: distribution(ready),
            rub_per_krause_usd_without_metal_floor: distribution(withoutMetalFloor),
            rub_per_krause_usd_with_strong_market_evidence: distribution(strongMarketEvidence),
            by_krause_price_bucket_without_metal_floor: byPriceBucket,
            five_fold_cross_validation: {
                pairs: strongMarketEvidence.length,
                global_multiplier: globalCrossValidation,
                price_and_metal_segments: segmentedCrossValidation,
                price_and_metal_segments_in_support: supportedSegmentedCrossValidation,
            },
        },
        fitted_segments: fittedSegments,
    };
    if (includeDetails) {
        output.ready = ready;
        output.abstained = abstained;
    }
    console.log(JSON.stringify(output, null, 2));
}

main()
    .finally(() => pool.end())
    .catch((error) => {
        console.error(`${error.name}: ${error.message}`);
        process.exitCode = 1;
    });

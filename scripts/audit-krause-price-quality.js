'use strict';

const path = require('node:path');
const { Pool } = require('pg');

const root = process.env.WOLMAR_ROOT || path.resolve(__dirname, '..');
const config = require(path.join(root, 'config'));
const { analyzeKrauseReference } = require(
    process.env.KRAUSE_REFERENCE_MODULE || path.join(root, 'domain/krause-reference'),
);
const pool = new Pool({ ...config.dbConfig, max: 1, allowExitOnIdle: true });
const requestedExampleLimit = Number(process.env.EXAMPLE_LIMIT);
const exampleLimit = Number.isFinite(requestedExampleLimit)
    ? Math.min(50, Math.max(0, requestedExampleLimit))
    : 10;

async function main() {
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
        )
        SELECT ct.id, ct.name_full, ct.country, ct.year, ct.ref_source,
               ct.ref_issues, COALESCE(e.count, 0)::int AS eligible_sales
        FROM coin_type ct
        LEFT JOIN eligible e ON e.type_id = ct.id
        WHERE ct.ref_source LIKE 'scwc%'
          AND jsonb_typeof(ct.ref_issues) = 'array'
          AND jsonb_array_length(ct.ref_issues) > 0
        ORDER BY ct.id
    `);

    const bySource = new Map();
    const anomalies = [];
    let withXf = 0;
    let cleanWithXf = 0;
    let cleanWithXfWithoutSales = 0;
    let withEligibleSales = 0;
    let withPrices = 0;
    const xfValues = [];

    for (const row of result.rows) {
        const analysis = analyzeKrauseReference(row.ref_issues);
        if (analysis.aggregate.length) withPrices += 1;
        const hasAnomaly = analysis.invalidPriceCount > 0
            || analysis.issueViolations.length > 0
            || analysis.aggregateViolations.length > 0;
        const directXf = analysis.xf?.usd ?? null;
        const source = row.ref_source || '<null>';
        const sourceStats = bySource.get(source) || {
            types_with_issues: 0,
            types_with_prices: 0,
            with_xf: 0,
            quality_gate_failures: 0,
            with_eligible_sales: 0,
        };
        sourceStats.types_with_issues += 1;
        if (analysis.aggregate.length) sourceStats.types_with_prices += 1;
        if (directXf != null) sourceStats.with_xf += 1;
        if (hasAnomaly) sourceStats.quality_gate_failures += 1;
        if (row.eligible_sales > 0) sourceStats.with_eligible_sales += 1;
        bySource.set(source, sourceStats);

        if (directXf != null) {
            withXf += 1;
            xfValues.push(directXf);
        }
        if (row.eligible_sales > 0) withEligibleSales += 1;
        if (analysis.usableXf) {
            cleanWithXf += 1;
            if (row.eligible_sales === 0) cleanWithXfWithoutSales += 1;
        }
        if (hasAnomaly && anomalies.length < exampleLimit) {
            anomalies.push({
                id: row.id,
                name: row.name_full,
                country: row.country,
                year: row.year,
                source,
                eligible_sales: row.eligible_sales,
                aggregate_prices: analysis.aggregate,
                invalid_price_count: analysis.invalidPriceCount,
                issue_violations: analysis.issueViolations,
                aggregate_violations: analysis.aggregateViolations,
            });
        }
    }

    const sourceSummary = Object.fromEntries([...bySource.entries()].sort((left, right) => (
        right[1].types_with_issues - left[1].types_with_issues || left[0].localeCompare(right[0])
    )));
    xfValues.sort((left, right) => left - right);
    const percentile = (fraction) => xfValues.length
        ? xfValues[Math.floor((xfValues.length - 1) * fraction)]
        : null;
    console.log(JSON.stringify({
        summary: {
            krause_types_with_issues: result.rows.length,
            krause_types_with_prices: withPrices,
            with_direct_xf_price: withXf,
            quality_gate_failure_types: [...bySource.values()]
                .reduce((sum, source) => sum + source.quality_gate_failures, 0),
            clean_with_direct_xf_price: cleanWithXf,
            clean_with_direct_xf_and_no_eligible_sales: cleanWithXfWithoutSales,
            with_eligible_sales: withEligibleSales,
            xf_usd_distribution: {
                p01: percentile(0.01), p10: percentile(0.10), median: percentile(0.50),
                p90: percentile(0.90), p99: percentile(0.99), max: percentile(1),
            },
        },
        by_source: sourceSummary,
        anomaly_examples: anomalies,
    }, null, 2));
}

main()
    .finally(() => pool.end())
    .catch((error) => {
        console.error(`${error.name}: ${error.message}`);
        process.exitCode = 1;
    });

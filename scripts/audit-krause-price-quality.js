'use strict';

const path = require('node:path');
const { Pool } = require('pg');

const root = process.env.WOLMAR_ROOT || path.resolve(__dirname, '..');
const config = require(path.join(root, 'config'));
const pool = new Pool({ ...config.dbConfig, max: 1, allowExitOnIdle: true });

const CIRCULATION_GRADE_RANK = new Map([
    ['AG3', 10], ['G4', 20], ['VG8', 30], ['F', 40], ['F12', 40],
    ['VF', 50], ['VF20', 50], ['XF', 60], ['XF40', 60], ['AU', 70], ['AU50', 70],
    ['UNC', 80], ['MS60', 80], ['MS63', 83], ['MS65', 85], ['BU', 90],
]);
const XF_KEYS = ['XF40', 'XF'];
const requestedExampleLimit = Number(process.env.EXAMPLE_LIMIT);
const exampleLimit = Number.isFinite(requestedExampleLimit)
    ? Math.min(50, Math.max(0, requestedExampleLimit))
    : 10;

function normalizeKey(key) {
    return String(key).trim().toUpperCase().replaceAll(' ', '');
}

function numericPrices(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    return Object.entries(value)
        .map(([key, price]) => ({ key: normalizeKey(key), price: Number(price) }))
        .filter(({ price }) => Number.isFinite(price) && price > 0);
}

function circulationAnomalies(prices) {
    const ranked = prices
        .map((price) => ({ ...price, rank: CIRCULATION_GRADE_RANK.get(price.key) }))
        .filter(({ rank }) => rank != null)
        .sort((left, right) => left.rank - right.rank || left.key.localeCompare(right.key));
    const anomalies = [];
    let maximum = null;
    for (const current of ranked) {
        if (maximum && current.rank > maximum.rank && current.price < maximum.price) {
            anomalies.push({ lower: maximum, higher: current });
        }
        if (!maximum || current.price > maximum.price) maximum = current;
    }
    return anomalies;
}

function xfPrice(prices) {
    for (const key of XF_KEYS) {
        const match = prices.find((price) => price.key === key);
        if (match) return match.price;
    }
    return null;
}

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
               ct.ref_prices, COALESCE(e.count, 0)::int AS eligible_sales
        FROM coin_type ct
        LEFT JOIN eligible e ON e.type_id = ct.id
        WHERE ct.ref_source LIKE 'scwc%'
          AND ct.ref_prices IS NOT NULL
          AND ct.ref_prices <> '{}'::jsonb
        ORDER BY ct.id
    `);

    const bySource = new Map();
    const anomalies = [];
    let withXf = 0;
    let cleanWithXf = 0;
    let cleanWithXfWithoutSales = 0;
    let withEligibleSales = 0;

    for (const row of result.rows) {
        const prices = numericPrices(row.ref_prices);
        const rowAnomalies = circulationAnomalies(prices);
        const directXf = xfPrice(prices);
        const source = row.ref_source || '<null>';
        const sourceStats = bySource.get(source) || {
            types: 0,
            with_xf: 0,
            monotonic_anomalies: 0,
            with_eligible_sales: 0,
        };
        sourceStats.types += 1;
        if (directXf != null) sourceStats.with_xf += 1;
        if (rowAnomalies.length) sourceStats.monotonic_anomalies += 1;
        if (row.eligible_sales > 0) sourceStats.with_eligible_sales += 1;
        bySource.set(source, sourceStats);

        if (directXf != null) withXf += 1;
        if (row.eligible_sales > 0) withEligibleSales += 1;
        if (!rowAnomalies.length && directXf != null) {
            cleanWithXf += 1;
            if (row.eligible_sales === 0) cleanWithXfWithoutSales += 1;
        }
        if (rowAnomalies.length && anomalies.length < exampleLimit) {
            anomalies.push({
                id: row.id,
                name: row.name_full,
                country: row.country,
                year: row.year,
                source,
                eligible_sales: row.eligible_sales,
                prices: row.ref_prices,
                violations: rowAnomalies,
            });
        }
    }

    const sourceSummary = Object.fromEntries([...bySource.entries()].sort((left, right) => (
        right[1].types - left[1].types || left[0].localeCompare(right[0])
    )));
    console.log(JSON.stringify({
        summary: {
            krause_types_with_prices: result.rows.length,
            with_direct_xf_price: withXf,
            monotonic_anomaly_types: [...bySource.values()]
                .reduce((sum, source) => sum + source.monotonic_anomalies, 0),
            clean_with_direct_xf_price: cleanWithXf,
            clean_with_direct_xf_and_no_eligible_sales: cleanWithXfWithoutSales,
            with_eligible_sales: withEligibleSales,
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

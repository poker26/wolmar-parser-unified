'use strict';

const path = require('node:path');
const { Pool } = require('pg');

const root = process.env.WOLMAR_ROOT || path.resolve(__dirname, '..');
const samplePerStratum = Math.min(5, Math.max(1, Number(process.env.SAMPLE_PER_STRATUM) || 2));
const config = require(path.join(root, 'config'));
const { ValuationService } = require(path.join(root, 'valuation-service'));
const pool = new Pool({ ...config.dbConfig, max: 1, allowExitOnIdle: true });
const quiet = process.env.QUIET === '1';
const includeDetails = process.env.DETAILS !== '0';

const GRADE_RANK = new Map([
    ['AG3', 10], ['G4', 20], ['VG8', 30], ['F', 40], ['F12', 40],
    ['VF', 50], ['VF20', 50], ['XF', 60], ['XF40', 60], ['AU', 70], ['AU50', 70],
    ['UNC', 80], ['MS60', 80], ['MS63', 83], ['MS65', 85], ['BU', 90],
]);

function prices(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    return Object.entries(value)
        .map(([key, price]) => ({
            key: String(key).trim().toUpperCase().replaceAll(' ', ''),
            price: Number(price),
        }))
        .filter(({ price }) => Number.isFinite(price) && price > 0);
}

function directXf(entries) {
    return entries.find(({ key }) => key === 'XF40')?.price
        ?? entries.find(({ key }) => key === 'XF')?.price
        ?? null;
}

function isMonotonic(entries) {
    const ranked = entries
        .map((entry) => ({ ...entry, rank: GRADE_RANK.get(entry.key) }))
        .filter(({ rank }) => rank != null)
        .sort((left, right) => left.rank - right.rank || left.key.localeCompare(right.key));
    let maximum = null;
    for (const current of ranked) {
        if (maximum && current.rank > maximum.rank && current.price < maximum.price) return false;
        if (!maximum || current.price > maximum.price) maximum = current;
    }
    return true;
}

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
        SELECT ct.id, ct.name_full, ct.country, ct.year, ct.ref_source,
               ct.ref_prices, e.count AS eligible_sales
        FROM coin_type ct
        JOIN eligible e ON e.type_id = ct.id
        WHERE ct.ref_source LIKE 'scwc%'
          AND ct.ref_prices IS NOT NULL
          AND ct.ref_prices <> '{}'::jsonb
        ORDER BY md5(ct.id::text)
    `);
    const strata = new Map();
    for (const row of result.rows) {
        const entries = prices(row.ref_prices);
        const xf = directXf(entries);
        if (xf == null || !isMonotonic(entries)) continue;
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
        },
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

'use strict';

const ImprovedPredictionsGenerator = require('../improved-predictions-generator');
const { resolveCurrentAuctionNumber } = require('../utils/current-auction');

function option(name, fallback) {
    const prefix = `--${name}=`;
    const arg = process.argv.slice(2).find((value) => value.startsWith(prefix));
    return arg ? arg.slice(prefix.length) : fallback;
}

function relativeDelta(candidate, baseline) {
    if (!(candidate > 0) || !(baseline > 0)) return null;
    return Math.round(((candidate - baseline) / baseline) * 1000) / 10;
}

function median(values) {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

async function quiet(call) {
    const original = console.log;
    console.log = () => {};
    try {
        return await call();
    } finally {
        console.log = original;
    }
}

async function main() {
    const limit = Math.max(1, Math.min(200, Number(option('limit', '30')) || 30));
    const generator = new ImprovedPredictionsGenerator();
    await generator.init();
    try {
        const auctionNumber = await resolveCurrentAuctionNumber(
            generator.dbClient,
            option('auction', null),
        );
        if (!auctionNumber) throw new Error('auction not found');
        const sample = await generator.dbClient.query(
            `SELECT al.id, al.lot_number, al.condition, al.metal, al.weight,
                    al.fineness, al.pure_metal_weight, al.year, al.letters,
                    al.winning_bid, al.coin_description, al.auction_number,
                    al.category, al.auction_end_date, al.slab_status,
                    al.grading_company_code, al.slab_grade_code, al.grade_source,
                    linked.type_id, linked.grade AS link_grade,
                    linked.link_quality_status,
                    lpp.predicted_price AS stored_prediction
             FROM auction_lots al
             JOIN LATERAL (
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
             LEFT JOIN lot_price_predictions lpp ON lpp.lot_id = al.id
             WHERE al.auction_number = $1
             ORDER BY md5(al.id::text || 'unified-valuation-v1')
             LIMIT $2`,
            [String(auctionNumber), limit],
        );

        const rows = [];
        for (const lot of sample.rows) {
            const legacyInput = { ...lot };
            delete legacyInput.type_id;
            delete legacyInput.link_grade;
            const legacy = await quiet(() => generator.predictPrice(legacyInput));
            const unified = await quiet(() => generator.predictPrice(lot));
            rows.push({
                lotId: Number(lot.id),
                lotNumber: lot.lot_number,
                typeId: Number(lot.type_id),
                grade: lot.slab_grade_code || lot.link_grade || lot.condition || null,
                slabStatus: lot.slab_status,
                stored: lot.stored_prediction == null ? null : Number(lot.stored_prediction),
                legacy: legacy.predicted_price,
                unified: unified.predicted_price,
                legacyCount: legacy.sample_size,
                unifiedCount: unified.sample_size,
                basis: unified.comparable_basis,
                deltaPercent: relativeDelta(unified.predicted_price, legacy.predicted_price),
            });
        }

        const paired = rows.filter((row) => row.legacy > 0 && row.unified > 0);
        const summary = {
            auctionNumber,
            sampled: rows.length,
            legacyReady: rows.filter((row) => row.legacy > 0).length,
            unifiedReady: rows.filter((row) => row.unified > 0).length,
            paired: paired.length,
            exactSame: paired.filter((row) => row.legacy === row.unified).length,
            medianAbsoluteDeltaPercent: median(paired.map((row) => Math.abs(row.deltaPercent))),
            lostCoverage: rows.filter((row) => row.legacy > 0 && !(row.unified > 0)).length,
            gainedCoverage: rows.filter((row) => !(row.legacy > 0) && row.unified > 0).length,
        };
        const largestChanges = paired
            .slice()
            .sort((a, b) => Math.abs(b.deltaPercent) - Math.abs(a.deltaPercent))
            .slice(0, 15);
        console.log(JSON.stringify({ summary, largestChanges, rows }, null, 2));
    } finally {
        await generator.close();
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

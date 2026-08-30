'use strict';

const ImprovedPredictionsGenerator = require('../improved-predictions-generator');

const DEFAULT_IDS = [4917767, 4917835, 4918565, 4919916, 4919787, 4918058];

function stats(rows) {
    const prices = rows.map((row) => Number(row.winning_bid)).filter((value) => value > 0).sort((a, b) => a - b);
    const at = (fraction) => prices.length ? prices[Math.floor((prices.length - 1) * fraction)] : null;
    return {
        count: prices.length,
        min: prices[0] ?? null,
        p25: at(0.25),
        median: at(0.5),
        p75: at(0.75),
        max: prices.at(-1) ?? null,
    };
}

async function main() {
    const requested = process.argv.slice(2)
        .filter((arg) => /^\d+$/.test(arg))
        .map(Number);
    const ids = requested.length ? requested : DEFAULT_IDS;
    const generator = new ImprovedPredictionsGenerator();
    await generator.init();
    try {
        const result = await generator.dbClient.query(
            `SELECT al.*, linked.type_id, linked.grade AS link_grade,
                    linked.match_method, linked.match_confidence,
                    lq.status AS quality_status, lq.reasons AS quality_reasons,
                    ct.name_full AS type_name, ct.year AS type_year,
                    ct.denomination_text AS type_denomination
             FROM auction_lots al
             JOIN LATERAL (
                 SELECT ltl.type_id, ltl.grade, ltl.match_method, ltl.match_confidence
                 FROM lot_type_link ltl
                 WHERE ltl.lot_id = al.id
                 ORDER BY ltl.id
                 LIMIT 1
             ) linked ON true
             JOIN coin_type ct ON ct.id = linked.type_id
             LEFT JOIN lot_type_link_quality lq
               ON lq.lot_id = al.id
              AND lq.type_id = linked.type_id
              AND lq.audit_version = 'hard-consistency-v1'
             WHERE al.id = ANY($1::bigint[])
             ORDER BY array_position($1::bigint[], al.id)`,
            [ids],
        );
        const output = [];
        for (const lot of result.rows) {
            const legacyInput = { ...lot };
            delete legacyInput.type_id;
            delete legacyInput.link_grade;
            const legacyRows = await generator.findSimilarLots(legacyInput);
            const typeRows = await generator.findSimilarLotsByType(lot);
            output.push({
                lotId: Number(lot.id),
                lotNumber: lot.lot_number,
                title: lot.coin_description,
                grade: lot.slab_grade_code || lot.link_grade || lot.condition || null,
                slabStatus: lot.slab_status,
                gradingCompany: lot.grading_company_code,
                typeId: Number(lot.type_id),
                typeName: lot.type_name,
                typeYear: lot.type_year,
                typeDenomination: lot.type_denomination,
                matchMethod: lot.match_method,
                matchConfidence: lot.match_confidence == null ? null : Number(lot.match_confidence),
                qualityStatus: lot.quality_status,
                qualityReasons: lot.quality_reasons,
                legacy: stats(legacyRows),
                typeBased: stats(typeRows),
                typeBasis: generator._lastMatchBasis,
                legacyRecent: legacyRows.slice(0, 8).map((row) => ({
                    id: Number(row.id), title: row.coin_description, price: Number(row.winning_bid),
                    grade: row.slab_grade_code || row.condition || null,
                })),
                typeRecent: typeRows.slice(0, 8).map((row) => ({
                    id: Number(row.id), title: row.coin_description, price: Number(row.winning_bid),
                    grade: row.slab_grade_code || row.condition || null,
                })),
            });
        }
        const printable = process.argv.includes('--links-only')
            ? output.map((row) => ({
                lotId: row.lotId,
                title: row.title,
                typeId: row.typeId,
                typeName: row.typeName,
                matchMethod: row.matchMethod,
                matchConfidence: row.matchConfidence,
                qualityStatus: row.qualityStatus,
                qualityReasons: row.qualityReasons,
                legacyCount: row.legacy.count,
                typeCount: row.typeBased.count,
            }))
            : output;
        console.log(JSON.stringify(printable, null, 2));
    } finally {
        await generator.close();
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

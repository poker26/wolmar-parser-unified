'use strict';

const path = require('path');
const { Pool } = require('pg');

const root = process.env.WOLMAR_ROOT;
if (!root) throw new Error('WOLMAR_ROOT is required');
const typeIds = (process.env.TYPE_IDS || '')
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isSafeInteger(value) && value > 0);
if (!typeIds.length) throw new Error('TYPE_IDS is required');

const config = require(path.join(root, 'config'));
const { ValuationService } = require(path.join(root, 'valuation-service'));
const pool = new Pool({ ...config.dbConfig, max: 1, allowExitOnIdle: true });

function priceFields(row) {
    return {
        id: row.id,
        lot_number: row.lot_number,
        source: row.source,
        coin_description: row.coin_description,
        winning_bid: row.winning_bid,
        auction_end_date: row.auction_end_date,
        metal: row.metal,
        weight: row.weight,
        fineness: row.fineness,
        pure_metal_weight: row.pure_metal_weight,
        slab_status: row.slab_status,
        slab_grade_code: row.slab_grade_code,
        condition: row.condition,
        link_grade: row.link_grade,
    };
}

async function main() {
    const service = new ValuationService({ db: pool });
    const output = [];
    for (const typeId of typeIds) {
        const target = await service.targetForType(typeId, {
            gradeCode: 'XF', slabStatus: 'unknown', gradingCompanyCode: null,
        });
        target.condition = 'XF';
        target.link_grade = 'XF';
        target.grade_source = 'heuristic';
        target.slab_status = 'unknown';
        target.grading_company_code = null;
        target.valuation_identity_scope = 'type';
        const comparables = await service.generator.findSimilarLotsByType(target);
        const details = comparables.length
            ? await pool.query(`
                SELECT id, auction_number, lot_number, winning_bid, auction_end_date,
                       source_url, lot_status, condition, metal, weight,
                       fineness, pure_metal_weight, slab_status, slab_grade_code
                FROM auction_lots
                WHERE id = ANY($1::int[])
                ORDER BY auction_end_date DESC NULLS LAST, id DESC
            `, [comparables.map((row) => Number(row.id))])
            : { rows: [] };
        const detailsById = new Map(details.rows.map((row) => [Number(row.id), row]));
        const comparableInputs = [];
        for (const row of comparables) {
            comparableInputs.push({
                ...priceFields(row),
                ...detailsById.get(Number(row.id)),
                melt_value_rub: await service.generator.meltValue(row, target.metal, target),
            });
        }
        output.push({
            type_id: typeId,
            target: {
                ...priceFields(target),
                melt_value_rub: await service.generator.meltValue(target),
            },
            basis: service.generator._lastMatchBasis,
            exact_count: service.generator._lastExactComparableCount,
            comparable_count: comparableInputs.length,
            comparables: comparableInputs,
        });
    }
    console.log(JSON.stringify(output, null, 2));
}

main()
    .finally(() => pool.end())
    .catch((error) => {
        console.error(`${error.name}: ${error.message}`);
        process.exitCode = 1;
    });

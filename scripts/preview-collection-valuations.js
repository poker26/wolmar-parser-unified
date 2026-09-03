'use strict';

const path = require('path');
const { Pool } = require('pg');

const root = process.env.WOLMAR_ROOT;
if (!root) throw new Error('WOLMAR_ROOT is required');

const config = require(path.join(root, 'config'));
const { ValuationService } = require(path.join(root, 'valuation-service'));
const pool = new Pool({ ...config.dbConfig, max: 1, allowExitOnIdle: true });

async function main() {
    const items = await pool.query(`
        SELECT ci.id, ci.type_id, ci.grade_code, ci.grade_source,
               ci.slab_status, ci.grading_company_code, ci.created_at,
               ct.name_full AS catalog_name,
               latest.status AS stored_status,
               latest.median_minor AS stored_median_minor,
               latest.comparable_count AS stored_comparable_count,
               latest.abstain_reason AS stored_abstain_reason,
               latest.calculated_at AS stored_calculated_at,
               history.snapshot_count
        FROM collection_item ci
        LEFT JOIN coin_type ct ON ct.id = ci.type_id
        LEFT JOIN LATERAL (
            SELECT cv.status, cv.median_minor, cv.comparable_count,
                   cv.abstain_reason, cv.calculated_at
            FROM collection_valuation cv
            WHERE cv.item_id = ci.id
            ORDER BY cv.calculated_at DESC, cv.id DESC
            LIMIT 1
        ) latest ON true
        LEFT JOIN LATERAL (
            SELECT count(*)::int AS snapshot_count
            FROM collection_valuation cv
            WHERE cv.item_id = ci.id
        ) history ON true
        WHERE ci.deleted_at IS NULL
        ORDER BY ci.created_at
    `);

    const service = new ValuationService({ db: pool });
    const output = [];
    for (const item of items.rows) {
        const preview = item.type_id
            ? await service.valuateCollectionItem(item)
            : null;
        output.push({
            item_id: item.id,
            type_id: item.type_id,
            catalog_name: item.catalog_name,
            identity: {
                grade_code: item.grade_code,
                grade_source: item.grade_source,
                slab_status: item.slab_status,
                grading_company_code: item.grading_company_code,
            },
            stored: {
                snapshot_count: item.snapshot_count,
                status: item.stored_status,
                median_minor: item.stored_median_minor,
                comparable_count: item.stored_comparable_count,
                abstain_reason: item.stored_abstain_reason,
                calculated_at: item.stored_calculated_at,
            },
            preview: preview && {
                status: preview.status,
                low_rub: preview.low,
                median_rub: preview.median,
                high_rub: preview.high,
                confidence: preview.confidence,
                comparable_count: preview.comparableCount,
                basis: preview.basis,
                method: preview.method,
                abstain_reason: preview.abstainReason,
                metal_value_rub: preview.prediction?.metal_value ?? null,
                numismatic_premium_rub: preview.prediction?.numismatic_premium ?? null,
                metal_floor_applied: preview.prediction?.metal_floor_applied ?? false,
                comparable_lot_ids: preview.prediction?.comparable_lot_ids || [],
            },
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

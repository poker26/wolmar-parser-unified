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
const pool = new Pool({ ...config.dbConfig, max: 1, allowExitOnIdle: true });

async function main() {
    const catalog = await pool.query(`
        SELECT id, name_full, metal, mass, composition
        FROM coin_type
        WHERE id = ANY($1::int[])
        ORDER BY id
    `, [typeIds]);
    const summary = await pool.query(`
        SELECT ltl.type_id,
               count(*)::int AS linked,
               count(*) FILTER (WHERE al.winning_bid > 0)::int AS positive_bid,
               count(*) FILTER (WHERE al.weight > 0)::int AS weight_known,
               count(*) FILTER (WHERE al.pure_metal_weight > 0)::int AS pure_weight_known,
               count(*) FILTER (
                   WHERE al.winning_bid > 0
                     AND al.lot_status IS DISTINCT FROM 'active'
                     AND (al.auction_end_date IS NULL OR al.auction_end_date < now())
                     AND COALESCE(lq.status, 'unverified') <> 'conflict'
               )::int AS valuation_eligible,
               count(*) FILTER (
                   WHERE al.winning_bid > 0
                     AND al.lot_status IS DISTINCT FROM 'active'
                     AND (al.auction_end_date IS NULL OR al.auction_end_date < now())
                     AND COALESCE(lq.status, 'unverified') <> 'conflict'
                     AND collection_normalize_grade(COALESCE(
                         NULLIF(al.slab_grade_code, ''), NULLIF(ltl.grade, ''), NULLIF(al.condition, '')
                     )) = collection_normalize_grade('XF')
               )::int AS xf_eligible
        FROM lot_type_link ltl
        JOIN auction_lots al ON al.id = ltl.lot_id
        LEFT JOIN lot_type_link_quality lq
          ON lq.lot_id = ltl.lot_id
         AND lq.type_id = ltl.type_id
         AND lq.audit_version = 'hard-consistency-v1'
        WHERE ltl.type_id = ANY($1::int[])
        GROUP BY ltl.type_id
        ORDER BY ltl.type_id
    `, [typeIds]);
    const physical = await pool.query(`
        SELECT ltl.type_id,
               mode() WITHIN GROUP (ORDER BY al.metal)
                   FILTER (WHERE al.metal IS NOT NULL) AS metal_mode,
               percentile_disc(0.5) WITHIN GROUP (ORDER BY al.weight)
                   FILTER (WHERE al.weight > 0) AS weight_median,
               percentile_disc(0.5) WITHIN GROUP (ORDER BY al.fineness)
                   FILTER (WHERE al.fineness > 0) AS fineness_median,
               percentile_disc(0.5) WITHIN GROUP (ORDER BY al.pure_metal_weight)
                   FILTER (WHERE al.pure_metal_weight > 0) AS pure_weight_median,
               min(al.pure_metal_weight) FILTER (WHERE al.pure_metal_weight > 0) AS pure_weight_min,
               max(al.pure_metal_weight) FILTER (WHERE al.pure_metal_weight > 0) AS pure_weight_max
        FROM lot_type_link ltl
        JOIN auction_lots al ON al.id = ltl.lot_id
        LEFT JOIN lot_type_link_quality lq
          ON lq.lot_id = ltl.lot_id
         AND lq.type_id = ltl.type_id
         AND lq.audit_version = 'hard-consistency-v1'
        WHERE ltl.type_id = ANY($1::int[])
          AND COALESCE(lq.status, 'unverified') <> 'conflict'
        GROUP BY ltl.type_id
        ORDER BY ltl.type_id
    `, [typeIds]);
    const grades = await pool.query(`
        SELECT ltl.type_id,
               COALESCE(collection_normalize_grade(COALESCE(
                   NULLIF(al.slab_grade_code, ''), NULLIF(ltl.grade, ''), NULLIF(al.condition, '')
               )), '<null>') AS normalized_grade,
               COALESCE(al.slab_status, '<null>') AS slab_status,
               COALESCE(lq.status, 'unverified') AS quality_status,
               count(*)::int AS count,
               min(al.winning_bid) FILTER (WHERE al.winning_bid > 0) AS min_bid,
               max(al.winning_bid) FILTER (WHERE al.winning_bid > 0) AS max_bid
        FROM lot_type_link ltl
        JOIN auction_lots al ON al.id = ltl.lot_id
        LEFT JOIN lot_type_link_quality lq
          ON lq.lot_id = ltl.lot_id
         AND lq.type_id = ltl.type_id
         AND lq.audit_version = 'hard-consistency-v1'
        WHERE ltl.type_id = ANY($1::int[])
          AND al.winning_bid > 0
          AND al.lot_status IS DISTINCT FROM 'active'
          AND (al.auction_end_date IS NULL OR al.auction_end_date < now())
        GROUP BY ltl.type_id, normalized_grade, slab_status, quality_status
        ORDER BY ltl.type_id, count(*) DESC, normalized_grade, slab_status
    `, [typeIds]);
    console.log(JSON.stringify({
        catalog: catalog.rows,
        summary: summary.rows,
        physical_profile: physical.rows,
        grade_breakdown: grades.rows,
    }, null, 2));
}

main()
    .finally(() => pool.end())
    .catch((error) => {
        console.error(`${error.name}: ${error.message}`);
        process.exitCode = 1;
    });

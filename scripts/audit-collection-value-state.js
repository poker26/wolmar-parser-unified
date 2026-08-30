'use strict';

const path = require('path');
const { Pool } = require('pg');

const root = process.env.WOLMAR_ROOT;
if (!root) throw new Error('WOLMAR_ROOT is required');
const config = require(path.join(root, 'config'));
const pool = new Pool({ ...config.dbConfig, max: 1, allowExitOnIdle: true });

async function main() {
    const items = await pool.query(`
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE deleted_at IS NULL)::int AS active_rows,
               count(*) FILTER (WHERE deleted_at IS NULL AND type_id IS NOT NULL)::int AS linked,
               count(*) FILTER (WHERE deleted_at IS NULL AND type_id IS NULL)::int AS unlinked,
               count(*) FILTER (
                   WHERE deleted_at IS NULL AND valuation_invalidated_at IS NOT NULL
               )::int AS valuation_invalidated
        FROM collection_item
    `);
    const photos = await pool.query(`
        SELECT status, count(*)::int AS count
        FROM collection_item_photo
        GROUP BY status
        ORDER BY status
    `);
    const valuations = await pool.query(`
        SELECT status, count(*)::int AS count
        FROM collection_valuation
        GROUP BY status
        ORDER BY status
    `);
    const recent = await pool.query(`
        SELECT ci.id, ci.type_id, ci.user_label, ci.identification_status,
               ci.grade_code, ci.slab_status, ci.status AS item_status,
               ci.created_at, ci.deleted_at,
               latest.status AS valuation_status,
               latest.median_minor, latest.comparable_count,
               latest.abstain_reason, latest.calculated_at
        FROM collection_item ci
        LEFT JOIN LATERAL (
            SELECT cv.status, cv.median_minor, cv.comparable_count,
                   cv.abstain_reason, cv.calculated_at
            FROM collection_valuation cv
            WHERE cv.item_id = ci.id
            ORDER BY cv.calculated_at DESC, cv.id DESC
            LIMIT 1
        ) latest ON true
        ORDER BY ci.created_at DESC
        LIMIT 12
    `);
    console.log(JSON.stringify({
        items: items.rows[0],
        photos: photos.rows,
        valuations: valuations.rows,
        recent_items: recent.rows,
    }, null, 2));
}

main()
    .finally(() => pool.end())
    .catch((error) => {
        console.error(`${error.name}: ${error.message}`);
        process.exitCode = 1;
    });

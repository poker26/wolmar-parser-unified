'use strict';

const { pool } = require('../catalog/db');

async function main() {
    const [status, reasons, methods, countries, stale] = await Promise.all([
        pool.query(
            `SELECT status, count(*)::int AS count
             FROM lot_type_link_quality
             WHERE audit_version = 'hard-consistency-v1'
             GROUP BY status
             ORDER BY status`,
        ),
        pool.query(
            `SELECT reasons, count(*)::int AS count
             FROM lot_type_link_quality
             WHERE audit_version = 'hard-consistency-v1'
               AND status = 'conflict'
             GROUP BY reasons
             ORDER BY count(*) DESC, reasons::text`,
        ),
        pool.query(
            `SELECT COALESCE(ltl.match_method, 'unknown') AS match_method,
                    count(*)::int AS count
             FROM lot_type_link_quality lq
             JOIN lot_type_link ltl
               ON ltl.lot_id = lq.lot_id
              AND ltl.type_id = lq.type_id
             WHERE lq.audit_version = 'hard-consistency-v1'
               AND lq.status = 'conflict'
             GROUP BY COALESCE(ltl.match_method, 'unknown')
             ORDER BY count(*) DESC, match_method`,
        ),
        pool.query(
            `SELECT COALESCE(ct.country, 'unknown') AS country,
                    count(*)::int AS count
             FROM lot_type_link_quality lq
             JOIN coin_type ct ON ct.id = lq.type_id
             WHERE lq.audit_version = 'hard-consistency-v1'
               AND lq.status = 'conflict'
             GROUP BY COALESCE(ct.country, 'unknown')
             ORDER BY count(*) DESC, country
             LIMIT 20`,
        ),
        pool.query(
            `SELECT count(*)::int AS count
             FROM lot_type_link_quality lq
             LEFT JOIN lot_type_link ltl
               ON ltl.lot_id = lq.lot_id
              AND ltl.type_id = lq.type_id
             WHERE lq.audit_version = 'hard-consistency-v1'
               AND ltl.lot_id IS NULL`,
        ),
    ]);
    console.log(JSON.stringify({
        auditVersion: 'hard-consistency-v1',
        byStatus: status.rows,
        conflictByReasons: reasons.rows,
        conflictByMatchMethod: methods.rows,
        topConflictCountries: countries.rows,
        staleSnapshots: Number(stale.rows[0]?.count || 0),
    }, null, 2));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
}).finally(() => pool.end());

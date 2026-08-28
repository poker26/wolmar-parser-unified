'use strict';

const { pool } = require('../catalog/db');

async function main() {
    const result = await pool.query(
        `SELECT log.id,
                log.lot_id,
                log.old_type_id,
                old_type.name_full AS old_type_name,
                log.new_type_id,
                new_type.name_full AS new_type_name,
                log.repair_reason,
                log.audit_version,
                log.repaired_at,
                (ltl.type_id = log.new_type_id) AS currently_applied
         FROM lot_type_link_repair_log log
         LEFT JOIN lot_type_link ltl ON ltl.lot_id = log.lot_id
         LEFT JOIN coin_type old_type ON old_type.id = log.old_type_id
         LEFT JOIN coin_type new_type ON new_type.id = log.new_type_id
         ORDER BY log.repaired_at DESC, log.id DESC
         LIMIT 100`,
    );
    console.log(JSON.stringify({
        repairs: result.rows.map((row) => ({
            id: Number(row.id),
            lotId: Number(row.lot_id),
            oldTypeId: Number(row.old_type_id),
            oldTypeName: row.old_type_name,
            newTypeId: Number(row.new_type_id),
            newTypeName: row.new_type_name,
            reason: row.repair_reason,
            auditVersion: row.audit_version,
            repairedAt: row.repaired_at,
            currentlyApplied: row.currently_applied,
        })),
    }, null, 2));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
}).finally(() => pool.end());

'use strict';

const { pool } = require('../catalog/db');
const { AUDIT_VERSION, auditRow, persist } = require('./audit-lot-type-links');

async function loadRows() {
    return (await pool.query(
        `SELECT ltl.lot_id, ltl.type_id, al.coin_description, al.year AS lot_year,
                ct.name_full, ct.country, ct.year, ct.year_start, ct.year_end,
                ct.denomination_text, ct.denomination_value, ct.mint
         FROM lot_type_link_quality lq
         JOIN lot_type_link ltl
           ON ltl.lot_id = lq.lot_id
          AND ltl.type_id = lq.type_id
         JOIN auction_lots al ON al.id = ltl.lot_id
         JOIN coin_type ct ON ct.id = ltl.type_id
         WHERE lq.audit_version = $1
           AND lq.status = 'conflict'
           AND lq.reasons = '["year_mismatch"]'::jsonb
         ORDER BY ltl.lot_id`,
        [AUDIT_VERSION],
    )).rows;
}

async function main() {
    const write = process.argv.includes('--write') && process.argv.includes('--confirmed');
    const rows = (await loadRows()).map(auditRow);
    const counts = { consistent: 0, conflict: 0, unverified: 0 };
    for (const row of rows) counts[row.status] += 1;
    if (write) {
        for (let offset = 0; offset < rows.length; offset += 500) {
            await persist(rows.slice(offset, offset + 500));
        }
    }
    console.log(JSON.stringify({
        mode: write ? 'write' : 'dry-run',
        selected: rows.length,
        counts,
        correctedSamples: rows.filter((row) => row.status === 'consistent').slice(0, 20),
        remainingConflictSamples: rows.filter((row) => row.status === 'conflict').slice(0, 20),
    }, null, 2));
}

if (require.main === module) {
    main().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    }).finally(() => pool.end());
}

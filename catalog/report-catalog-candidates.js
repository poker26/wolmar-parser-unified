/** Read-only queue summary. node catalog/report-catalog-candidates.js [limit] */
'use strict';

const { pool } = require('./db');

(async () => {
    const limit = Math.min(Math.max(Number(process.argv[2]) || 30, 1), 200);
    const totals = await pool.query(
        `SELECT c.status,count(*)::int candidates,sum(x.observations)::int observations
           FROM catalog_candidate c
           CROSS JOIN LATERAL (
             SELECT count(*)::int observations FROM catalog_candidate_observation o WHERE o.candidate_id=c.id
           ) x GROUP BY c.status ORDER BY c.status`,
    );
    console.log('=== очередь кандидатов ===');
    for (const row of totals.rows) console.log(`${row.status}: ${row.candidates} кандидатов · ${row.observations} наблюдений`);
    const rows = await pool.query(
        `SELECT c.id,c.name_full,c.last_seen_at,count(o.lot_id)::int observations,
                count(DISTINCT o.source_site)::int sources,
                string_agg(DISTINCT o.source_site, ',' ORDER BY o.source_site) source_sites
           FROM catalog_candidate c JOIN catalog_candidate_observation o ON o.candidate_id=c.id
          WHERE c.status='pending'
          GROUP BY c.id ORDER BY sources DESC,observations DESC,c.last_seen_at DESC LIMIT $1`,
        [limit],
    );
    for (const row of rows.rows) {
        console.log(`#${row.id} · ${row.observations} наблюд. · ${row.sources} ист. [${row.source_sites}] · ${row.name_full}`);
    }
    await pool.end();
})().catch((error) => { console.error('FATAL', error.message); process.exit(1); });

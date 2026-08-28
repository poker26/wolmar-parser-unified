'use strict';

const { pool } = require('../catalog/db');

function readRunId(argv) {
    const argument = argv.find((value) => value.startsWith('--run='));
    const runId = argument?.slice('--run='.length);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runId || '')) {
        throw new Error('--run must be a UUID');
    }
    return runId;
}

async function main() {
    const runId = readRunId(process.argv.slice(2));
    const result = await pool.query(
        `SELECT run_id,
                evaluation_kind,
                count(*)::int AS rows,
                count(*) FILTER (WHERE status = 'ready')::int AS ready,
                count(*) FILTER (WHERE status <> 'ready')::int AS abstained,
                min(created_at) AS started_at,
                max(created_at) AS finished_at
         FROM valuation_shadow_result
         WHERE run_id = $1
         GROUP BY run_id, evaluation_kind`,
        [runId],
    );
    console.log(JSON.stringify(result.rows[0] || { runId, rows: 0 }, null, 2));
}

main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
}).finally(() => pool.end());

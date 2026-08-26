'use strict';

const path = require('node:path');
const { Pool } = require('pg');
const config = require('../config');
const { runMigrations } = require('./lib/runner');

async function main() {
    const dryRun = process.argv.includes('--dry-run');
    const pool = new Pool({
        ...config.dbConfig,
        max: 1,
        statement_timeout: 30000,
        query_timeout: 30000,
    });

    try {
        const result = await runMigrations({
            pool,
            directory: path.join(__dirname, 'sql'),
            dryRun,
        });

        if (dryRun && result.pending.length === 0) console.log('database is up to date');
        if (!dryRun && result.applied.length === 0) console.log('database is up to date');
    } finally {
        await pool.end();
    }
}

main().catch((error) => {
    console.error(`migration failed: ${error.message}`);
    process.exitCode = 1;
});

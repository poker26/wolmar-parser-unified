'use strict';

const path = require('node:path');
const { pool } = require(path.join(process.cwd(), 'catalog', 'db'));

async function main() {
    const relations = await pool.query(`
        SELECT
            c.relname AS relation,
            c.reltuples::bigint AS estimated_rows,
            pg_total_relation_size(c.oid)::bigint AS total_bytes
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = current_schema()
          AND c.relname IN ('auction_lots', 'collection_item', 'collection_valuation')
        ORDER BY c.relname
    `);
    const columns = await pool.query(`
        SELECT table_name, column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name IN ('auction_lots', 'collection_item', 'collection_valuation')
        ORDER BY table_name, ordinal_position
    `);
    process.stdout.write(`${JSON.stringify({
        generatedAt: new Date().toISOString(),
        relations: relations.rows,
        columns: columns.rows,
    }, null, 2)}\n`);
}

main()
    .finally(() => pool.end())
    .catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });

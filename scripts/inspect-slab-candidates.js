'use strict';

const path = require('node:path');

const appRoot = process.env.WOLMAR_APP_ROOT || process.cwd();
const domainRoot = process.env.WOLMAR_SLAB_DOMAIN_ROOT || appRoot;
const { pool } = require(path.join(appRoot, 'catalog', 'db'));
const { extractSlabInfo } = require(path.join(domainRoot, 'domain', 'slab-info'));

async function main() {
    const raw = process.argv.find((value) => value.startsWith('--tokens='));
    const tokens = raw
        ? raw.slice('--tokens='.length).split(',').map((value) => value.trim()).filter(Boolean)
        : [];
    if (!tokens.length) throw new Error('--tokens=TOKEN1,TOKEN2 is required');

    const output = {};
    for (const token of tokens) {
        const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const result = await pool.query(`
            SELECT id,
                   COALESCE(source_site, 'unknown') AS source_site,
                   condition,
                   coin_description AS description
            FROM auction_lots
            WHERE coin_description ~* $1
            ORDER BY id
            LIMIT 1000
        `, [`(слаб|slab|holder|холдер)[[:space:][:punct:]]{0,30}${escapedToken}`]);
        output[token] = result.rows
            .map((row) => ({
                ...row,
                extracted: extractSlabInfo({
                    description: row.description,
                    condition: row.condition,
                }),
            }))
            .filter((row) => row.extracted.gradingCompanyRaw === token)
            .map((row) => ({ ...row, description: String(row.description || '').slice(0, 1000) }))
            .slice(0, 8);
    }
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main()
    .finally(() => pool.end())
    .catch((error) => {
        console.error(error.stack || error.message);
        process.exitCode = 1;
    });

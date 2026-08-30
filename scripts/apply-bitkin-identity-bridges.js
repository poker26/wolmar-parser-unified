'use strict';

const { parseTitle } = require('../catalog/coin-matcher');
const { compatibleUnbridgedIdentity } = require('./propose-bitkin-short-reference-link-repairs');
const { compatibleCatalogTypes, findIdentityBridges } = require('./propose-bitkin-identity-bridges');

let pool;

function getPool() {
    if (!pool) pool = require('../catalog/db').pool;
    return pool;
}

function parseOptions(argv) {
    return { write: argv.includes('--write') && argv.includes('--confirmed') };
}

async function applyOne(client, candidate) {
    const locked = await client.query(
        `SELECT e.id,
                e.bitkin_reference,
                e.year AS bitkin_year,
                e.denomination AS bitkin_denomination,
                e.mint AS bitkin_mint,
                e.mint_mark AS bitkin_mint_mark,
                ct.id AS proposed_type_id,
                ct.name_full AS proposed_type_name,
                ct.source,
                ct.country AS proposed_country,
                ct.year AS proposed_year,
                ct.year_start AS proposed_year_start,
                ct.year_end AS proposed_year_end,
                ct.denomination_text AS proposed_denomination_text,
                ct.denomination_value AS proposed_denomination_value,
                ct.mint AS proposed_mint
         FROM bitkin_entry e
         JOIN coin_type ct ON ct.id = $2
         WHERE e.id = $1
         FOR UPDATE OF e, ct`,
        [candidate.entryId, candidate.proposedTypeId],
    );
    const current = locked.rows[0];
    if (!current) {
        throw new Error(`Bitkin entry ${candidate.entryId} disappeared since dry-run`);
    }
    const existing = await client.query(
        `SELECT count(*)::int AS existing_matches
         FROM bitkin_coin_type_match
         WHERE entry_id = $1`,
        [candidate.entryId],
    );
    if (Number(existing.rows[0]?.existing_matches) !== 0) {
        throw new Error(`Bitkin entry ${candidate.entryId} changed since dry-run`);
    }
    const parsed = parseTitle(candidate.sampleDescription);
    if (current.bitkin_reference !== candidate.reference
        || !compatibleUnbridgedIdentity(parsed, { ...current, proposed_type_id: null })
        || compatibleCatalogTypes(parsed, [current]).length !== 1) {
        throw new Error(`Bitkin entry ${candidate.entryId} identity changed since dry-run`);
    }
    await client.query(
        `INSERT INTO bitkin_coin_type_match (
             entry_id, type_id, match_method, match_confidence, status, details
         ) VALUES ($1,$2,'bitkin_identity_unique_catalog',0.99,'auto',$3::jsonb)`,
        [
            candidate.entryId,
            candidate.proposedTypeId,
            JSON.stringify({
                bitkin_reference: candidate.reference,
                evidence: 'year_denomination_mint_unique_existing_type',
                covered_lots_at_proposal: candidate.lotCount,
            }),
        ],
    );
}

async function main() {
    const options = parseOptions(process.argv.slice(2));
    const result = await findIdentityBridges();
    const candidates = result.results.filter((item) => item.action === 'unique_catalog_type');
    if (!options.write) {
        console.log(JSON.stringify({
            mode: 'dry-run',
            candidates: candidates.length,
            coveredLots: candidates.reduce((sum, item) => sum + item.lotCount, 0),
            bridges: candidates.map((item) => ({
                entryId: item.entryId,
                reference: item.reference,
                lotCount: item.lotCount,
                typeId: item.proposedTypeId,
                typeName: item.proposedTypeName,
            })),
        }, null, 2));
        return;
    }
    const client = await getPool().connect();
    try {
        await client.query('BEGIN');
        for (const candidate of candidates) await applyOne(client, candidate);
        await client.query('COMMIT');
        console.log(JSON.stringify({ mode: 'write', bridgesInserted: candidates.length }, null, 2));
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

if (require.main === module) {
    main().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    }).finally(() => (pool ? pool.end() : undefined));
}

module.exports = { applyOne, getPool, parseOptions };

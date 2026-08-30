'use strict';

const { pool } = require('../catalog/db');
const { findUnbridgedProposals } = require('./propose-bitkin-unbridged-link-repairs');

const AUDIT_VERSION = 'hard-consistency-v1';
const REPAIR_REASON = 'bitkin_exact_reference';

function parseOptions(argv) {
    return { write: argv.includes('--write') && argv.includes('--confirmed') };
}

async function applyOne(client, proposal) {
    const locked = await client.query(
        `SELECT ltl.type_id, ltl.match_method, ltl.match_confidence,
                lq.status, lq.audit_version
         FROM lot_type_link ltl
         JOIN lot_type_link_quality lq
           ON lq.lot_id = ltl.lot_id
          AND lq.type_id = ltl.type_id
         WHERE ltl.lot_id = $1
         FOR UPDATE OF ltl, lq`,
        [proposal.lotId],
    );
    const current = locked.rows[0];
    if (!current
        || Number(current.type_id) !== proposal.currentTypeId
        || current.status !== 'conflict'
        || current.audit_version !== AUDIT_VERSION) {
        throw new Error(`Lot ${proposal.lotId} changed since dry-run`);
    }
    await client.query(
        `INSERT INTO bitkin_coin_type_match (
             entry_id, type_id, match_method, match_confidence, status, details
         ) VALUES ($1,$2,'bitkin_reference_attributes_unique',0.98,'auto',$3::jsonb)
         ON CONFLICT (entry_id,type_id) DO NOTHING`,
        [
            proposal.bitkinEntryId,
            proposal.proposedTypeId,
            JSON.stringify({ bitkin_reference: proposal.reference, evidence: 'year_denomination_mint_unique' }),
        ],
    );
    await client.query(
        `INSERT INTO lot_type_link_repair_log (
             lot_id, old_type_id, new_type_id, old_match_method, old_match_confidence,
             repair_reason, audit_version, audit_evidence
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
        [
            proposal.lotId,
            proposal.currentTypeId,
            proposal.proposedTypeId,
            current.match_method,
            current.match_confidence,
            REPAIR_REASON,
            AUDIT_VERSION,
            JSON.stringify([
                `bitkin_reference:${proposal.reference}`,
                'bitkin_entry_extracted',
                'lot_bitkin_type_year_exact',
                'lot_bitkin_type_denomination_exact',
                'unique_compatible_catalog_type',
            ]),
        ],
    );
    await client.query(
        `UPDATE lot_type_link
         SET type_id = $2,
             match_method = 'bitkin_reference_attributes_unique',
             match_confidence = 0.98
         WHERE lot_id = $1`,
        [proposal.lotId, proposal.proposedTypeId],
    );
    await client.query(
        `UPDATE lot_type_link_quality
         SET type_id = $2,
             status = 'consistent',
             reasons = '[]'::jsonb,
             evidence = $3::jsonb,
             audit_version = $4,
             audited_at = now()
         WHERE lot_id = $1`,
        [proposal.lotId, proposal.proposedTypeId, JSON.stringify(proposal.proposedAudit.evidence), AUDIT_VERSION],
    );
}

async function main() {
    const options = parseOptions(process.argv.slice(2));
    const result = await findUnbridgedProposals();
    const candidates = result.results.filter((proposal) => proposal.action === 'unbridged_strict_candidate');
    if (!options.write) {
        console.log(JSON.stringify({
            mode: 'dry-run',
            candidates: candidates.length,
            uniqueReferences: new Set(candidates.map((proposal) => proposal.reference)).size,
            repairs: candidates.map((proposal) => ({
                lotId: proposal.lotId,
                reference: proposal.reference,
                oldTypeId: proposal.currentTypeId,
                oldTypeName: proposal.currentTypeName,
                newTypeId: proposal.proposedTypeId,
                newTypeName: proposal.proposedTypeName,
            })),
        }, null, 2));
        return;
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        for (const proposal of candidates) await applyOne(client, proposal);
        await client.query('COMMIT');
        console.log(JSON.stringify({ mode: 'write', repaired: candidates.length }, null, 2));
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
    }).finally(() => pool.end());
}

module.exports = { applyOne, parseOptions };

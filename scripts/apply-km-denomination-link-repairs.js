'use strict';

const { parseTitle } = require('../catalog/coin-matcher');
const { auditLotTypeLink, resolveLotYear } = require('../domain/identity-link-quality');
const {
    AUDIT_VERSION,
    extractKmReferences,
    findProposals,
    normalizeKmReference,
    typeForAudit,
} = require('./propose-km-denomination-link-repairs');

const REPAIR_REASON = 'km_exact_reference';

function parseOptions(argv) {
    const rawLimit = argv.find((value) => value.startsWith('--limit='))?.slice('--limit='.length);
    const limit = rawLimit == null ? null : Number(rawLimit);
    if (limit != null && (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)) {
        throw new Error('--limit must be 1..1000');
    }
    return { limit, write: argv.includes('--write') && argv.includes('--confirmed') };
}

function validateLockedRepair(row, proposal) {
    if (!row
        || Number(row.old_type_id) !== proposal.currentTypeId
        || row.quality_status !== 'conflict'
        || row.audit_version !== AUDIT_VERSION) {
        throw new Error(`Lot ${proposal.lotId} changed since dry-run`);
    }
    if (Number(row.old_type_id) === Number(row.new_type_id)) {
        throw new Error(`Lot ${proposal.lotId} already uses the proposed type`);
    }
    const references = extractKmReferences(row.coin_description);
    if (references.length !== 1 || references[0] !== proposal.reference
        || normalizeKmReference(row.km_number) !== proposal.reference) {
        throw new Error(`Lot ${proposal.lotId} KM reference changed since dry-run`);
    }
    if (row.old_type_country !== proposal.country || row.country !== proposal.country) {
        throw new Error(`Lot ${proposal.lotId} country evidence changed since dry-run`);
    }
    const parsed = parseTitle(row.coin_description);
    const resolvedYear = resolveLotYear({
        parsedYear: parsed.year,
        storedYear: row.lot_year,
        description: row.coin_description,
    });
    parsed.year = resolvedYear.year;
    const audit = auditLotTypeLink({ lot: parsed, type: typeForAudit(row) });
    const hasYear = audit.evidence.some((item) => item === 'year' || item === 'year_or_coin_year');
    const hasDenomination = audit.evidence.some((item) => item.startsWith('denomination_'));
    if (audit.status !== 'consistent' || !hasYear || !hasDenomination) {
        throw new Error(`Lot ${proposal.lotId} proposed type is no longer strictly compatible`);
    }
    return audit;
}

function repairEvidence(proposal, audit) {
    return [
        `km_reference:${proposal.reference}`,
        'km_country_exact',
        'km_year_exact_or_range',
        'km_denomination_exact',
        'km_unique_catalog_candidate',
        ...audit.evidence,
    ];
}

async function applyOne(client, proposal) {
    const locked = await client.query(
        `SELECT ltl.type_id AS old_type_id,
                ltl.match_method AS old_match_method,
                ltl.match_confidence AS old_match_confidence,
                lq.status AS quality_status,
                lq.audit_version,
                al.coin_description,
                al.year AS lot_year,
                old_type.country AS old_type_country,
                new_type.id AS new_type_id,
                new_type.name_full,
                new_type.country,
                new_type.year,
                new_type.coin_year,
                new_type.year_start,
                new_type.year_end,
                new_type.denomination_text,
                new_type.denomination_value,
                new_type.mint,
                new_type.km_number
         FROM lot_type_link ltl
         JOIN lot_type_link_quality lq
           ON lq.lot_id = ltl.lot_id
          AND lq.type_id = ltl.type_id
         JOIN auction_lots al ON al.id = ltl.lot_id
         JOIN coin_type old_type ON old_type.id = ltl.type_id
         JOIN coin_type new_type ON new_type.id = $2
         WHERE ltl.lot_id = $1
         FOR UPDATE OF ltl, lq`,
        [proposal.lotId, proposal.proposedTypeId],
    );
    const row = locked.rows[0];
    const audit = validateLockedRepair(row, proposal);
    const evidence = repairEvidence(proposal, audit);
    await client.query(
        `INSERT INTO lot_type_link_repair_log (
             lot_id, old_type_id, new_type_id, old_match_method, old_match_confidence,
             repair_reason, audit_version, audit_evidence
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
        [
            proposal.lotId,
            Number(row.old_type_id),
            proposal.proposedTypeId,
            row.old_match_method,
            row.old_match_confidence,
            REPAIR_REASON,
            AUDIT_VERSION,
            JSON.stringify(evidence),
        ],
    );
    await client.query(
        `UPDATE lot_type_link
         SET type_id = $2,
             match_method = $3,
             match_confidence = 0.99
         WHERE lot_id = $1`,
        [proposal.lotId, proposal.proposedTypeId, REPAIR_REASON],
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
        [proposal.lotId, proposal.proposedTypeId, JSON.stringify(audit.evidence), AUDIT_VERSION],
    );
}

async function main() {
    const { pool } = require('../catalog/db');
    const options = parseOptions(process.argv.slice(2));
    try {
        const result = await findProposals(pool);
        let candidates = result.results.filter((item) => item.action === 'exact_km_strict_candidate');
        if (options.limit != null) candidates = candidates.slice(0, options.limit);
        if (!options.write) {
            console.log(JSON.stringify({
                mode: 'dry-run',
                candidates: candidates.length,
                uniqueKmReferences: new Set(candidates.map((item) => item.reference)).size,
                totalWinningBid: candidates.reduce((sum, item) => sum + (item.price || 0), 0),
                sample: candidates.slice(0, 20).map((item) => ({
                    lotId: item.lotId,
                    reference: item.reference,
                    oldTypeId: item.currentTypeId,
                    oldTypeName: item.currentTypeName,
                    newTypeId: item.proposedTypeId,
                    newTypeName: item.proposedTypeName,
                })),
            }, null, 2));
            return;
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            for (const candidate of candidates) await applyOne(client, candidate);
            await client.query('COMMIT');
            console.log(JSON.stringify({ mode: 'write', repaired: candidates.length }, null, 2));
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    } finally {
        await pool.end();
    }
}

if (require.main === module) main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

module.exports = { applyOne, parseOptions, repairEvidence, validateLockedRepair };

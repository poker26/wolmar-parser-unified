'use strict';

const { pool } = require('../catalog/db');
const { parseTitle } = require('../catalog/coin-matcher');
const { auditLotTypeLink } = require('../domain/identity-link-quality');

const AUDIT_VERSION = 'hard-consistency-v1';
const REASONS = new Set(['denomination_exact', 'year_exact', 'mint_exact', 'manual_verified']);

function parseOptions(argv) {
    const read = (name) => {
        const prefix = `--${name}=`;
        return argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
    };
    const lotId = Number(read('lot'));
    const typeId = Number(read('type'));
    const reason = read('reason');
    if (!Number.isSafeInteger(lotId) || lotId <= 0) throw new Error('--lot must be a positive integer');
    if (!Number.isSafeInteger(typeId) || typeId <= 0) throw new Error('--type must be a positive integer');
    if (!REASONS.has(reason)) throw new Error('--reason must be an approved repair reason');
    return {
        lotId,
        typeId,
        reason,
        write: argv.includes('--write') && argv.includes('--confirmed'),
    };
}

function typeForAudit(row) {
    return {
        name: row.name_full,
        country: row.country,
        year: row.year,
        yearStart: row.year_start,
        yearEnd: row.year_end,
        denominationText: row.denomination_text,
        denominationValue: row.denomination_value,
        mint: row.mint,
    };
}

async function loadRepair(client, options, lock = false) {
    const result = await client.query(
        `SELECT ltl.lot_id,
                ltl.type_id AS old_type_id,
                ltl.match_method AS old_match_method,
                ltl.match_confidence AS old_match_confidence,
                al.coin_description,
                old_type.name_full AS old_type_name,
                new_type.id AS new_type_id,
                new_type.name_full,
                new_type.country,
                new_type.year,
                new_type.year_start,
                new_type.year_end,
                new_type.denomination_text,
                new_type.denomination_value,
                new_type.mint
         FROM lot_type_link ltl
         JOIN auction_lots al ON al.id = ltl.lot_id
         JOIN coin_type old_type ON old_type.id = ltl.type_id
         JOIN coin_type new_type ON new_type.id = $2
         WHERE ltl.lot_id = $1
         ${lock ? 'FOR UPDATE OF ltl' : ''}`,
        [options.lotId, options.typeId],
    );
    if (!result.rows[0]) throw new Error('Lot link or proposed catalog type was not found');
    return result.rows[0];
}

function validateRepair(row) {
    if (Number(row.old_type_id) === Number(row.new_type_id)) {
        throw new Error('Proposed type is already linked');
    }
    const audit = auditLotTypeLink({
        lot: parseTitle(row.coin_description),
        type: typeForAudit(row),
    });
    if (audit.status === 'conflict') {
        throw new Error(`Proposed type still conflicts: ${audit.reasons.join(',')}`);
    }
    return audit;
}

function output(row, audit, mode) {
    return {
        mode,
        lotId: Number(row.lot_id),
        description: row.coin_description,
        oldTypeId: Number(row.old_type_id),
        oldTypeName: row.old_type_name,
        newTypeId: Number(row.new_type_id),
        newTypeName: row.name_full,
        auditStatus: audit.status,
        auditEvidence: audit.evidence,
    };
}

async function main() {
    const options = parseOptions(process.argv.slice(2));
    if (!options.write) {
        const row = await loadRepair(pool, options);
        console.log(JSON.stringify(output(row, validateRepair(row), 'dry-run'), null, 2));
        return;
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const row = await loadRepair(client, options, true);
        const audit = validateRepair(row);
        await client.query(
            `INSERT INTO lot_type_link_repair_log (
                 lot_id, old_type_id, new_type_id, old_match_method, old_match_confidence,
                 repair_reason, audit_version, audit_evidence
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
            [
                options.lotId,
                Number(row.old_type_id),
                options.typeId,
                row.old_match_method,
                row.old_match_confidence,
                options.reason,
                AUDIT_VERSION,
                JSON.stringify(audit.evidence),
            ],
        );
        await client.query(
            `UPDATE lot_type_link
             SET type_id = $2,
                 match_method = 'manual_review',
                 match_confidence = 1
             WHERE lot_id = $1`,
            [options.lotId, options.typeId],
        );
        await client.query(
            `INSERT INTO lot_type_link_quality (
                 lot_id, type_id, status, reasons, evidence, audit_version, audited_at
             ) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,now())
             ON CONFLICT (lot_id) DO UPDATE SET
                 type_id = EXCLUDED.type_id,
                 status = EXCLUDED.status,
                 reasons = EXCLUDED.reasons,
                 evidence = EXCLUDED.evidence,
                 audit_version = EXCLUDED.audit_version,
                 audited_at = EXCLUDED.audited_at`,
            [
                options.lotId,
                options.typeId,
                audit.status,
                JSON.stringify(audit.reasons),
                JSON.stringify(audit.evidence),
                AUDIT_VERSION,
            ],
        );
        await client.query('COMMIT');
        console.log(JSON.stringify(output(row, audit, 'write'), null, 2));
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

module.exports = { parseOptions, typeForAudit, validateRepair };

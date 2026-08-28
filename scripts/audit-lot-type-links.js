'use strict';

const { pool } = require('../catalog/db');
const { parseTitle } = require('../catalog/coin-matcher');
const { auditLotTypeLink } = require('../domain/identity-link-quality');

const AUDIT_VERSION = 'hard-consistency-v1';

function parseOptions(argv) {
    const read = (name, fallback) => {
        const prefix = `--${name}=`;
        const found = argv.find((value) => value.startsWith(prefix));
        return found ? found.slice(prefix.length) : fallback;
    };
    const limit = Number(read('limit', '500'));
    const batchSize = Number(read('batch-size', String(Math.min(limit, 5000))));
    const afterLot = Number(read('after-lot', '0'));
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000000) {
        throw new Error('--limit must be 1..1000000');
    }
    if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 10000) {
        throw new Error('--batch-size must be 1..10000');
    }
    if (!Number.isSafeInteger(afterLot) || afterLot < 0) {
        throw new Error('--after-lot must be a non-negative integer');
    }
    return {
        limit,
        batchSize,
        afterLot,
        write: argv.includes('--write') && argv.includes('--confirmed'),
        details: argv.includes('--details'),
    };
}

async function loadLinks({ limit, afterLot }) {
    const result = await pool.query(
        `SELECT ltl.lot_id,
                ltl.type_id,
                al.coin_description,
                ct.name_full,
                ct.country,
                ct.year,
                ct.year_start,
                ct.year_end,
                ct.denomination_text,
                ct.denomination_value,
                ct.mint
         FROM lot_type_link ltl
         JOIN auction_lots al ON al.id = ltl.lot_id
         JOIN coin_type ct ON ct.id = ltl.type_id
         WHERE ltl.lot_id > $1
         ORDER BY ltl.lot_id
         LIMIT $2`,
        [afterLot, limit],
    );
    return result.rows;
}

function auditRow(row) {
    const result = auditLotTypeLink({
        lot: parseTitle(row.coin_description),
        type: {
            name: row.name_full,
            country: row.country,
            year: row.year,
            yearStart: row.year_start,
            yearEnd: row.year_end,
            denominationText: row.denomination_text,
            denominationValue: row.denomination_value,
            mint: row.mint,
        },
    });
    return {
        lotId: Number(row.lot_id),
        typeId: Number(row.type_id),
        description: row.coin_description,
        typeName: row.name_full,
        ...result,
    };
}

async function persist(rows) {
    const payload = rows.map((row) => ({
        lot_id: row.lotId,
        type_id: row.typeId,
        status: row.status,
        reasons: row.reasons,
        evidence: row.evidence,
    }));
    await pool.query(
        `INSERT INTO lot_type_link_quality (
             lot_id, type_id, status, reasons, evidence, audit_version, audited_at
         )
         SELECT item.lot_id,
                item.type_id,
                item.status,
                item.reasons,
                item.evidence,
                $2,
                now()
         FROM jsonb_to_recordset($1::jsonb) AS item(
             lot_id INTEGER,
             type_id INTEGER,
             status TEXT,
             reasons JSONB,
             evidence JSONB
         )
         ON CONFLICT (lot_id) DO UPDATE SET
             type_id = EXCLUDED.type_id,
             status = EXCLUDED.status,
             reasons = EXCLUDED.reasons,
             evidence = EXCLUDED.evidence,
             audit_version = EXCLUDED.audit_version,
             audited_at = EXCLUDED.audited_at`,
        [JSON.stringify(payload), AUDIT_VERSION],
    );
}

function summarize({ counts, audited, nextAfterLot, complete }, options) {
    return {
        mode: options.write ? 'write' : 'dry-run',
        auditVersion: AUDIT_VERSION,
        requested: options.limit,
        audited,
        afterLot: options.afterLot,
        nextAfterLot,
        complete,
        counts,
    };
}

async function main() {
    const options = parseOptions(process.argv.slice(2));
    const state = {
        counts: { consistent: 0, conflict: 0, unverified: 0 },
        audited: 0,
        nextAfterLot: options.afterLot,
        complete: false,
    };
    const conflicts = [];
    while (state.audited < options.limit) {
        const requested = Math.min(options.batchSize, options.limit - state.audited);
        const rows = (await loadLinks({ limit: requested, afterLot: state.nextAfterLot })).map(auditRow);
        if (options.write && rows.length) await persist(rows);
        for (const row of rows) {
            state.counts[row.status]++;
            if (row.status === 'conflict' && (options.details || conflicts.length < 20)) conflicts.push(row);
        }
        state.audited += rows.length;
        if (rows.length) state.nextAfterLot = rows.at(-1).lotId;
        console.error(`audited=${state.audited} afterLot=${state.nextAfterLot}`);
        if (rows.length < requested) {
            state.complete = true;
            break;
        }
    }
    const summary = summarize(state, options);
    console.log(JSON.stringify({ summary, conflicts }, null, 2));
}

if (require.main === module) {
    main().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    }).finally(() => pool.end());
}

module.exports = { AUDIT_VERSION, auditRow, parseOptions, summarize };

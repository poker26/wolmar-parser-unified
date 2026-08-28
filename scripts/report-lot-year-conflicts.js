'use strict';

const { pool } = require('../catalog/db');
const { parseTitle } = require('../catalog/coin-matcher');
const { extractFullBitkinReferences } = require('./propose-bitkin-lot-type-link-repairs');

function parseOptions(argv) {
    const rawLimit = argv.find((value) => value.startsWith('--limit='))?.slice('--limit='.length) || '10';
    const limit = Number(rawLimit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('--limit must be 1..100');
    return { limit, summaryOnly: argv.includes('--summary-only') };
}

function titleYears(description) {
    const lead = String(description || '').split('|', 1)[0];
    return [...new Set([...lead.matchAll(/(?<!\d)(1[5-9]\d{2}|20[0-3]\d)(?!\d)/gu)]
        .map((match) => Number(match[1])))];
}

async function loadConflicts() {
    const result = await pool.query(
        `SELECT lq.lot_id, al.coin_description, al.year AS lot_year,
                al.source_site, al.winning_bid, al.currency,
                ct.id AS type_id, ct.name_full AS type_name,
                ct.year AS type_year, ct.year_start AS type_year_start, ct.year_end AS type_year_end
         FROM lot_type_link_quality lq
         JOIN lot_type_link ltl
           ON ltl.lot_id = lq.lot_id
          AND ltl.type_id = lq.type_id
         JOIN auction_lots al ON al.id = lq.lot_id
         JOIN coin_type ct ON ct.id = lq.type_id
         WHERE lq.audit_version = 'hard-consistency-v1'
           AND lq.status = 'conflict'
           AND lq.reasons = '["year_mismatch"]'::jsonb
         ORDER BY al.winning_bid DESC NULLS LAST, lq.lot_id`,
    );
    return result.rows;
}

async function loadBitkinEntries(references) {
    if (references.length === 0) return [];
    return (await pool.query(
        `SELECT id, bitkin_reference, year, denomination, mint_mark, status
         FROM bitkin_entry
         WHERE bitkin_reference = ANY($1::text[])
         ORDER BY bitkin_reference, id`,
        [references],
    )).rows;
}

function classify(row, bitkinRows) {
    const parsedYear = parseTitle(row.coin_description).year;
    const years = titleYears(row.coin_description);
    const typeYear = Number(row.type_year);
    const lotYear = row.lot_year == null ? null : Number(row.lot_year);
    const base = {
        lotId: Number(row.lot_id),
        description: row.coin_description,
        price: row.winning_bid == null ? null : Number(row.winning_bid),
        currency: row.currency,
        source: row.source_site,
        parsedYear,
        lotYear,
        titleYears: years,
        typeId: Number(row.type_id),
        typeName: row.type_name,
        typeYear,
    };
    if (bitkinRows.length === 1 && bitkinRows[0].year != null) {
        const bitkinYear = Number(bitkinRows[0].year);
        return {
            ...base,
            bitkinReference: bitkinRows[0].bitkin_reference,
            bitkinYear,
            action: bitkinYear === typeYear ? 'bitkin_confirms_current' : 'bitkin_conflicts_current',
        };
    }
    if (lotYear === typeYear && years.includes(typeYear)) {
        return { ...base, action: 'lot_column_confirms_current' };
    }
    if (years.includes(typeYear) && years.length > 1) {
        return { ...base, action: 'multi_year_title_contains_current' };
    }
    if (lotYear != null && lotYear !== parsedYear && lotYear === typeYear) {
        return { ...base, action: 'lot_column_only_confirms_current' };
    }
    return { ...base, action: 'unresolved' };
}

async function main() {
    const options = parseOptions(process.argv.slice(2));
    const conflicts = await loadConflicts();
    const refsByLot = new Map();
    const references = new Set();
    for (const row of conflicts) {
        const refs = extractFullBitkinReferences(row.coin_description);
        refsByLot.set(Number(row.lot_id), refs);
        for (const ref of refs) references.add(ref);
    }
    const bitkinEntries = await loadBitkinEntries([...references]);
    const bitkinByRef = new Map();
    for (const row of bitkinEntries) {
        const rows = bitkinByRef.get(row.bitkin_reference) || [];
        rows.push(row);
        bitkinByRef.set(row.bitkin_reference, rows);
    }
    const classified = conflicts.map((row) => {
        const refs = refsByLot.get(Number(row.lot_id)) || [];
        const entries = refs.length === 1 ? (bitkinByRef.get(refs[0]) || []) : [];
        return classify(row, entries);
    });
    const byAction = {};
    const bySource = {};
    for (const row of classified) {
        byAction[row.action] = (byAction[row.action] || 0) + 1;
        const source = bySource[row.source] ||= {};
        source[row.action] = (source[row.action] || 0) + 1;
    }
    const samples = {};
    if (!options.summaryOnly) {
        for (const action of Object.keys(byAction)) {
            samples[action] = classified.filter((row) => row.action === action).slice(0, options.limit);
        }
    }
    console.log(JSON.stringify({
        summary: {
            mode: 'read-only',
            conflicts: conflicts.length,
            uniqueFullBitkinReferences: references.size,
            byAction,
            bySource,
        },
        samples,
    }, null, 2));
}

if (require.main === module) {
    main().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    }).finally(() => pool.end());
}

module.exports = { classify, parseOptions, titleYears };

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

function yearsIn(value) {
    return [...new Set([...String(value || '').matchAll(/(?<!\d)(1[5-9]\d{2}|20[0-3]\d)(?!\d)/gu)]
        .map((match) => Number(match[1])))];
}

function detailReleaseYears(description) {
    const detail = String(description || '').split('|').slice(1).join('|');
    return [...new Set([...detail.matchAll(/(?:выпуск|дата\s+выпуска)[^\d]{0,20}(1[5-9]\d{2}|20[0-3]\d)/giu)]
        .map((match) => Number(match[1])))];
}

function unresolvedEvidence(row) {
    if (row.catalogSource !== 'cbr') return 'foreign_requires_relink_review';
    if (detailReleaseYears(row.description).includes(row.typeYear)) return 'cbr_release_year_explicit';
    if (yearsIn(row.typeName).includes(row.lotYear)) return 'cbr_type_name_contains_lot_year';
    if (row.coinYear != null && row.lotYear !== row.typeYear && row.lotYear !== row.coinYear) {
        return 'cbr_source_year_conflicts_official';
    }
    if (row.matchMethod === 'year_shift' && [1, 2].includes(row.yearOffset)) {
        return 'cbr_year_shift_requires_coin_year';
    }
    return 'cbr_requires_manual_review';
}

async function loadConflicts() {
    const result = await pool.query(
        `SELECT lq.lot_id, al.coin_description, al.year AS lot_year,
                al.source_site, al.winning_bid, al.currency,
                ct.id AS type_id, ct.name_full AS type_name,
                ct.year AS type_year, ct.year_start AS type_year_start, ct.year_end AS type_year_end,
                ct.issue_date, ct.coin_year, ct.source AS catalog_source, ct.ref_source,
                ct.era, ct.country, ct.cbr_cat_num, ct.denomination_text,
                ct.ref_issues, ct.km_number,
                ltl.match_method, ltl.match_confidence
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
        typeYearStart: row.type_year_start == null ? null : Number(row.type_year_start),
        typeYearEnd: row.type_year_end == null ? null : Number(row.type_year_end),
        typeDenominationText: row.denomination_text,
        referenceIssues: row.ref_issues,
        kmNumber: row.km_number,
        issueDate: row.issue_date,
        coinYear: row.coin_year == null ? null : Number(row.coin_year),
        catalogSource: row.catalog_source,
        refSource: row.ref_source,
        era: row.era,
        country: row.country,
        cbrCatalogNumber: row.cbr_cat_num,
        matchMethod: row.match_method,
        matchConfidence: row.match_confidence == null ? null : Number(row.match_confidence),
        yearOffset: lotYear == null || !Number.isFinite(typeYear) ? null : lotYear - typeYear,
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
    const unresolvedDimensions = {
        byCatalogSource: {},
        byEra: {},
        byCountry: {},
        byYearOffset: {},
        byYearPair: {},
        byMatchMethod: {},
        byEvidence: {},
    };
    const unresolvedTypes = new Map();
    for (const row of classified) {
        byAction[row.action] = (byAction[row.action] || 0) + 1;
        const source = bySource[row.source] ||= {};
        source[row.action] = (source[row.action] || 0) + 1;
        if (row.action !== 'unresolved') continue;
        const dimensions = [
            ['byCatalogSource', row.catalogSource || '(null)'],
            ['byEra', row.era || 'modern/cbr'],
            ['byCountry', row.country || '(null)'],
            ['byYearOffset', row.yearOffset == null ? '(null)' : String(row.yearOffset)],
            ['byYearPair', `${row.lotYear ?? '?'} -> ${row.typeYear ?? '?'}`],
            ['byMatchMethod', row.matchMethod || '(null)'],
            ['byEvidence', unresolvedEvidence(row)],
        ];
        for (const [dimension, key] of dimensions) {
            unresolvedDimensions[dimension][key] = (unresolvedDimensions[dimension][key] || 0) + 1;
        }
        const type = unresolvedTypes.get(row.typeId) || {
            typeId: row.typeId,
            typeName: row.typeName,
            typeYear: row.typeYear,
            typeYearStart: row.typeYearStart,
            typeYearEnd: row.typeYearEnd,
            typeDenominationText: row.typeDenominationText,
            referenceIssues: row.referenceIssues,
            kmNumber: row.kmNumber,
            issueDate: row.issueDate,
            coinYear: row.coinYear,
            catalogSource: row.catalogSource,
            cbrCatalogNumber: row.cbrCatalogNumber,
            count: 0,
            lotYears: {},
        };
        type.count += 1;
        type.lotYears[row.lotYear ?? '?'] = (type.lotYears[row.lotYear ?? '?'] || 0) + 1;
        unresolvedTypes.set(row.typeId, type);
    }
    for (const values of Object.values(unresolvedDimensions)) {
        const sorted = Object.entries(values).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
        for (const key of Object.keys(values)) delete values[key];
        for (const [key, value] of sorted) values[key] = value;
    }
    const samples = {};
    const samplesByEvidence = {};
    if (!options.summaryOnly) {
        for (const action of Object.keys(byAction)) {
            samples[action] = classified.filter((row) => row.action === action).slice(0, options.limit);
        }
        for (const row of classified.filter((item) => item.action === 'unresolved')) {
            const evidence = unresolvedEvidence(row);
            const bucket = samplesByEvidence[evidence] ||= [];
            if (bucket.length < options.limit) bucket.push(row);
        }
    }
    console.log(JSON.stringify({
        summary: {
            mode: 'read-only',
            conflicts: conflicts.length,
            uniqueFullBitkinReferences: references.size,
            byAction,
            bySource,
            unresolvedDimensions,
            topUnresolvedTypes: [...unresolvedTypes.values()]
                .sort((a, b) => b.count - a.count || a.typeId - b.typeId)
                .slice(0, 50),
        },
        samples,
        samplesByEvidence,
    }, null, 2));
}

if (require.main === module) {
    main().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    }).finally(() => pool.end());
}

module.exports = { classify, detailReleaseYears, parseOptions, titleYears, unresolvedEvidence, yearsIn };

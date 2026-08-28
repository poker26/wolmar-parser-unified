'use strict';

const { pool } = require('../catalog/db');
const { parseTitle } = require('../catalog/coin-matcher');
const { auditLotTypeLink } = require('../domain/identity-link-quality');

function parseOptions(argv) {
    const rawLimit = argv.find((value) => value.startsWith('--limit='))?.slice('--limit='.length) || '100';
    const limit = Number(rawLimit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
        throw new Error('--limit must be 1..1000');
    }
    return {
        limit,
        details: argv.includes('--details'),
        strictOnly: argv.includes('--strict-only'),
        summaryOnly: argv.includes('--summary-only'),
    };
}

function extractFullBitkinReferences(description) {
    const refs = [];
    const pattern = /(?:биткин(?:а)?|bitkin)[^0-9]{0,24}(\d{1,4}\.\d{1,4})/giu;
    for (const match of String(description || '').matchAll(pattern)) refs.push(match[1]);
    return [...new Set(refs)];
}

function candidateForAudit(row) {
    return {
        name: row.proposed_type_name,
        country: row.proposed_country,
        year: row.proposed_year,
        yearStart: row.proposed_year_start,
        yearEnd: row.proposed_year_end,
        denominationText: row.proposed_denomination_text,
        denominationValue: row.proposed_denomination_value,
        mint: row.proposed_mint,
    };
}

function bitkinForAudit(row) {
    return {
        name: [row.bitkin_denomination, row.bitkin_year, row.bitkin_mint_mark].filter(Boolean).join(' '),
        country: 'RU',
        year: row.bitkin_year,
        denominationText: row.bitkin_denomination,
        mint: [row.bitkin_mint, row.bitkin_mint_mark].filter(Boolean).join(' '),
    };
}

function bitkinDenominationValue(value) {
    const normalized = String(value || '').trim().toLowerCase().replace(',', '.');
    if (!normalized) return null;
    const fraction = normalized.match(/(\d+)\s*\/\s*(\d+)\s*коп/iu);
    if (fraction && Number(fraction[2])) return (Number(fraction[1]) / Number(fraction[2])) / 100;
    const kopeks = normalized.match(/(\d+(?:\.\d+)?)\s*коп/iu);
    if (kopeks) return Number(kopeks[1]) / 100;
    const rubles = normalized.match(/(\d+(?:\.\d+)?)\s*руб/iu);
    if (rubles) return Number(rubles[1]);
    if (/полуполтин/iu.test(normalized)) return 0.25;
    if (/полтин|полруб|полуруб/iu.test(normalized)) return 0.5;
    if (/пятиалтын/iu.test(normalized)) return 0.15;
    if (/гривенн/iu.test(normalized)) return 0.1;
    if (/алтын/iu.test(normalized)) return 0.03;
    if (/деньг|денг/iu.test(normalized)) return 0.005;
    if (/полушк/iu.test(normalized)) return 0.0025;
    if (/копе/iu.test(normalized)) return 0.01;
    if (/руб/iu.test(normalized)) return 1;
    return null;
}

function sameFiniteValues(values) {
    return values.every(Number.isFinite)
        && values.every((value) => Math.abs(value - values[0]) < 1e-9);
}

function numericOrNull(value) {
    if (value == null || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

async function loadConflicts() {
    const result = await pool.query(
        `SELECT lq.lot_id,
                lq.type_id AS current_type_id,
                lq.reasons,
                al.coin_description,
                al.winning_bid,
                al.currency,
                al.source_site,
                current_type.name_full AS current_type_name
         FROM lot_type_link_quality lq
         JOIN lot_type_link ltl
           ON ltl.lot_id = lq.lot_id
          AND ltl.type_id = lq.type_id
         JOIN auction_lots al ON al.id = lq.lot_id
         JOIN coin_type current_type ON current_type.id = lq.type_id
         WHERE lq.audit_version = 'hard-consistency-v1'
           AND lq.status = 'conflict'
           AND (al.coin_description ILIKE '%биткин%'
                OR al.coin_description ILIKE '%bitkin%')
         ORDER BY al.winning_bid DESC NULLS LAST, lq.lot_id`,
    );
    return result.rows;
}

async function loadReferences(references) {
    if (references.length === 0) return [];
    const result = await pool.query(
        `SELECT e.id AS entry_id,
                e.bitkin_reference,
                e.year AS bitkin_year,
                e.denomination AS bitkin_denomination,
                e.ruler AS bitkin_ruler,
                e.mint AS bitkin_mint,
                e.mint_mark AS bitkin_mint_mark,
                e.variant AS bitkin_variant,
                e.status AS bitkin_status,
                m.type_id AS proposed_type_id,
                m.match_method AS bitkin_match_method,
                m.match_confidence AS bitkin_match_confidence,
                m.status AS bitkin_match_status,
                proposed.name_full AS proposed_type_name,
                proposed.country AS proposed_country,
                proposed.year AS proposed_year,
                proposed.year_start AS proposed_year_start,
                proposed.year_end AS proposed_year_end,
                proposed.denomination_text AS proposed_denomination_text,
                proposed.denomination_value AS proposed_denomination_value,
                proposed.mint AS proposed_mint
         FROM bitkin_entry e
         LEFT JOIN bitkin_coin_type_match m ON m.entry_id = e.id
         LEFT JOIN coin_type proposed ON proposed.id = m.type_id
         WHERE e.bitkin_reference = ANY($1::text[])
         ORDER BY e.bitkin_reference, m.match_confidence DESC NULLS LAST, m.type_id`,
        [references],
    );
    return result.rows;
}

function classify(row, matches) {
    const base = {
        lotId: Number(row.lot_id),
        description: row.coin_description,
        price: row.winning_bid == null ? null : Number(row.winning_bid),
        currency: row.currency,
        source: row.source_site,
        currentTypeId: Number(row.current_type_id),
        currentTypeName: row.current_type_name,
        currentReasons: row.reasons,
    };
    if (matches.length === 0) return { ...base, action: 'reference_not_imported' };
    if (matches.length > 1) {
        return {
            ...base,
            action: 'ambiguous_reference_or_type',
            candidates: matches.map((match) => ({
                entryId: Number(match.entry_id),
                typeId: match.proposed_type_id == null ? null : Number(match.proposed_type_id),
            })),
        };
    }
    const match = matches[0];
    const bitkin = {
        reference: match.bitkin_reference,
        entryId: Number(match.entry_id),
        year: match.bitkin_year,
        denomination: match.bitkin_denomination,
        ruler: match.bitkin_ruler,
        mint: match.bitkin_mint,
        mintMark: match.bitkin_mint_mark,
        variant: match.bitkin_variant,
        status: match.bitkin_status,
    };
    if (match.proposed_type_id == null) return { ...base, bitkin, action: 'exact_reference_without_type_match' };
    if (Number(match.proposed_type_id) === Number(row.current_type_id)) {
        return { ...base, bitkin, action: 'exact_reference_reconfirms_current' };
    }
    const parsedLot = parseTitle(row.coin_description);
    const audit = auditLotTypeLink({
        lot: parsedLot,
        type: candidateForAudit(match),
    });
    const lotToBitkinAudit = auditLotTypeLink({ lot: parsedLot, type: bitkinForAudit(match) });
    const bitkinToTypeAudit = auditLotTypeLink({
        lot: parseTitle(bitkinForAudit(match).name),
        type: candidateForAudit(match),
    });
    const denominationValues = [
        numericOrNull(parsedLot.denom?.value),
        bitkinDenominationValue(match.bitkin_denomination),
        numericOrNull(match.proposed_denomination_value),
    ];
    const years = [
        numericOrNull(parsedLot.year),
        numericOrNull(match.bitkin_year),
        numericOrNull(match.proposed_year),
    ];
    const denominationAgreement = sameFiniteValues(denominationValues);
    const yearAgreement = sameFiniteValues(years);
    const hasDirectConflict = denominationValues.filter(Number.isFinite).length >= 2
        && !sameFiniteValues(denominationValues.filter(Number.isFinite));
    const hasYearConflict = years.filter(Number.isFinite).length >= 2
        && !sameFiniteValues(years.filter(Number.isFinite));
    let action = 'exact_reference_strict_candidate';
    if (audit.status === 'conflict') action = 'proposed_type_conflicts';
    else if (hasDirectConflict || hasYearConflict
        || lotToBitkinAudit.status === 'conflict' || bitkinToTypeAudit.status === 'conflict') {
        action = 'cross_source_conflict';
    } else if (!denominationAgreement || !yearAgreement
        || lotToBitkinAudit.status !== 'consistent' || bitkinToTypeAudit.status !== 'consistent') {
        action = 'cross_source_unverified';
    }
    return {
        ...base,
        bitkin,
        action,
        proposedTypeId: Number(match.proposed_type_id),
        proposedTypeName: match.proposed_type_name,
        proposedMatchMethod: match.bitkin_match_method,
        proposedMatchConfidence: Number(match.bitkin_match_confidence),
        proposedMatchStatus: match.bitkin_match_status,
        proposedAuditStatus: audit.status,
        proposedAuditReasons: audit.reasons,
        proposedAuditEvidence: audit.evidence,
        lotToBitkinAudit,
        bitkinToTypeAudit,
        directAgreement: {
            denomination: denominationAgreement,
            denominationValues,
            year: yearAgreement,
            years,
        },
    };
}

async function findProposals() {
    const conflicts = await loadConflicts();
    const lots = conflicts.map((row) => ({ row, references: extractFullBitkinReferences(row.coin_description) }));
    const references = [...new Set(lots.flatMap((lot) => lot.references))];
    const imported = await loadReferences(references);
    const byReference = new Map();
    for (const row of imported) {
        const rows = byReference.get(row.bitkin_reference) || [];
        rows.push(row);
        byReference.set(row.bitkin_reference, rows);
    }

    const proposals = [];
    let withoutFullReference = 0;
    for (const lot of lots) {
        if (lot.references.length !== 1) {
            withoutFullReference += 1;
            continue;
        }
        proposals.push(classify(lot.row, byReference.get(lot.references[0]) || []));
    }
    const byAction = {};
    for (const proposal of proposals) byAction[proposal.action] = (byAction[proposal.action] || 0) + 1;
    return {
        conflicts,
        proposals,
        references,
        withoutFullReference,
        byAction,
    };
}

async function main() {
    const options = parseOptions(process.argv.slice(2));
    const result = await findProposals();
    const { conflicts, proposals, references, withoutFullReference, byAction } = result;
    let review = proposals.filter((proposal) => proposal.action !== 'exact_reference_reconfirms_current');
    if (options.strictOnly) {
        review = review.filter((proposal) => proposal.action === 'exact_reference_strict_candidate');
    }
    console.log(JSON.stringify({
        summary: {
            mode: 'dry-run',
            conflictingLotsMentioningBitkin: conflicts.length,
            withOneFullReference: proposals.length,
            withoutOneFullReference: withoutFullReference,
            uniqueFullReferences: references.length,
            byAction,
        },
        review: options.summaryOnly ? [] : (options.details ? review : review.slice(0, options.limit)),
    }, null, 2));
}

if (require.main === module) {
    main().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    }).finally(() => pool.end());
}

module.exports = {
    bitkinDenominationValue,
    bitkinForAudit,
    candidateForAudit,
    classify,
    extractFullBitkinReferences,
    findProposals,
    parseOptions,
    numericOrNull,
    sameFiniteValues,
};

'use strict';

const { parseTitle } = require('../catalog/coin-matcher');
const { auditLotTypeLink } = require('../domain/identity-link-quality');
const {
    bitkinDenominationValue,
    bitkinForAudit,
    candidateForAudit,
    numericOrNull,
    sameFiniteValues,
} = require('./propose-bitkin-lot-type-link-repairs');

let pool;

function getPool() {
    if (!pool) pool = require('../catalog/db').pool;
    return pool;
}

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

function extractShortBitkinReferences(description) {
    const references = [];
    const pattern = /(?:биткин(?:а)?|bitkin)[^|\n]{0,80}?(?:№\s*#?|#)\s*(?:[нn]\s*)?(\d{1,4})(?!\d)(?!\s*\.\s*\d)/giu;
    for (const match of String(description || '').matchAll(pattern)) references.push(match[1]);
    return [...new Set(references)];
}

function isExplicitMultiCoinLot(description) {
    return /(?<![а-яё])лот\s+из\s+(?:двух|тр[её]х|четыр[её]х|\d+)\s+экземпляров(?![а-яё])/iu
        .test(String(description || ''));
}

function compatibleIdentity(parsed, row) {
    if (row.proposed_type_id == null
        || Number(row.bitkin_match_confidence) < 0.99
        || !['auto', 'manual'].includes(String(row.bitkin_match_status || ''))) {
        return null;
    }
    const denominationValues = [
        numericOrNull(parsed.denom?.value),
        bitkinDenominationValue(row.bitkin_denomination),
        numericOrNull(row.proposed_denomination_value),
    ];
    const years = [
        numericOrNull(parsed.year),
        numericOrNull(row.bitkin_year),
        numericOrNull(row.proposed_year),
    ];
    if (!sameFiniteValues(denominationValues) || !sameFiniteValues(years)) return null;
    const lotToBitkinAudit = auditLotTypeLink({ lot: parsed, type: bitkinForAudit(row) });
    const proposedAudit = auditLotTypeLink({ lot: parsed, type: candidateForAudit(row) });
    const bitkinToTypeAudit = auditLotTypeLink({
        lot: parseTitle(bitkinForAudit(row).name),
        type: candidateForAudit(row),
    });
    if (lotToBitkinAudit.status !== 'consistent'
        || proposedAudit.status !== 'consistent'
        || bitkinToTypeAudit.status !== 'consistent') return null;
    if (Array.isArray(parsed.mints) && parsed.mints.length > 0
        && (!lotToBitkinAudit.evidence.includes('mint') || !proposedAudit.evidence.includes('mint'))) {
        return null;
    }
    return { denominationValues, years, lotToBitkinAudit, proposedAudit, bitkinToTypeAudit };
}

function classifyShortReference(row, matches, parsed = parseTitle(row.coin_description)) {
    const base = {
        lotId: Number(row.lot_id),
        description: row.coin_description,
        price: row.winning_bid == null ? null : Number(row.winning_bid),
        currency: row.currency,
        source: row.source_site,
        currentTypeId: Number(row.current_type_id),
        currentTypeName: row.current_type_name,
        currentReasons: row.reasons,
        shortReference: row.short_reference,
    };
    if (/^\s*\d+\s*\/\s*\d+/u.test(row.coin_description)) {
        return { ...base, action: 'fractional_title_deferred' };
    }
    if (parsed.isSet || parsed.isNonCoin || isExplicitMultiCoinLot(row.coin_description)) {
        return { ...base, action: 'multi_or_non_coin_lot_deferred' };
    }
    if (matches.length === 0) return { ...base, action: 'reference_not_imported' };
    const compatible = [];
    for (const match of matches) {
        const identity = compatibleIdentity(parsed, match);
        if (identity) compatible.push({ match, identity });
    }
    if (compatible.length === 0) {
        const hasUnbridgedIdentity = matches.some((match) => {
            const denominationValues = [
                numericOrNull(parsed.denom?.value),
                bitkinDenominationValue(match.bitkin_denomination),
            ];
            const years = [numericOrNull(parsed.year), numericOrNull(match.bitkin_year)];
            return match.proposed_type_id == null
                && sameFiniteValues(denominationValues)
                && sameFiniteValues(years);
        });
        return { ...base, action: hasUnbridgedIdentity ? 'exact_identity_without_type_match' : 'identity_unmatched' };
    }
    const targets = new Map();
    for (const candidate of compatible) {
        const typeId = Number(candidate.match.proposed_type_id);
        if (!targets.has(typeId)) targets.set(typeId, candidate);
    }
    if (targets.size !== 1) {
        return {
            ...base,
            action: 'catalog_ambiguous',
            candidateTypeIds: [...targets.keys()].sort((left, right) => left - right),
        };
    }
    const [{ match, identity }] = targets.values();
    if (Number(match.proposed_type_id) === Number(row.current_type_id)) {
        return { ...base, action: 'short_reference_reconfirms_current' };
    }
    return {
        ...base,
        action: 'short_reference_strict_candidate',
        bitkinEntryIds: [...new Set(compatible
            .filter((candidate) => Number(candidate.match.proposed_type_id) === Number(match.proposed_type_id))
            .map((candidate) => Number(candidate.match.entry_id)))],
        bitkinReferences: [...new Set(compatible.map((candidate) => candidate.match.bitkin_reference))],
        proposedTypeId: Number(match.proposed_type_id),
        proposedTypeName: match.proposed_type_name,
        proposedAuditEvidence: identity.proposedAudit.evidence,
        directAgreement: {
            denominationValues: identity.denominationValues,
            years: identity.years,
        },
    };
}

async function loadConflicts() {
    return (await getPool().query(
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
    )).rows;
}

async function loadReferences(references) {
    if (references.length === 0) return [];
    return (await getPool().query(
        `SELECT e.id AS entry_id,
                e.bitkin_reference,
                e.year AS bitkin_year,
                e.denomination AS bitkin_denomination,
                e.mint AS bitkin_mint,
                e.mint_mark AS bitkin_mint_mark,
                m.type_id AS proposed_type_id,
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
         WHERE split_part(e.bitkin_reference, '.', 2) = ANY($1::text[])
         ORDER BY e.bitkin_reference, m.match_confidence DESC NULLS LAST, m.type_id`,
        [references],
    )).rows;
}

async function findShortReferenceProposals() {
    const conflicts = await loadConflicts();
    const lots = conflicts.map((row) => ({
        row,
        references: extractShortBitkinReferences(row.coin_description),
    }));
    const references = [...new Set(lots.flatMap((lot) => lot.references))];
    const imported = await loadReferences(references);
    const byReference = new Map();
    for (const match of imported) {
        const short = String(match.bitkin_reference || '').split('.')[1];
        const rows = byReference.get(short) || [];
        rows.push(match);
        byReference.set(short, rows);
    }
    const proposals = [];
    let withoutOneShortReference = 0;
    for (const lot of lots) {
        if (lot.references.length !== 1) {
            withoutOneShortReference += 1;
            continue;
        }
        const shortReference = lot.references[0];
        proposals.push(classifyShortReference(
            { ...lot.row, short_reference: shortReference },
            byReference.get(shortReference) || [],
        ));
    }
    const byAction = {};
    for (const proposal of proposals) byAction[proposal.action] = (byAction[proposal.action] || 0) + 1;
    return { conflicts, proposals, references, withoutOneShortReference, byAction };
}

async function main() {
    const options = parseOptions(process.argv.slice(2));
    const result = await findShortReferenceProposals();
    let review = result.proposals.filter((proposal) => ![
        'short_reference_reconfirms_current',
        'identity_unmatched',
    ].includes(proposal.action));
    if (options.strictOnly) {
        review = review.filter((proposal) => proposal.action === 'short_reference_strict_candidate');
    }
    console.log(JSON.stringify({
        summary: {
            mode: 'dry-run',
            conflictingLotsMentioningBitkin: result.conflicts.length,
            withOneShortReference: result.proposals.length,
            withoutOneShortReference: result.withoutOneShortReference,
            uniqueShortReferences: result.references.length,
            byAction: result.byAction,
        },
        review: options.summaryOnly ? [] : (options.details ? review : review.slice(0, options.limit)),
    }, null, 2));
}

if (require.main === module) {
    main().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    }).finally(() => (pool ? pool.end() : undefined));
}

module.exports = {
    classifyShortReference,
    compatibleIdentity,
    extractShortBitkinReferences,
    findShortReferenceProposals,
    isExplicitMultiCoinLot,
    parseOptions,
};

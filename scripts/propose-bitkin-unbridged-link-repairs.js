'use strict';

const { pool } = require('../catalog/db');
const { matchType, parseTitle } = require('../catalog/coin-matcher');
const { auditLotTypeLink } = require('../domain/identity-link-quality');
const {
    bitkinDenominationValue,
    bitkinForAudit,
    findProposals,
    numericOrNull,
    sameFiniteValues,
} = require('./propose-bitkin-lot-type-link-repairs');

function parseOptions(argv) {
    const rawLimit = argv.find((value) => value.startsWith('--limit='))?.slice('--limit='.length) || '50';
    const limit = Number(rawLimit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
        throw new Error('--limit must be 1..1000');
    }
    return {
        limit,
        strictOnly: argv.includes('--strict-only'),
        summaryOnly: argv.includes('--summary-only'),
    };
}

async function loadType(typeId) {
    const result = await pool.query(
        `SELECT id, name_full, source, country, year, year_start, year_end,
                denomination_text, denomination_value, mint
         FROM coin_type
         WHERE id = $1`,
        [typeId],
    );
    return result.rows[0] || null;
}

async function compatibleTypes(parsed, type) {
    const year = numericOrNull(parsed.year);
    const denominationValue = numericOrNull(parsed.denom?.value);
    if (year == null || denominationValue == null) return [];
    const result = await pool.query(
        `SELECT id, name_full, source, country, year, year_start, year_end,
                denomination_text, denomination_value, mint
         FROM coin_type
         WHERE era = 'imperial'
           AND year = $1
           AND denomination_value = $2`,
        [year, denominationValue],
    );
    return result.rows.filter((candidate) => {
        const audit = auditLotTypeLink({ lot: parsed, type: typeForAudit(candidate) });
        return audit.status === 'consistent'
            && (parsed.mints.length === 0 || audit.evidence.includes('mint'));
    });
}

function typeForAudit(type) {
    return {
        name: type.name_full,
        country: type.country,
        year: type.year,
        yearStart: type.year_start,
        yearEnd: type.year_end,
        denominationText: type.denomination_text,
        denominationValue: type.denomination_value,
        mint: type.mint,
    };
}

function classifyCandidate(proposal, matched, type) {
    const parsed = parseTitle(proposal.description);
    const audit = auditLotTypeLink({ lot: parsed, type: typeForAudit(type) });
    const bitkinRow = {
        bitkin_denomination: proposal.bitkin.denomination,
        bitkin_year: proposal.bitkin.year,
        bitkin_mint: proposal.bitkin.mint,
        bitkin_mint_mark: proposal.bitkin.mintMark,
    };
    const lotToBitkinAudit = auditLotTypeLink({ lot: parsed, type: bitkinForAudit(bitkinRow) });
    const bitkinToTypeAudit = auditLotTypeLink({
        lot: parseTitle(bitkinForAudit(bitkinRow).name),
        type: typeForAudit(type),
    });
    const denominationValues = [
        numericOrNull(parsed.denom?.value),
        bitkinDenominationValue(proposal.bitkin.denomination),
        numericOrNull(type.denomination_value),
    ];
    const years = [numericOrNull(parsed.year), numericOrNull(proposal.bitkin.year), numericOrNull(type.year)];
    let action = 'unbridged_strict_candidate';
    if (Number(type.id) === proposal.currentTypeId) action = 'matcher_reconfirms_current';
    else if (type.source === 'bitkin') action = 'coarse_catalog_target';
    else if (audit.status === 'conflict') action = 'proposed_type_conflicts';
    else if (lotToBitkinAudit.status === 'conflict' || bitkinToTypeAudit.status === 'conflict') {
        action = 'cross_source_conflict';
    } else if (!sameFiniteValues(denominationValues) || !sameFiniteValues(years)
        || (parsed.mints.length > 0 && !audit.evidence.includes('mint'))
        || lotToBitkinAudit.status !== 'consistent' || bitkinToTypeAudit.status !== 'consistent') {
        action = 'cross_source_unverified';
    }
    return {
        lotId: proposal.lotId,
        description: proposal.description,
        price: proposal.price,
        reference: proposal.bitkin.reference,
        bitkinEntryId: proposal.bitkin.entryId,
        bitkinYear: proposal.bitkin.year,
        bitkinDenomination: proposal.bitkin.denomination,
        bitkinMint: proposal.bitkin.mintMark,
        currentTypeId: proposal.currentTypeId,
        currentTypeName: proposal.currentTypeName,
        currentReasons: proposal.currentReasons,
        action,
        proposedTypeId: Number(type.id),
        proposedTypeName: type.name_full,
        proposedConfidence: Number(matched.conf),
        proposedAudit: audit,
        lotToBitkinAudit,
        bitkinToTypeAudit,
        directAgreement: { denominationValues, years },
    };
}

async function findUnbridgedProposals() {
    const initial = await findProposals();
    const unbridged = initial.proposals.filter(
        (proposal) => proposal.action === 'exact_reference_without_type_match',
    );
    const results = [];
    for (let index = 0; index < unbridged.length; index++) {
        const proposal = unbridged[index];
        const matched = await matchType(pool, parseTitle(proposal.description));
        if (!matched) {
            results.push({
                lotId: proposal.lotId,
                description: proposal.description,
                reference: proposal.bitkin.reference,
                currentTypeId: proposal.currentTypeId,
                currentTypeName: proposal.currentTypeName,
                action: 'unresolved',
            });
        } else {
            const type = await loadType(Number(matched.id));
            if (!type) {
                results.push({ lotId: proposal.lotId, action: 'unresolved' });
            } else {
                const classified = classifyCandidate(proposal, matched, type);
                if (classified.action === 'unbridged_strict_candidate') {
                    const compatible = await compatibleTypes(parseTitle(proposal.description), type);
                    classified.compatibleTypeIds = compatible.map((candidate) => Number(candidate.id));
                    if (compatible.length !== 1 || Number(compatible[0].id) !== Number(type.id)) {
                        classified.action = 'catalog_ambiguous';
                    }
                }
                results.push(classified);
            }
        }
        if ((index + 1) % 50 === 0) console.error(`processed=${index + 1}`);
    }
    const byAction = {};
    for (const result of results) byAction[result.action] = (byAction[result.action] || 0) + 1;
    return { unbridged, results, byAction };
}

async function main() {
    const options = parseOptions(process.argv.slice(2));
    const { unbridged, results, byAction } = await findUnbridgedProposals();
    const review = options.strictOnly
        ? results.filter((result) => result.action === 'unbridged_strict_candidate')
        : results.filter((result) => result.action !== 'matcher_reconfirms_current');
    console.log(JSON.stringify({
        summary: {
            mode: 'dry-run',
            selected: unbridged.length,
            uniqueReferences: new Set(unbridged.map((proposal) => proposal.bitkin.reference)).size,
            byAction,
        },
        review: options.summaryOnly ? [] : review.slice(0, options.limit),
    }, null, 2));
}

if (require.main === module) {
    main().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    }).finally(() => pool.end());
}

module.exports = {
    classifyCandidate,
    compatibleTypes,
    findUnbridgedProposals,
    parseOptions,
    typeForAudit,
};

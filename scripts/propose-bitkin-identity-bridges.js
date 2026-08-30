'use strict';

const { parseTitle } = require('../catalog/coin-matcher');
const { auditLotTypeLink, extractMints } = require('../domain/identity-link-quality');
const { candidateForAudit, numericOrNull } = require('./propose-bitkin-lot-type-link-repairs');
const { findShortReferenceProposals } = require('./propose-bitkin-short-reference-link-repairs');

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
    return { limit, details: argv.includes('--details'), summaryOnly: argv.includes('--summary-only') };
}

function compatibleCatalogTypes(parsed, candidates) {
    return candidates.filter((candidate) => {
        if (candidate.source === 'bitkin'
            || String(candidate.proposed_country || candidate.country || '').toUpperCase() !== 'RU') return false;
        const lotMints = new Set((parsed.mints || []).map((value) => String(value).toUpperCase()));
        const storedMintSets = [
            extractMints(candidate.proposed_mint),
            extractMints(candidate.proposed_type_name),
        ].filter((values) => values.size > 0);
        if (lotMints.size > 0
            && (storedMintSets.length === 0
                || storedMintSets.some((values) => ![...values].some((value) => lotMints.has(value))))) return false;
        const audit = auditLotTypeLink({ lot: parsed, type: candidateForAudit(candidate) });
        return audit.status === 'consistent'
            && (!Array.isArray(parsed.mints) || parsed.mints.length === 0 || audit.evidence.includes('mint'));
    });
}

async function loadCatalogCandidates(parsed) {
    const year = numericOrNull(parsed.year);
    const denominationValue = numericOrNull(parsed.denom?.value);
    if (year == null || denominationValue == null) return [];
    return (await getPool().query(
        `SELECT id AS proposed_type_id,
                name_full AS proposed_type_name,
                source,
                country AS proposed_country,
                year AS proposed_year,
                year_start AS proposed_year_start,
                year_end AS proposed_year_end,
                denomination_text AS proposed_denomination_text,
                denomination_value AS proposed_denomination_value,
                mint AS proposed_mint
         FROM coin_type
         WHERE era = 'imperial'
           AND year = $1
           AND (denomination_value = $2 OR denomination_value IS NULL)
         ORDER BY id`,
        [year, denominationValue],
    )).rows;
}

function groupUnbridged(proposals) {
    const groups = new Map();
    for (const proposal of proposals) {
        if (proposal.action !== 'exact_identity_without_type_match' || proposal.bitkinEntryIds.length !== 1) continue;
        const entryId = proposal.bitkinEntryIds[0];
        const group = groups.get(entryId) || {
            entryId,
            reference: proposal.bitkinReferences[0],
            shortReference: proposal.shortReference,
            lotCount: 0,
            pricedLotCount: 0,
            rubExposure: 0,
            sampleLotId: proposal.lotId,
            sampleDescription: proposal.description,
        };
        group.lotCount += 1;
        if (proposal.currency === 'RUB' && Number.isFinite(proposal.price)) {
            group.pricedLotCount += 1;
            group.rubExposure += proposal.price;
        }
        groups.set(entryId, group);
    }
    return [...groups.values()];
}

async function findIdentityBridges() {
    const short = await findShortReferenceProposals();
    const groups = groupUnbridged(short.proposals);
    const results = [];
    for (const group of groups) {
        const parsed = parseTitle(group.sampleDescription);
        const compatible = compatibleCatalogTypes(parsed, await loadCatalogCandidates(parsed));
        if (compatible.length === 1) {
            results.push({
                ...group,
                action: 'unique_catalog_type',
                proposedTypeId: Number(compatible[0].proposed_type_id),
                proposedTypeName: compatible[0].proposed_type_name,
            });
        } else {
            results.push({
                ...group,
                action: compatible.length ? 'catalog_ambiguous' : 'catalog_type_missing',
                candidateTypeIds: compatible.map((candidate) => Number(candidate.proposed_type_id)),
            });
        }
    }
    const byAction = {};
    for (const result of results) byAction[result.action] = (byAction[result.action] || 0) + 1;
    return { groups, results, byAction };
}

async function main() {
    const options = parseOptions(process.argv.slice(2));
    const result = await findIdentityBridges();
    const candidates = result.results.filter((item) => item.action === 'unique_catalog_type');
    console.log(JSON.stringify({
        summary: {
            mode: 'dry-run',
            unbridgedEntries: result.groups.length,
            byAction: result.byAction,
            candidateEntries: candidates.length,
            candidateLots: candidates.reduce((sum, item) => sum + item.lotCount, 0),
            candidateRubExposure: candidates.reduce((sum, item) => sum + item.rubExposure, 0),
        },
        review: options.summaryOnly ? [] : (options.details ? result.results : result.results.slice(0, options.limit)),
    }, null, 2));
}

if (require.main === module) {
    main().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    }).finally(() => (pool ? pool.end() : undefined));
}

module.exports = {
    compatibleCatalogTypes,
    findIdentityBridges,
    groupUnbridged,
    parseOptions,
};

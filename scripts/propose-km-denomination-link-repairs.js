'use strict';

const { countryEn, parseTitle } = require('../catalog/coin-matcher');
const { auditLotTypeLink, resolveLotYear } = require('../domain/identity-link-quality');

const AUDIT_VERSION = 'hard-consistency-v1';

function parseOptions(argv) {
    const rawLimit = argv.find((value) => value.startsWith('--limit='))?.slice('--limit='.length) || '50';
    const limit = Number(rawLimit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
        throw new Error('--limit must be 1..1000');
    }
    return { limit, summaryOnly: argv.includes('--summary-only') };
}

function normalizeKmReference(value) {
    return String(value || '')
        .toUpperCase()
        .replace(/^(?:KM|КМ)\s*(?:№|N[OО]?|#)?\s*/u, '')
        .replace(/[А]/gu, 'A')
        .replace(/[В]/gu, 'B')
        .replace(/[^0-9A-Z]/gu, '');
}

function extractKmReferences(description) {
    const references = [];
    const pattern = /(?:^|[^A-ZА-ЯЁ0-9])(?:KM|КМ|KRAUSE|КРАУЗЕ)\s*(?:№|N[OО]?|#)?\s*([0-9]{1,5}(?:[.\-/][0-9A-ZА-Я]{1,8})?[A-ZА-Я]?)/giu;
    for (const match of String(description || '').matchAll(pattern)) {
        const normalized = normalizeKmReference(match[1]);
        if (normalized) references.push(normalized);
    }
    return [...new Set(references)];
}

function typeForAudit(row) {
    return {
        name: row.name_full,
        country: row.country,
        year: row.year,
        coinYear: row.coin_year,
        yearStart: row.year_start,
        yearEnd: row.year_end,
        denominationText: row.denomination_text,
        denominationValue: row.denomination_value,
        mint: row.mint,
    };
}

function candidateQuality({ parsed, country, candidates, currentTypeId }) {
    const compatible = candidates.filter((candidate) => {
        if (candidate.country !== country) return false;
        const audit = auditLotTypeLink({ lot: parsed, type: typeForAudit(candidate) });
        return audit.status === 'consistent'
            && audit.evidence.some((item) => item === 'year' || item === 'year_or_coin_year')
            && audit.evidence.some((item) => item.startsWith('denomination_'));
    });
    if (compatible.length === 0) return { action: 'reference_has_no_compatible_type', compatible: [] };
    if (compatible.length > 1) return { action: 'reference_is_catalog_ambiguous', compatible };
    const candidate = compatible[0];
    if (Number(candidate.id) === Number(currentTypeId)) {
        return { action: 'exact_reference_reconfirms_current', compatible };
    }
    return { action: 'exact_km_strict_candidate', compatible };
}

async function loadConflicts(pool) {
    return (await pool.query(
        `SELECT lq.lot_id, lq.type_id AS current_type_id, lq.reasons,
                al.coin_description, al.year AS lot_year, al.winning_bid,
                al.currency, al.source_site,
                current_type.name_full AS current_type_name,
                current_type.country AS current_type_country
         FROM lot_type_link_quality lq
         JOIN lot_type_link ltl
           ON ltl.lot_id = lq.lot_id
          AND ltl.type_id = lq.type_id
         JOIN auction_lots al ON al.id = lq.lot_id
         JOIN coin_type current_type ON current_type.id = lq.type_id
         WHERE lq.audit_version = $1
           AND lq.status = 'conflict'
           AND (lq.reasons ? 'denomination_unit_mismatch'
                OR lq.reasons ? 'denomination_value_mismatch')
         ORDER BY al.winning_bid DESC NULLS LAST, lq.lot_id`,
        [AUDIT_VERSION],
    )).rows;
}

async function loadCandidates(pool, references) {
    if (references.length === 0) return [];
    return (await pool.query(
        `SELECT id, name_full, country, year, coin_year, year_start, year_end,
                denomination_text, denomination_value, mint, km_number,
                source, ref_source
         FROM coin_type
         WHERE km_number IS NOT NULL
           AND regexp_replace(
                 regexp_replace(upper(km_number), '^(KM|КМ)[^0-9]*', '', 'g'),
                 '[^0-9A-Z]', '', 'g'
               ) = ANY($1::text[])
         ORDER BY km_number, id`,
        [references],
    )).rows;
}

async function findProposals(pool) {
    const rows = await loadConflicts(pool);
    const lots = rows.map((row) => ({ row, references: extractKmReferences(row.coin_description) }));
    const references = [...new Set(lots.flatMap((lot) => lot.references))];
    const candidateRows = await loadCandidates(pool, references);
    const byReference = new Map();
    for (const candidate of candidateRows) {
        const key = normalizeKmReference(candidate.km_number);
        const values = byReference.get(key) || [];
        values.push(candidate);
        byReference.set(key, values);
    }

    const results = [];
    let withoutOneReference = 0;
    for (const lot of lots) {
        if (lot.references.length !== 1) {
            withoutOneReference += 1;
            continue;
        }
        const row = lot.row;
        const parsed = parseTitle(row.coin_description);
        if (parsed.isSet || parsed.isNonCoin || !parsed.denom) {
            results.push({
                lotId: Number(row.lot_id),
                reference: lot.references[0],
                action: 'unsupported_lot_shape',
            });
            continue;
        }
        const resolvedYear = resolveLotYear({
            parsedYear: parsed.year,
            storedYear: row.lot_year,
            description: row.coin_description,
        });
        parsed.year = resolvedYear.year;
        const country = parsed.denom.isRf
            ? (parsed.year != null && parsed.year <= 1991 && parsed.year >= 1921 ? 'SU' : 'RU')
            : await countryEn(pool, row.coin_description);
        if (!country) {
            results.push({
                lotId: Number(row.lot_id),
                reference: lot.references[0],
                action: 'country_unresolved',
            });
            continue;
        }
        if (row.current_type_country && row.current_type_country !== country) {
            results.push({
                lotId: Number(row.lot_id),
                reference: lot.references[0],
                titleCountry: country,
                currentTypeCountry: row.current_type_country,
                action: 'country_evidence_conflict',
            });
            continue;
        }
        const quality = candidateQuality({
            parsed,
            country,
            candidates: byReference.get(lot.references[0]) || [],
            currentTypeId: row.current_type_id,
        });
        const candidate = quality.compatible.length === 1 ? quality.compatible[0] : null;
        results.push({
            lotId: Number(row.lot_id),
            description: row.coin_description,
            price: row.winning_bid == null ? null : Number(row.winning_bid),
            currency: row.currency,
            source: row.source_site,
            reference: lot.references[0],
            country,
            currentTypeId: Number(row.current_type_id),
            currentTypeName: row.current_type_name,
            currentTypeCountry: row.current_type_country,
            currentReasons: row.reasons,
            action: quality.action,
            compatibleTypeIds: quality.compatible.map((item) => Number(item.id)),
            proposedTypeId: candidate == null ? null : Number(candidate.id),
            proposedTypeName: candidate?.name_full || null,
            proposedCatalogSource: candidate?.source || null,
            proposedRefSource: candidate?.ref_source || null,
        });
    }
    const byAction = {};
    for (const result of results) byAction[result.action] = (byAction[result.action] || 0) + 1;
    return {
        conflicts: rows.length,
        withoutOneReference,
        uniqueReferences: references.length,
        results,
        byAction,
    };
}

async function main() {
    const { pool } = require('../catalog/db');
    const options = parseOptions(process.argv.slice(2));
    try {
        const result = await findProposals(pool);
        const review = result.results.filter((item) => item.action === 'exact_km_strict_candidate');
        console.log(JSON.stringify({
            summary: {
                mode: 'dry-run',
                conflicts: result.conflicts,
                withOneKmReference: result.results.length,
                withoutOneKmReference: result.withoutOneReference,
                uniqueKmReferences: result.uniqueReferences,
                byAction: result.byAction,
            },
            review: options.summaryOnly ? [] : review.slice(0, options.limit),
        }, null, 2));
    } finally {
        await pool.end();
    }
}

if (require.main === module) main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

module.exports = {
    AUDIT_VERSION,
    candidateQuality,
    extractKmReferences,
    findProposals,
    normalizeKmReference,
    parseOptions,
    typeForAudit,
};

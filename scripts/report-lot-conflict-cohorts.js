'use strict';

const { parseTitle } = require('../catalog/coin-matcher');
const { extractMints, resolveLotYear } = require('../domain/identity-link-quality');
const {
    AUDIT_VERSION,
    lotDenomination,
    reasonGroup,
    typeDenomination,
} = require('./report-lot-denomination-conflicts');

const MAJOR_MINOR = new Set([
    'RUBLE:KOPEK', 'KOPEK:RUBLE',
    'DOLLAR:CENT_MINOR', 'CENT_MINOR:DOLLAR',
    'FRANC:CENT_MINOR', 'CENT_MINOR:FRANC',
    'POUND:PENNY', 'PENNY:POUND',
    'MARK:PFENNIG', 'PFENNIG:MARK',
]);

function parseOptions(argv) {
    const rawLimit = argv.find((value) => value.startsWith('--limit='))?.slice('--limit='.length) || '30';
    const limit = Number(rawLimit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
        throw new Error('--limit must be 1..100');
    }
    return { limit };
}

function reasonSet(reasons) {
    return new Set(Array.isArray(reasons) ? reasons : []);
}

function leadingFraction(value) {
    const match = String(value || '').trim().match(/^(\d+)\s*\/\s*(\d+)(?!\d)/u);
    if (!match || Number(match[2]) === 0) return null;
    return Number(match[1]) / Number(match[2]);
}

function denominationCause(lot, type) {
    if (lot.family === 'KOPEK' && lot.number === 0.5
        && type.family === 'KOPEK' && type.number === 2) {
        return 'half_kopeck_to_two_kopecks';
    }
    if (lot.family && lot.family === type.family
        && lot.number != null && lot.number > 0 && lot.number < 1
        && type.number != null && type.number >= 1) {
        return 'fraction_to_whole_same_unit';
    }
    if (MAJOR_MINOR.has(`${lot.family}:${type.family}`)) return 'major_minor_unit_collision';
    if (lot.family && type.family && lot.family !== type.family) return 'denomination_unit_collision';
    if (lot.family && lot.family === type.family
        && lot.number != null && type.number != null && lot.number !== type.number) {
        return 'denomination_value_collision';
    }
    return 'denomination_unclassified';
}

function classifyRow(row) {
    const parsed = parseTitle(row.coin_description);
    const resolvedYear = resolveLotYear({
        parsedYear: parsed.year,
        storedYear: row.lot_year,
        description: row.coin_description,
    });
    const lot = lotDenomination(parsed);
    const type = typeDenomination(row);
    const reasons = reasonSet(row.reasons);
    const hasDenomination = reasons.has('denomination_unit_mismatch')
        || reasons.has('denomination_value_mismatch');
    const hasMint = reasons.has('mint_mismatch');
    const hasYear = reasons.has('year_mismatch');
    const lotFraction = leadingFraction(row.coin_description);
    const typeFraction = leadingFraction(row.denomination_text || row.current_type_name);
    const sameExplicitFraction = lotFraction != null
        && typeFraction != null
        && Math.abs(lotFraction - typeFraction) < 1e-9;
    let cause;
    if (hasDenomination && sameExplicitFraction) cause = 'matcher_fraction_parse_false_positive';
    else if (hasDenomination) cause = denominationCause(lot, type);
    else if (hasMint && !hasYear) cause = 'mint_only';
    else if (hasYear && !hasMint) cause = 'year_only';
    else if (hasMint && hasYear) cause = 'year_and_mint';
    else cause = 'unclassified';

    const lotMints = [...new Set(parsed.mints.map((value) => String(value).toUpperCase()))].sort();
    const typeMints = [...extractMints(`${row.type_mint || ''} ${row.current_type_name || ''}`)].sort();
    const typeYearStart = row.type_year_start == null ? row.type_year : row.type_year_start;
    const typeYearEnd = row.type_year_end == null ? row.type_year : row.type_year_end;
    let identityPair;
    if (hasDenomination) identityPair = `${lot.key} -> ${type.key}`;
    else if (hasMint) identityPair = `${lotMints.join('+') || '?'} -> ${typeMints.join('+') || '?'}`;
    else if (hasYear) identityPair = `${resolvedYear.year ?? '?'} -> ${typeYearStart ?? '?'}..${typeYearEnd ?? '?'}`;
    else identityPair = '(none)';

    const combined = [hasDenomination && 'denomination', hasMint && 'mint', hasYear && 'year']
        .filter(Boolean).join('+');
    return {
        cause,
        combined,
        signature: `${cause}|${row.era || 'modern/cbr'}|${identityPair}`,
        identityPair,
        lotDenomination: lot,
        typeDenomination: type,
        lotMints,
        typeMints,
        lotYear: resolvedYear.year,
        typeYearStart: typeYearStart == null ? null : Number(typeYearStart),
        typeYearEnd: typeYearEnd == null ? null : Number(typeYearEnd),
    };
}

function increment(object, key, amount = 1) {
    object[key] = (object[key] || 0) + amount;
}

function addImpact(group, row) {
    group.count += 1;
    group.typeIds.add(Number(row.type_id));
    increment(group.bySourceSite, row.source_site || '(null)');
    increment(group.byMatchMethod, row.match_method || '(null)');
    increment(group.byCatalogSource, row.catalog_source || '(null)');
    const price = row.winning_bid == null ? null : Number(row.winning_bid);
    if (Number.isFinite(price)) {
        const currency = row.currency || '(null)';
        const impact = group.priceByCurrency[currency] ||= { pricedLots: 0, total: 0, max: null };
        impact.pricedLots += 1;
        impact.total += price;
        impact.max = impact.max == null ? price : Math.max(impact.max, price);
        const sample = {
            lotId: Number(row.lot_id),
            price,
            currency: row.currency,
            description: row.coin_description,
            currentTypeId: Number(row.type_id),
            currentTypeName: row.current_type_name,
        };
        group.samples.push(sample);
        group.samples.sort((left, right) => right.price - left.price || left.lotId - right.lotId);
        group.samples.length = Math.min(group.samples.length, 3);
    }
}

function newGroup(label) {
    return {
        label,
        count: 0,
        typeIds: new Set(),
        priceByCurrency: {},
        bySourceSite: {},
        byMatchMethod: {},
        byCatalogSource: {},
        samples: [],
    };
}

function finalizeGroup(group) {
    const sort = (object) => Object.fromEntries(Object.entries(object)
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])));
    return {
        label: group.label,
        count: group.count,
        distinctCurrentTypes: group.typeIds.size,
        priceByCurrency: group.priceByCurrency,
        bySourceSite: sort(group.bySourceSite),
        byMatchMethod: sort(group.byMatchMethod),
        byCatalogSource: sort(group.byCatalogSource),
        samples: group.samples,
    };
}

function summarizeRows(rows, { limit = 30 } = {}) {
    const causes = new Map();
    const signatures = new Map();
    const combinations = {};
    for (const row of rows) {
        const classified = classifyRow(row);
        increment(combinations, classified.combined || '(none)');
        const cause = causes.get(classified.cause) || newGroup(classified.cause);
        addImpact(cause, row);
        causes.set(classified.cause, cause);
        const signature = signatures.get(classified.signature) || newGroup(classified.signature);
        addImpact(signature, row);
        signatures.set(classified.signature, signature);
    }
    const byCount = (values) => values.sort((left, right) => right.count - left.count
        || left.label.localeCompare(right.label));
    const rubTotal = (value) => value.priceByCurrency.RUB?.total || 0;
    const causeRows = byCount([...causes.values()].map(finalizeGroup));
    const signatureRows = [...signatures.values()].map(finalizeGroup);
    return {
        summary: {
            mode: 'read-only',
            auditVersion: AUDIT_VERSION,
            conflicts: rows.length,
            byReasonDimensions: Object.fromEntries(Object.entries(combinations)
                .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))),
            rootCauses: causeRows,
        },
        topSignaturesByCount: byCount([...signatureRows]).slice(0, limit),
        topSignaturesByRubImpact: signatureRows
            .sort((left, right) => rubTotal(right) - rubTotal(left) || right.count - left.count)
            .slice(0, limit),
    };
}

async function loadConflicts(pool) {
    return (await pool.query(
        `SELECT lq.lot_id, lq.type_id, lq.reasons,
                al.coin_description, al.year AS lot_year, al.winning_bid,
                al.currency, al.source_site,
                ltl.match_method, ltl.match_confidence,
                ct.name_full AS current_type_name,
                ct.country, ct.era, ct.source AS catalog_source,
                ct.ref_source, ct.year AS type_year,
                ct.year_start AS type_year_start, ct.year_end AS type_year_end,
                ct.denomination_text, ct.denomination_value, ct.mint AS type_mint
         FROM lot_type_link_quality lq
         JOIN lot_type_link ltl
           ON ltl.lot_id = lq.lot_id
          AND ltl.type_id = lq.type_id
         JOIN auction_lots al ON al.id = lq.lot_id
         JOIN coin_type ct ON ct.id = lq.type_id
         WHERE lq.audit_version = $1
           AND lq.status = 'conflict'
         ORDER BY al.winning_bid DESC NULLS LAST, lq.lot_id`,
        [AUDIT_VERSION],
    )).rows;
}

async function main() {
    const { pool } = require('../catalog/db');
    const options = parseOptions(process.argv.slice(2));
    try {
        console.log(JSON.stringify(summarizeRows(await loadConflicts(pool), options), null, 2));
    } finally {
        await pool.end();
    }
}

if (require.main === module) main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

module.exports = {
    classifyRow,
    denominationCause,
    leadingFraction,
    parseOptions,
    summarizeRows,
};

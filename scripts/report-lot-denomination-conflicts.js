'use strict';

const { parseTitle, themeWords } = require('../catalog/coin-matcher');
const { typeNumber, typeUnit, unitFamily } = require('../domain/identity-link-quality');

const AUDIT_VERSION = 'hard-consistency-v1';

function parseOptions(argv) {
    const rawLimit = argv.find((value) => value.startsWith('--limit='))?.slice('--limit='.length) || '10';
    const limit = Number(rawLimit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
        throw new Error('--limit must be 1..100');
    }
    return { limit, summaryOnly: argv.includes('--summary-only') };
}

function reasonGroup(reasons) {
    const values = new Set(Array.isArray(reasons) ? reasons : []);
    const unit = values.has('denomination_unit_mismatch');
    const value = values.has('denomination_value_mismatch');
    const other = [...values].filter((reason) => !reason.startsWith('denomination_'));
    const denomination = unit && value ? 'unit_and_value' : (unit ? 'unit' : (value ? 'value' : 'none'));
    return other.length ? `${denomination}+${other.sort().join('+')}` : denomination;
}

function lotDenomination(parsed) {
    const denomination = parsed?.denom;
    if (!denomination) return { key: '(unparsed)', number: null, unit: null, family: null, rubleValue: null };
    const number = Number.isFinite(Number(denomination.num)) ? Number(denomination.num) : null;
    const unit = String(denomination.unit || '').toLowerCase() || null;
    const family = unitFamily(unit);
    const rubleValue = Number.isFinite(Number(denomination.value)) ? Number(denomination.value) : null;
    return {
        key: `${number ?? '?'} ${family || unit || '?'}`,
        number,
        unit,
        family,
        rubleValue,
    };
}

function typeDenomination(row) {
    const text = row.denomination_text || row.current_type_name || '';
    const unit = typeUnit(text);
    const family = unitFamily(unit);
    const number = typeNumber(text);
    const storedValue = row.denomination_value == null ? null : Number(row.denomination_value);
    return {
        key: `${Number.isFinite(number) ? number : '?'} ${family || String(unit || '').toLowerCase() || '?'}`,
        text: row.denomination_text || null,
        number: Number.isFinite(number) ? number : null,
        unit,
        family,
        storedValue: Number.isFinite(storedValue) ? storedValue : null,
    };
}

function themeEvidence(parsed, row) {
    const lotWords = parsed?.words || [];
    const typeWords = themeWords(`${row.current_type_name || ''} ${row.theme_ru || ''} ${row.theme_core || ''}`);
    const typeSet = new Set(typeWords);
    const overlap = lotWords.filter((word) => typeSet.has(word));
    return {
        lotWordCount: lotWords.length,
        typeWordCount: typeWords.length,
        overlapCount: overlap.length,
        overlap,
    };
}

function increment(object, key, amount = 1) {
    object[key] = (object[key] || 0) + amount;
}

function sortObject(object) {
    return Object.fromEntries(Object.entries(object)
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])));
}

function summarizeRows(rows, { limit = 10, summaryOnly = false } = {}) {
    const dimensions = {
        byReasonGroup: {},
        bySourceSite: {},
        byCatalogSource: {},
        byEra: {},
        byCountry: {},
        byMatchMethod: {},
        byDenominationPair: {},
    };
    const types = new Map();
    const currencyImpact = {};
    const classified = [];

    for (const row of rows) {
        const parsed = parseTitle(row.coin_description);
        const lot = lotDenomination(parsed);
        const type = typeDenomination(row);
        const group = reasonGroup(row.reasons);
        const price = row.winning_bid == null ? null : Number(row.winning_bid);
        const currency = row.currency || '(null)';
        const item = {
            lotId: Number(row.lot_id),
            description: row.coin_description,
            price: Number.isFinite(price) ? price : null,
            currency: row.currency,
            sourceSite: row.source_site,
            reasons: row.reasons,
            reasonGroup: group,
            lotDenomination: lot,
            typeId: Number(row.type_id),
            typeName: row.current_type_name,
            typeDenomination: type,
            typeCountry: row.country,
            typeEra: row.era,
            catalogSource: row.catalog_source,
            refSource: row.ref_source,
            matchMethod: row.match_method,
            matchConfidence: row.match_confidence == null ? null : Number(row.match_confidence),
            themeEvidence: themeEvidence(parsed, row),
        };
        classified.push(item);

        increment(dimensions.byReasonGroup, group);
        increment(dimensions.bySourceSite, row.source_site || '(null)');
        increment(dimensions.byCatalogSource, row.catalog_source || '(null)');
        increment(dimensions.byEra, row.era || 'modern/cbr');
        increment(dimensions.byCountry, row.country || '(null)');
        increment(dimensions.byMatchMethod, row.match_method || '(null)');
        increment(dimensions.byDenominationPair, `${lot.key} -> ${type.key}`);

        const impact = currencyImpact[currency] ||= { pricedLots: 0, totalWinningBid: 0, maxWinningBid: null };
        if (Number.isFinite(price)) {
            impact.pricedLots += 1;
            impact.totalWinningBid += price;
            impact.maxWinningBid = impact.maxWinningBid == null ? price : Math.max(impact.maxWinningBid, price);
        }

        const typeSummary = types.get(item.typeId) || {
            typeId: item.typeId,
            typeName: item.typeName,
            denomination: item.typeDenomination,
            country: item.typeCountry,
            era: item.typeEra,
            catalogSource: item.catalogSource,
            count: 0,
            pricedLots: 0,
            winningBidByCurrency: {},
            lotDenominations: {},
        };
        typeSummary.count += 1;
        increment(typeSummary.lotDenominations, lot.key);
        if (Number.isFinite(price)) {
            typeSummary.pricedLots += 1;
            increment(typeSummary.winningBidByCurrency, currency, price);
        }
        types.set(item.typeId, typeSummary);
    }

    for (const [key, value] of Object.entries(dimensions)) dimensions[key] = sortObject(value);
    const highestValueLots = classified
        .filter((row) => row.price != null)
        .sort((left, right) => right.price - left.price || left.lotId - right.lotId)
        .slice(0, limit);
    const topCurrentTypes = [...types.values()]
        .map((type) => ({ ...type, lotDenominations: sortObject(type.lotDenominations) }))
        .sort((left, right) => right.count - left.count || left.typeId - right.typeId)
        .slice(0, 50);

    return {
        summary: {
            mode: 'read-only',
            auditVersion: AUDIT_VERSION,
            conflicts: rows.length,
            dimensions,
            currencyImpact,
            topCurrentTypes,
        },
        highestValueLots: summaryOnly ? [] : highestValueLots,
    };
}

async function loadConflicts(pool) {
    return (await pool.query(
        `SELECT lq.lot_id,
                lq.type_id,
                lq.reasons,
                al.coin_description,
                al.winning_bid,
                al.currency,
                al.source_site,
                ltl.match_method,
                ltl.match_confidence,
                ct.name_full AS current_type_name,
                ct.denomination_text,
                ct.denomination_value,
                ct.country,
                ct.era,
                ct.source AS catalog_source,
                ct.ref_source,
                ct.theme_ru,
                ct.theme_core
         FROM lot_type_link_quality lq
         JOIN lot_type_link ltl
           ON ltl.lot_id = lq.lot_id
          AND ltl.type_id = lq.type_id
         JOIN auction_lots al ON al.id = lq.lot_id
         JOIN coin_type ct ON ct.id = lq.type_id
         WHERE lq.audit_version = $1
           AND lq.status = 'conflict'
           AND (lq.reasons ? 'denomination_unit_mismatch'
                OR lq.reasons ? 'denomination_value_mismatch')
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
    AUDIT_VERSION,
    lotDenomination,
    parseOptions,
    reasonGroup,
    summarizeRows,
    themeEvidence,
    typeDenomination,
};

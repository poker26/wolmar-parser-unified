'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseTitle } = require('../catalog/coin-matcher');
const {
    candidateQuality,
    extractKmReferences,
    normalizeKmReference,
    parseOptions,
} = require('../scripts/propose-km-denomination-link-repairs');

test('KM proposal parser accepts Russian and Latin catalog references', () => {
    assert.deepEqual(extractKmReferences('Франция, КМ#84. Ag.'), ['84']);
    assert.deepEqual(extractKmReferences('Great Britain KM # 933a'), ['933A']);
    assert.equal(normalizeKmReference('KM# 933а'), '933A');
});

test('KM proposal options remain bounded and read-only', () => {
    assert.deepEqual(parseOptions(['--limit=25', '--summary-only']), { limit: 25, summaryOnly: true });
    assert.throws(() => parseOptions(['--limit=1001']), /--limit must be 1\.\.1000/);
});

test('KM proposal requires a unique country year and denomination compatible type', () => {
    const parsed = parseTitle('5 франков. Франция 1962г. КМ#1');
    const candidates = [
        {
            id: 10,
            name_full: '5 FRANCS. FRANCE',
            country: 'France',
            year_start: 1961,
            year_end: 1964,
            denomination_text: '5 FRANCS',
        },
        {
            id: 11,
            name_full: '5 CENTIMES. FRANCE',
            country: 'France',
            year_start: 1961,
            year_end: 1964,
            denomination_text: '5 CENTIMES',
        },
    ];
    assert.equal(candidateQuality({
        parsed,
        country: 'France',
        candidates,
        currentTypeId: 11,
    }).action, 'exact_km_strict_candidate');
    assert.equal(candidateQuality({
        parsed,
        country: 'Belgium',
        candidates,
        currentTypeId: 11,
    }).action, 'reference_has_no_compatible_type');
});

test('KM proposal abstains when the authoritative reference maps to multiple compatible types', () => {
    const parsed = parseTitle('5 франков. Франция 1962г. КМ#1');
    const candidate = {
        name_full: '5 FRANCS. FRANCE',
        country: 'France',
        year_start: 1961,
        year_end: 1964,
        denomination_text: '5 FRANCS',
    };
    const result = candidateQuality({
        parsed,
        country: 'France',
        candidates: [{ id: 10, ...candidate }, { id: 12, ...candidate }],
        currentTypeId: 11,
    });
    assert.equal(result.action, 'reference_is_catalog_ambiguous');
});

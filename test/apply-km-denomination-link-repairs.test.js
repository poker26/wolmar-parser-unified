'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    parseOptions,
    repairEvidence,
    validateLockedRepair,
} = require('../scripts/apply-km-denomination-link-repairs');

function lockedRow(overrides = {}) {
    return {
        old_type_id: 11,
        quality_status: 'conflict',
        audit_version: 'hard-consistency-v1',
        coin_description: '5 франков. Франция 1962г. KM#1',
        lot_year: 1962,
        old_type_country: 'France',
        new_type_id: 12,
        name_full: '5 FRANCS. FRANCE',
        country: 'France',
        year_start: 1961,
        year_end: 1964,
        denomination_text: '5 FRANCS',
        km_number: 'KM#1',
        ...overrides,
    };
}

function proposal(overrides = {}) {
    return {
        lotId: 7,
        currentTypeId: 11,
        proposedTypeId: 12,
        reference: '1',
        country: 'France',
        ...overrides,
    };
}

test('KM repair requires double confirmation for writes', () => {
    assert.deepEqual(parseOptions([]), { limit: null, write: false });
    assert.deepEqual(parseOptions(['--limit=5', '--write']), { limit: 5, write: false });
    assert.deepEqual(parseOptions(['--write', '--confirmed']), { limit: null, write: true });
});

test('KM repair revalidates reference country year and denomination under lock', () => {
    const audit = validateLockedRepair(lockedRow(), proposal());
    assert.equal(audit.status, 'consistent');
    assert.ok(audit.evidence.includes('year'));
    assert.ok(audit.evidence.includes('denomination_unit'));
    assert.throws(
        () => validateLockedRepair(lockedRow({ km_number: 'KM#2' }), proposal()),
        /KM reference changed/,
    );
    assert.throws(
        () => validateLockedRepair(lockedRow({ quality_status: 'consistent' }), proposal()),
        /changed since dry-run/,
    );
});

test('KM repair evidence records the independent authority and uniqueness checks', () => {
    const evidence = repairEvidence(proposal(), { evidence: ['year', 'denomination_unit'] });
    assert.deepEqual(evidence.slice(0, 5), [
        'km_reference:1',
        'km_country_exact',
        'km_year_exact_or_range',
        'km_denomination_exact',
        'km_unique_catalog_candidate',
    ]);
});

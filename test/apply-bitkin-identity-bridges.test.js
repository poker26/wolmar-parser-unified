'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { applyOne, parseOptions } = require('../scripts/apply-bitkin-identity-bridges');

function candidate(overrides = {}) {
    return {
        entryId: 8737,
        reference: '769.611',
        proposedTypeId: 42083,
        proposedTypeName: '1 копейка 1811 ИМ МК R',
        lotCount: 6,
        sampleDescription: '1 копейка 1811 года, ИМ-МК. Биткин# 611.',
        ...overrides,
    };
}

function lockedRow(overrides = {}) {
    return {
        id: 8737,
        bitkin_reference: '769.611',
        bitkin_year: 1811,
        bitkin_denomination: '1 копейка',
        bitkin_mint: 'Ижорский монетный двор',
        bitkin_mint_mark: 'ИМ МК',
        proposed_type_id: 42083,
        proposed_type_name: '1 копейка 1811 ИМ МК R',
        source: 'auction_imperial',
        proposed_country: 'RU',
        proposed_year: 1811,
        proposed_year_start: null,
        proposed_year_end: null,
        proposed_denomination_text: '1 копейка',
        proposed_denomination_value: 0.01,
        proposed_mint: 'ИМ МК',
        ...overrides,
    };
}

test('Bitkin identity bridge requires double confirmation for writes', () => {
    assert.deepEqual(parseOptions([]), { write: false });
    assert.deepEqual(parseOptions(['--write']), { write: false });
    assert.deepEqual(parseOptions(['--write', '--confirmed']), { write: true });
});

test('Bitkin identity bridge revalidates entry, target and missing bridge under lock', async () => {
    const calls = [];
    const client = {
        async query(sql, params) {
            calls.push({ sql, params });
            if (calls.length === 1) return { rows: [lockedRow()] };
            if (calls.length === 2) return { rows: [{ existing_matches: 0 }] };
            return { rows: [] };
        },
    };
    await applyOne(client, candidate());
    assert.equal(calls.length, 3);
    assert.match(calls[0].sql, /FOR UPDATE OF e, ct/);
    assert.match(calls[2].sql, /bitkin_identity_unique_catalog/);
    assert.deepEqual(calls[2].params.slice(0, 2), [8737, 42083]);
});

test('Bitkin identity bridge aborts if a bridge appears after dry-run', async () => {
    let call = 0;
    const client = {
        async query() {
            call += 1;
            if (call === 1) return { rows: [lockedRow()] };
            return { rows: [{ existing_matches: 1 }] };
        },
    };
    await assert.rejects(applyOne(client, candidate()), /changed since dry-run/);
});

test('Bitkin identity bridge rejects changed mint evidence under lock', async () => {
    let call = 0;
    const client = {
        async query() {
            call += 1;
            if (call === 1) return { rows: [lockedRow({ proposed_mint: 'ММД' })] };
            return { rows: [{ existing_matches: 0 }] };
        },
    };
    await assert.rejects(applyOne(client, candidate()), /identity changed since dry-run/);
});

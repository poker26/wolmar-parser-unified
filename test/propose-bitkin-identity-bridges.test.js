'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    compatibleCatalogTypes,
    groupUnbridged,
} = require('../scripts/propose-bitkin-identity-bridges');

test('identity bridge accepts exactly matching existing imperial type and rejects coarse Bitkin rows', () => {
    const parsed = {
        year: 1741,
        denom: { value: 1, num: 1, unit: 'рубль', isRf: true },
        mints: ['СПБ'],
        title: '1 рубль 1741 года, СПБ.',
    };
    const candidate = {
        proposed_type_id: 200,
        proposed_type_name: '1 рубль 1741 СПБ',
        source: 'auction_imperial',
        proposed_country: 'RU',
        proposed_year: 1741,
        proposed_denomination_text: '1 рубль',
        proposed_denomination_value: 1,
        proposed_mint: 'СПБ',
    };
    assert.deepEqual(compatibleCatalogTypes(parsed, [candidate]), [candidate]);
    assert.deepEqual(compatibleCatalogTypes(parsed, [{ ...candidate, source: 'bitkin' }]), []);
    assert.deepEqual(compatibleCatalogTypes(parsed, [{ ...candidate, proposed_mint: 'ММД' }]), []);
});

test('identity bridge groups repeated lots by one normalized Bitkin entry', () => {
    const base = {
        action: 'exact_identity_without_type_match',
        bitkinEntryIds: [5682],
        bitkinReferences: ['562.235'],
        shortReference: '235',
        lotId: 1,
        description: '1 рубль 1741 СПБ',
        currency: 'RUB',
        price: 100,
    };
    const groups = groupUnbridged([base, { ...base, lotId: 2, price: 200 }]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].lotCount, 2);
    assert.equal(groups[0].rubExposure, 300);
});

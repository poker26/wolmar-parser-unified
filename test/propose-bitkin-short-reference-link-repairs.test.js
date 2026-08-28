'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    classifyShortReference,
    extractShortBitkinReferences,
    isExplicitMultiCoinLot,
} = require('../scripts/propose-bitkin-short-reference-link-repairs');

test('short Bitkin extractor accepts numbered citations but excludes full page references', () => {
    assert.deepEqual(extractShortBitkinReferences('Биткин# 238 (R3).'), ['238']);
    assert.deepEqual(extractShortBitkinReferences('Биткин № Н 649.'), ['649']);
    assert.deepEqual(extractShortBitkinReferences('Биткин №# 638.138.'), []);
    assert.deepEqual(extractShortBitkinReferences('Биткин редкость R1, №# 21.'), ['21']);
});

test('short Bitkin classifier requires one identity-compatible catalog target', () => {
    const row = {
        lot_id: 10,
        current_type_id: 100,
        reasons: ['mint_mismatch'],
        coin_description: '1 рубль 1741 года, СПБ. Биткин# 21.',
        current_type_name: '1 рубль 1741 ММД',
        short_reference: '21',
    };
    const parsed = {
        year: 1741,
        denom: { value: 1, num: 1, unit: 'рубль', isRf: true },
        mints: ['СПБ'],
        title: row.coin_description,
    };
    const match = {
        entry_id: 7,
        bitkin_reference: '500.21',
        bitkin_year: 1741,
        bitkin_denomination: '1 рубль',
        bitkin_mint: 'Санкт-Петербургский монетный двор',
        bitkin_mint_mark: 'СПБ',
        proposed_type_id: 200,
        bitkin_match_confidence: 0.99,
        bitkin_match_status: 'auto',
        proposed_type_name: '1 рубль 1741 СПБ',
        proposed_country: 'RU',
        proposed_year: 1741,
        proposed_year_start: null,
        proposed_year_end: null,
        proposed_denomination_text: '1 рубль',
        proposed_denomination_value: 1,
        proposed_mint: 'СПБ',
    };
    const result = classifyShortReference(row, [match], parsed);
    assert.equal(result.action, 'short_reference_strict_candidate');
    assert.equal(result.proposedTypeId, 200);
    assert.deepEqual(result.bitkinEntryIds, [7]);
    assert.equal(classifyShortReference(row, [match, { ...match, proposed_type_id: 201 }], parsed).action,
        'catalog_ambiguous');
});

test('short Bitkin classifier defers fractional titles until matcher contract is fixed', () => {
    const result = classifyShortReference({
        lot_id: 11,
        current_type_id: 100,
        reasons: ['denomination_value_mismatch'],
        coin_description: '1/2 копейки 1840г. ЕМ. Биткин# 826.',
        current_type_name: '1/2 копейки 1840 ЕМ',
        short_reference: '826',
    }, []);
    assert.equal(result.action, 'fractional_title_deferred');
});

test('short Bitkin repair abstains from an explicitly multi-coin lot', () => {
    const description = 'Лот из двух экземпляров 2 копейки 1825 года, КМ-АМ. Биткин# 517. (2)';
    assert.equal(isExplicitMultiCoinLot(description), true);
    const result = classifyShortReference({
        lot_id: 50715,
        current_type_id: 100,
        reasons: ['mint_mismatch'],
        coin_description: description,
        current_type_name: '2 копейки 1825 ЕМ',
        short_reference: '517',
    }, [], {
        year: 1825,
        denom: { value: 0.02, num: 2, unit: 'копейки', isRf: true },
        mints: ['КМ', 'АМ'],
        title: description,
        isSet: false,
        isNonCoin: false,
    });
    assert.equal(result.action, 'multi_or_non_coin_lot_deferred');
});

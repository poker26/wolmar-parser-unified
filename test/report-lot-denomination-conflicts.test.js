'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    parseOptions,
    reasonGroup,
    summarizeRows,
} = require('../scripts/report-lot-denomination-conflicts');

test('denomination report parses bounded read-only options', () => {
    assert.deepEqual(parseOptions(['--limit=25', '--summary-only']), { limit: 25, summaryOnly: true });
    assert.throws(() => parseOptions(['--limit=0']), /--limit must be 1\.\.100/);
});

test('denomination report keeps pure and combined conflicts separate', () => {
    assert.equal(reasonGroup(['denomination_unit_mismatch']), 'unit');
    assert.equal(reasonGroup(['denomination_value_mismatch']), 'value');
    assert.equal(
        reasonGroup(['mint_mismatch', 'denomination_value_mismatch']),
        'value+mint_mismatch',
    );
});

test('denomination report does not mix currencies and exposes high-value evidence', () => {
    const rows = [
        {
            lot_id: 1,
            type_id: 10,
            reasons: ['denomination_value_mismatch'],
            coin_description: '5 рублей. Россия 2020г.',
            winning_bid: '1500',
            currency: 'RUB',
            source_site: 'wolmar.ru',
            match_method: 'exact_core',
            match_confidence: '0.9',
            current_type_name: '10 рублей. Россия 2020',
            denomination_text: '10 рублей',
            denomination_value: '10',
            country: 'RU',
            era: null,
            catalog_source: 'cbr',
            ref_source: null,
            theme_ru: null,
            theme_core: 'россия',
        },
        {
            lot_id: 2,
            type_id: 11,
            reasons: ['denomination_unit_mismatch'],
            coin_description: '5 франков. Франция 1962г.',
            winning_bid: '20',
            currency: 'USD',
            source_site: 'meshok.net',
            match_method: 'km',
            match_confidence: null,
            current_type_name: '5 CENTIMES. FRANCE 1962',
            denomination_text: '5 CENTIMES',
            denomination_value: null,
            country: 'France',
            era: 'foreign',
            catalog_source: 'scwc',
            ref_source: 'scwc',
            theme_ru: null,
            theme_core: '',
        },
    ];
    const report = summarizeRows(rows, { limit: 1 });
    assert.equal(report.summary.conflicts, 2);
    assert.deepEqual(report.summary.currencyImpact.RUB, {
        pricedLots: 1,
        totalWinningBid: 1500,
        maxWinningBid: 1500,
    });
    assert.deepEqual(report.summary.currencyImpact.USD, {
        pricedLots: 1,
        totalWinningBid: 20,
        maxWinningBid: 20,
    });
    assert.equal(report.summary.dimensions.byDenominationPair['5 RUBLE -> 10 RUBLE'], 1);
    assert.equal(report.summary.dimensions.byDenominationPair['5 FRANC -> 5 CENT_MINOR'], 1);
    assert.equal(report.highestValueLots[0].lotId, 1);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    classifyRow,
    denominationCause,
    summarizeRows,
} = require('../scripts/report-lot-conflict-cohorts');

function row(overrides = {}) {
    return {
        lot_id: 1,
        type_id: 10,
        reasons: ['denomination_value_mismatch'],
        coin_description: '1/2 копейки 1881г. СПБ.',
        lot_year: 1881,
        winning_bid: '1000',
        currency: 'RUB',
        source_site: 'wolmar.ru',
        match_method: 'relink-v2',
        current_type_name: '2 копейки 1881 СПБ',
        country: 'RU',
        era: 'imperial',
        catalog_source: 'auction_imperial',
        type_year: 1881,
        type_year_start: null,
        type_year_end: null,
        denomination_text: '2 копейки',
        denomination_value: '0.02',
        type_mint: 'СПБ',
        ...overrides,
    };
}

test('cohort classifier recognizes the dominant half-kopeck mapping bug', () => {
    const classified = classifyRow(row());
    assert.equal(classified.cause, 'half_kopeck_to_two_kopecks');
    assert.equal(classified.signature, 'half_kopeck_to_two_kopecks|imperial|0.5 KOPEK -> 2 KOPEK');
});

test('cohort classifier separates major and minor foreign units', () => {
    assert.equal(denominationCause(
        { family: 'DOLLAR', number: 10 },
        { family: 'CENT_MINOR', number: 10 },
    ), 'major_minor_unit_collision');
});

test('cohort summary ranks repeated signatures and keeps RUB impact', () => {
    const report = summarizeRows([
        row(),
        row({ lot_id: 2, winning_bid: '2500' }),
        row({
            lot_id: 3,
            type_id: 20,
            reasons: ['mint_mismatch'],
            coin_description: '3 копейки 1868 СПБ',
            winning_bid: '500',
            current_type_name: '3 копейки 1868 ЕМ',
            denomination_text: '3 копейки',
            denomination_value: '0.03',
            type_mint: 'ЕМ',
        }),
    ], { limit: 5 });
    assert.equal(report.summary.conflicts, 3);
    assert.equal(report.summary.rootCauses[0].label, 'half_kopeck_to_two_kopecks');
    assert.equal(report.topSignaturesByCount[0].count, 2);
    assert.equal(report.topSignaturesByCount[0].priceByCurrency.RUB.total, 3500);
    assert.equal(report.summary.byReasonDimensions.denomination, 2);
    assert.equal(report.summary.byReasonDimensions.mint, 1);
});

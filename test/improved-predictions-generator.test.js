'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const ImprovedPredictionsGenerator = require('../improved-predictions-generator');

const metalsPriceService = { close: async () => {} };

function generator() {
    return new ImprovedPredictionsGenerator({ metalsPriceService });
}

function coin(overrides = {}) {
    return {
        id: 42,
        lot_number: '7',
        auction_number: '1016',
        category: 'Монеты России',
        coin_description: '1 рубль 1913 г. ВС Ag',
        condition: 'XF',
        metal: 'Ag',
        weight: 20,
        year: 1913,
        ...overrides,
    };
}

test('unlinked lots keep the established text-comparable path', async () => {
    const subject = generator();
    let legacyCalls = 0;
    let typeCalls = 0;
    subject.findSimilarLots = async () => {
        legacyCalls += 1;
        return [{ winning_bid: 1000, metal: 'Ag', weight: 20 }];
    };
    subject.findSimilarLotsByType = async () => {
        typeCalls += 1;
        return [];
    };
    subject.meltValue = async () => 0;

    const result = await subject.predictPrice(coin());

    assert.equal(legacyCalls, 1);
    assert.equal(typeCalls, 0);
    assert.equal(result.predicted_price, 1000);
    assert.equal(result.prediction_method, 'single_similar_lot');
});

test('linked lots use type_id comparables and never fall through to text matching', async () => {
    const subject = generator();
    let legacyCalls = 0;
    let typeCalls = 0;
    subject.findSimilarLots = async () => {
        legacyCalls += 1;
        return [{ winning_bid: 999999 }];
    };
    subject.findSimilarLotsByType = async () => {
        typeCalls += 1;
        subject._lastMatchBasis = 'type_grade_unknown_slab';
        return [{ winning_bid: 1200, metal: 'Ag', weight: 20 }];
    };
    subject.meltValue = async () => 0;

    const result = await subject.predictPrice(coin({ type_id: 77 }));

    assert.equal(typeCalls, 1);
    assert.equal(legacyCalls, 0);
    assert.equal(result.predicted_price, 1200);
    assert.equal(result.comparable_basis, 'type_grade_unknown_slab');
});

test('an explicitly conflicting type link keeps the established text path', async () => {
    const subject = generator();
    let legacyCalls = 0;
    let typeCalls = 0;
    subject.findSimilarLots = async () => {
        legacyCalls += 1;
        return [{ winning_bid: 1300, metal: 'Ag', weight: 20 }];
    };
    subject.findSimilarLotsByType = async () => {
        typeCalls += 1;
        return [{ winning_bid: 999999 }];
    };
    subject.meltValue = async () => 0;

    const result = await subject.predictPrice(coin({
        type_id: 77,
        link_quality_status: 'conflict',
    }));

    assert.equal(legacyCalls, 1);
    assert.equal(typeCalls, 0);
    assert.equal(result.predicted_price, 1300);
});

test('the established multi-comparable formula is reused for type_id samples', async () => {
    const subject = generator();
    subject.findSimilarLotsByType = async () => {
        subject._lastMatchBasis = 'type_grade_raw';
        return [
            { winning_bid: 1000, auction_end_date: '2026-01-01', metal: 'Ag', weight: 20 },
            { winning_bid: 2000, auction_end_date: '2026-02-01', metal: 'Ag', weight: 20 },
            { winning_bid: 3000, auction_end_date: '2026-03-01', metal: 'Ag', weight: 20 },
        ];
    };
    subject.recencyWeightedMedian = () => 2000;
    subject.meltValue = async () => 0;

    const result = await subject.predictPrice(coin({ type_id: 77, slab_status: 'raw' }));

    assert.equal(result.predicted_price, 2000);
    assert.equal(result.prediction_method, 'statistical_model');
    assert.equal(result.sample_size, 3);
    assert.equal(result.comparable_basis, 'type_grade_raw');
});

test('slab lookup widens only inside the same type and exact grade', async () => {
    const queries = [];
    const subject = generator();
    subject.dbClient = {
        async query(sql, params) {
            queries.push({ sql, params });
            if (queries.length === 1) return { rows: [] };
            return { rows: [{ id: 10, winning_bid: 5000 }] };
        },
    };

    const rows = await subject.findSimilarLotsByType(coin({
        type_id: 77,
        slab_status: 'slabbed',
        grading_company_code: 'NGC',
        slab_grade_code: 'MS65',
    }));

    assert.equal(rows.length, 1);
    assert.equal(queries.length, 2);
    assert.match(queries[0].sql, /ltl\.type_id = \$1/);
    assert.match(queries[0].sql, /collection_normalize_grade/);
    assert.match(queries[0].sql, /al\.metal = \$5/);
    assert.match(queries[0].sql, /al\.year = \$6/);
    assert.match(queries[0].sql, /al\.coin_description ~\* \$7/);
    assert.match(queries[0].sql, /al\.coin_description ILIKE \$8/);
    assert.match(queries[0].sql, /al\.slab_status = \$10/);
    assert.match(queries[0].sql, /al\.grading_company_code = \$11/);
    assert.match(queries[0].sql, /COALESCE\(lq\.status, 'unverified'\) <> 'conflict'/);
    assert.deepEqual(queries[0].params, [
        77,
        42,
        '1016',
        'MS65',
        'Ag',
        1913,
        '\\m1\\s*(рублей?|руб\\.?)\\M',
        '%ВС%',
        '(RRR|RR|R1|R2|R3|редкост)',
        'slabbed',
        'NGC',
    ]);
    assert.doesNotMatch(queries[1].sql, /al\.grading_company_code =/);
    assert.deepEqual(queries[1].params, [
        77,
        42,
        '1016',
        'MS65',
        'Ag',
        1913,
        '\\m1\\s*(рублей?|руб\\.?)\\M',
        '%ВС%',
        '(RRR|RR|R1|R2|R3|редкост)',
        'slabbed',
    ]);
    assert.equal(subject._lastMatchBasis, 'type_grade_slabbed');
    assert.equal(subject._lastMatchExpanded, true);
});

test('known type with no comparables abstains instead of using text fallback', async () => {
    const subject = generator();
    subject.findSimilarLotsByType = async () => [];
    subject.findSimilarLots = async () => {
        throw new Error('text fallback must not run');
    };
    subject.meltValue = async () => 0;

    const result = await subject.predictPrice(coin({ type_id: 77 }));

    assert.equal(result.predicted_price, null);
    assert.equal(result.prediction_method, 'no_similar_lots');
});

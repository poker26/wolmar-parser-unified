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
    assert.match(queries[0].sql, /al\.auction_end_date IS NOT NULL/);
    assert.doesNotMatch(queries[0].sql, /auction_end_date IS NULL OR/);
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

test('canonical type valuation is not split by a representative lot title', async () => {
    const queries = [];
    const subject = generator();
    subject.dbClient = {
        async query(sql, params) {
            queries.push({ sql, params });
            return { rows: [{ id: 10, winning_bid: 5000 }] };
        },
    };

    const rows = await subject.findSimilarLotsByType(coin({
        id: 0,
        auction_number: null,
        type_id: 77,
        slab_status: 'raw',
        valuation_identity_scope: 'type',
    }));

    assert.equal(rows.length, 1);
    assert.equal(queries.length, 1);
    assert.match(queries[0].sql, /ltl\.type_id = \$1/);
    assert.match(queries[0].sql, /collection_normalize_grade/);
    assert.match(queries[0].sql, /al\.slab_status = \$3/);
    assert.doesNotMatch(queries[0].sql, /al\.metal =/);
    assert.doesNotMatch(queries[0].sql, /al\.year =/);
    assert.doesNotMatch(queries[0].sql, /al\.coin_description (?:ILIKE|~\*)/);
    assert.deepEqual(queries[0].params, [77, 'XF', 'raw']);
});

test('heuristic XF may widen only to ungraded non-slabbed rows of the same type', async () => {
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
        id: 0,
        auction_number: null,
        type_id: 77,
        condition: 'XF',
        grade_source: 'heuristic',
        slab_status: 'unknown',
        valuation_identity_scope: 'type',
    }));

    assert.equal(rows.length, 1);
    assert.equal(queries.length, 2);
    assert.deepEqual(queries[0].params, [77, 'XF']);
    assert.match(queries[0].sql, /collection_normalize_grade/);
    assert.deepEqual(queries[1].params, [77]);
    assert.match(queries[1].sql, /collection_normalize_grade[\s\S]+IS NULL/);
    assert.match(queries[1].sql, /al\.slab_status IS DISTINCT FROM 'slabbed'/);
    assert.match(queries[1].sql, /ltl\.type_id = \$1/);
    assert.equal(subject._lastMatchBasis, 'type_ungraded_non_slabbed');
    assert.equal(subject._lastMatchExpanded, true);
});

test('a user-supplied grade never widens to ungraded comparables', async () => {
    const queries = [];
    const subject = generator();
    subject.dbClient = {
        async query(sql, params) {
            queries.push({ sql, params });
            return { rows: [] };
        },
    };

    const rows = await subject.findSimilarLotsByType(coin({
        id: 0,
        auction_number: null,
        type_id: 77,
        condition: 'XF',
        grade_source: 'user',
        slab_status: 'unknown',
        valuation_identity_scope: 'type',
    }));

    assert.deepEqual(rows, []);
    assert.equal(queries.length, 1);
    assert.deepEqual(queries[0].params, [77, 'XF']);
});

test('typed comparable metal adjustment may use the target physical profile', async () => {
    const subject = generator();
    subject.getCurrentMetalPrices = async () => ({ Au: 100 });
    subject.getMetalPricesAtDate = async () => ({ Au: 50 });

    const targetMelt = await subject.meltValue({
        metal: 'Au', weight: 8.6, fineness: 900,
    });
    const historicalComparableMelt = await subject.meltValue({
        metal: 'Au', auction_end_date: '2020-01-01',
    }, 'Au', {
        metal: 'Au', weight: 8.6, fineness: 900,
    });

    assert.equal(targetMelt, 774);
    assert.equal(historicalComparableMelt, 387);
});

test('single comparable numeric database price is adjusted arithmetically', async () => {
    const subject = generator();
    subject.findSimilarLotsByType = async () => [{
        id: 10,
        winning_bid: '1000.00',
        metal: 'Au',
        weight: 10,
        fineness: 900,
        auction_end_date: '2020-01-01',
    }];
    subject.meltValue = async (row) => row.id === 10 ? 400 : 900;

    const result = await subject.predictPrice(coin({
        type_id: 77,
        metal: 'Au',
        weight: 10,
        fineness: 900,
    }));

    assert.equal(result.predicted_price, 1500);
});

test('precious-metal prediction cannot fall below the current melt value', async () => {
    const subject = generator();
    subject.findSimilarLotsByType = async () => [{
        id: 10,
        winning_bid: '100.00',
        metal: 'Au',
        weight: 10,
        fineness: 900,
        auction_end_date: '2020-01-01',
    }];
    subject.meltValue = async (row) => row.id === 10 ? 400 : 900;

    const result = await subject.predictPrice(coin({
        type_id: 77,
        metal: 'Au',
        weight: 10,
        fineness: 900,
    }));

    assert.equal(result.predicted_price, 900);
    assert.equal(result.low_price, 900);
    assert.equal(result.high_price, 900);
    assert.equal(result.numismatic_premium, 0);
    assert.equal(result.metal_floor_applied, true);
    assert.equal(result.confidence_score, 0.48);
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

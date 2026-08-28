'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { ComparableRepository } = require('../app-v1/valuation/comparable-repository');
const {
    MetalAdjustment,
    compositionFineness,
    normalizeMetal,
    pureWeight,
} = require('../app-v1/valuation/metal-adjustment');
const {
    METHOD_VERSION,
    comparablePlan,
    normalizeValuationInput,
    valuateCoin,
    weightedQuantile,
} = require('../domain/valuation');

const NOW = new Date('2026-08-28T00:00:00Z');

function input(overrides = {}) {
    return {
        typeId: 77,
        gradeCode: 'ms 65',
        gradeSource: 'slab_label',
        slabStatus: 'slabbed',
        gradingCompanyCode: 'NGC',
        valuationDate: NOW,
        currency: 'RUB',
        ...overrides,
    };
}

function rows(prices) {
    return prices.map((price, index) => ({
        lotId: 100 + index,
        price,
        soldAt: NOW,
    }));
}

test('slabbed company plan expands company then status but never drops a known grade', () => {
    const normalized = normalizeValuationInput(input());
    const plan = comparablePlan(normalized);
    assert.deepEqual(plan.map(({ level }) => level), [
        'same_company_and_grade',
        'same_slab_group',
        'same_grade_market',
    ]);
    assert.ok(plan.every(({ gradeCode }) => gradeCode === 'MS65'));
    assert.equal(plan[0].gradingCompanyCode, 'NGC');
    assert.equal(plan[1].gradingCompanyCode, null);
    assert.equal(plan[1].slabStatus, 'slabbed');
    assert.equal(plan[2].slabStatus, null);
});

test('unknown slab status is not silently treated as raw', () => {
    const plan = comparablePlan(normalizeValuationInput(input({
        slabStatus: 'unknown',
        gradingCompanyCode: null,
        gradeSource: 'auction_house',
    })));
    assert.equal(plan.length, 1);
    assert.equal(plan[0].level, 'same_grade_unknown_slab_status');
    assert.equal(plan[0].slabStatus, null);
    assert.equal(plan[0].expanded, true);
});

test('weighted quantiles retain the production six-month recency weighting', () => {
    const comparableRows = [
        { price: 100, soldAt: '2025-08-28T00:00:00Z' },
        { price: 200, soldAt: '2026-02-28T00:00:00Z' },
        { price: 300, soldAt: '2026-08-28T00:00:00Z' },
    ];
    assert.equal(weightedQuantile(comparableRows, 0.5, NOW, 6), 300);
});

test('metal profile normalization preserves the existing predictor purity rules', () => {
    assert.equal(normalizeMetal('Ag'), 'Ag');
    assert.equal(normalizeMetal(null, 'Silver .925'), 'Ag');
    assert.equal(compositionFineness('Silver .925'), 925);
    assert.equal(compositionFineness('Au 900/1000'), 900);
    assert.equal(pureWeight({ metal: 'Ag', mass: 10, composition: 'Silver .925' }), 9.25);
    assert.equal(pureWeight({ metal: 'Au', weight: 10 }), 9);
});

test('metal adjustment applies the production historical melt delta', async () => {
    const pool = {
        async query(sql) {
            if (sql.includes('FROM auction_lots WHERE id')) {
                return { rows: [{ metal: 'Ag', weight: 10, fineness: 900 }] };
            }
            if (sql.includes('WITH requested')) {
                return { rows: [
                    { date: new Date('2026-08-28T00:00:00Z'), silver_price: 100 },
                    { date: new Date('2026-02-28T00:00:00Z'), silver_price: 50 },
                ] };
            }
            throw new Error(`unexpected SQL: ${sql}`);
        },
    };
    const adjustment = new MetalAdjustment({ pool });
    const result = await adjustment.adjust([
        { lotId: 9, price: 1000, soldAt: '2026-02-28', weight: 10, fineness: 900 },
    ], {
        typeId: 77,
        identityFallback: { lotId: 42 },
        valuationDate: NOW,
    });
    assert.equal(result.method, 'historical_melt_delta');
    assert.equal(result.rows[0].adjustedPrice, 1450);
});

test('valuateCoin uses exact same-company sales when sufficient', async () => {
    const calls = [];
    const result = await valuateCoin(input(), {
        findComparables: async (criteria) => {
            calls.push(criteria);
            return { rows: rows([100, 200, 300, 400, 500]), totalCount: 5 };
        },
    });
    assert.equal(calls.length, 1);
    assert.equal(result.status, 'ready');
    assert.equal(result.basisLevel, 'same_company_and_grade');
    assert.equal(result.exactComparableCount, 5);
    assert.equal(result.expandedComparableCount, 5);
    assert.deepEqual([result.low, result.median, result.high], [200, 300, 400]);
    assert.equal(result.methodVersion, METHOD_VERSION);
});

test('valuateCoin expands without a company coefficient and reports exact count separately', async () => {
    const responses = [
        { rows: rows([100]), totalCount: 1 },
        { rows: rows([90, 100, 110, 120]), totalCount: 4 },
    ];
    const calls = [];
    const result = await valuateCoin(input(), {
        findComparables: async (criteria) => {
            calls.push(criteria);
            return responses.shift();
        },
    });
    assert.equal(calls.length, 2);
    assert.equal(result.status, 'ready');
    assert.equal(result.basisLevel, 'same_slab_group');
    assert.equal(result.exactComparableCount, 1);
    assert.equal(result.expandedComparableCount, 4);
    assert.equal(result.confidence, 'low');
    assert.equal(result.median, 100);
});

test('known grade abstains instead of borrowing another grade', async () => {
    const seenGrades = [];
    const result = await valuateCoin(input(), {
        findComparables: async (criteria) => {
            seenGrades.push(criteria.gradeCode);
            return { rows: rows([100, 200]), totalCount: 2 };
        },
    });
    assert.deepEqual(seenGrades, ['MS65', 'MS65', 'MS65']);
    assert.equal(result.status, 'insufficient_data');
    assert.equal(result.abstainReason, 'not_enough_comparable_sales');
    assert.equal(result.median, null);
});

test('missing catalog identity abstains before querying market data', async () => {
    let queried = false;
    const result = await valuateCoin(input({ typeId: null, identityFallback: null }), {
        findComparables: async () => { queried = true; return { rows: [] }; },
    });
    assert.equal(queried, false);
    assert.equal(result.status, 'insufficient_data');
    assert.equal(result.abstainReason, 'identity_required');
});

test('paper money mislinked to a coin type is rejected before comparable lookup', async () => {
    let queried = false;
    const result = await valuateCoin(input({
        identityFallback: { lotId: 42, assetKind: 'paper_money' },
    }), {
        findComparables: async () => { queried = true; return { rows: [] }; },
    });
    assert.equal(queried, false);
    assert.equal(result.status, 'insufficient_data');
    assert.equal(result.abstainReason, 'unsupported_asset_kind');
});

test('SQL repository filters completed sales by type, grade, slab and company', async () => {
    const queries = [];
    const pool = {
        async query(sql, params) {
            queries.push({ sql, params });
            return { rows: [{ lot_id: 9, price: '1234', sold_at: NOW, total_count: 1 }] };
        },
    };
    const repository = new ComparableRepository({ pool });
    const result = await repository.findComparables({
        typeId: 77,
        gradeCode: 'MS65',
        slabStatus: 'slabbed',
        gradingCompanyCode: 'NGC',
        valuationDate: NOW,
        currency: 'RUB',
        excludeLotId: 42,
        limit: 250,
    });
    assert.equal(result.totalCount, 1);
    assert.deepEqual(result.rows[0], {
        lotId: 9,
        price: 1234,
        soldAt: NOW,
        metal: undefined,
        weight: null,
        fineness: null,
        pureMetalWeight: null,
    });
    assert.match(queries[0].sql, /ltl\.type_id = \$1/);
    assert.match(queries[0].sql, /al\.lot_status = 'closed'/);
    assert.match(queries[0].sql, /NULLIF\(al\.slab_grade_code, ''\)/);
    assert.match(queries[0].sql, /al\.slab_status = \$6/);
    assert.match(queries[0].sql, /al\.grading_company_code = \$7/);
    assert.match(queries[0].sql, /al\.id <> \$8/);
    assert.deepEqual(queries[0].params, [
        77,
        ['wolmar.ru', 'numismat.ru', 'meshok.net', 'auction.ru'],
        'RUB',
        NOW,
        'MS65',
        'slabbed',
        'NGC',
        42,
        250,
    ]);
});

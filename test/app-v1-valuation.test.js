'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { normalizeGrade } = require('../app-v1/valuation/grade');
const { registerValuationRoutes } = require('../app-v1/valuation/routes');
const { CollectionValuationService, ValuationError } = require('../app-v1/valuation/service');
const {
    calculateCollectionValuation,
} = require('../temporal/collection-valuation-activities');

const USER_ID = '00000000-0000-4000-8000-000000000001';
const ITEM_ID = '20000000-0000-4000-8000-000000000001';
const VALUATION_ID = '40000000-0000-4000-8000-000000000001';

class FakePool {
    constructor(handler) {
        this.handler = handler;
        this.queries = [];
    }

    async query(sql, params = []) {
        this.queries.push({ sql, params });
        return this.handler(sql, params, this.queries.length);
    }
}

function fakeApp() {
    const routes = [];
    const add = (method) => (path, ...handlers) => routes.push({ method, path, handlers });
    return { routes, get: add('GET'), post: add('POST') };
}

function valuationRow(overrides = {}) {
    return {
        id: VALUATION_ID,
        item_id: ITEM_ID,
        currency: 'RUB',
        low_minor: '10000',
        median_minor: '20000',
        high_minor: '30000',
        grade_code: 'XF',
        comparable_count: 5,
        confidence: '0.600',
        status: 'ready',
        method: 'auction_houses_exact_grade_percentiles',
        model_version: 'mvp-v1',
        basis: { lotIds: [11, 12, 13, 14, 15] },
        abstain_reason: null,
        calculated_at: new Date('2026-08-26T12:00:00Z'),
        ...overrides,
    };
}

test('grade normalization keeps exact distinctions and canonical aliases', () => {
    assert.equal(normalizeGrade(' pf 69 ultra cameo '), 'PF69ULTRACAMEO');
    assert.equal(normalizeGrade('Proof'), 'PF');
    assert.equal(normalizeGrade('анц'), 'UNC');
    assert.equal(normalizeGrade('aUNC'), 'AU/UNC');
    assert.equal(normalizeGrade('VF+'), 'VF+');
    assert.notEqual(normalizeGrade('VF'), normalizeGrade('XF'));
});

test('valuation activity persists the shared service result without calculating its own price', async () => {
    const events = [];
    const pool = new FakePool((sql) => {
        if (sql.includes('FROM collection_item')) {
            return { rows: [{
                id: ITEM_ID, user_id: USER_ID, type_id: 77, grade_code: 'XF',
                grade_source: 'user', slab_status: 'raw', grading_company_code: null,
            }] };
        }
        if (sql.includes('INSERT INTO collection_valuation')) {
            return { rows: [{ id: VALUATION_ID, status: 'ready', comparable_count: 4 }] };
        }
        throw new Error(`unexpected SQL: ${sql}`);
    });

    const result = await calculateCollectionValuation(
        { itemId: ITEM_ID },
        {
            pool,
            recordEvent: async (event) => events.push(event),
            valuationService: {
                async valuateCollectionItem() {
                    return {
                        status: 'ready', currency: 'RUB', low: 100, median: 200, high: 300,
                        confidence: 0.65, comparableCount: 4, basis: 'type_grade_raw',
                        estimateKind: 'market_range', rangeAvailable: true,
                        method: 'statistical_model', methodVersion: 'improved-type-slab-v1',
                        abstainReason: null, fingerprint: 'abc',
                        profile: {
                            typeId: 77, gradeCode: 'XF', gradeSource: 'user',
                            slabStatus: 'raw', gradingCompanyCode: null,
                            valuationDate: '2026-08-29', currency: 'RUB',
                        },
                        prediction: {
                            exact_comparable_count: 4,
                            comparable_lot_ids: [11, 12, 13, 14],
                        },
                    };
                },
            },
        },
    );
    assert.equal(result.status, 'ready');
    assert.equal(pool.queries.some(({ sql }) => sql.includes('FROM lot_type_link')), false);
    const insert = pool.queries.find(({ sql }) => sql.includes('INSERT INTO collection_valuation'));
    assert.deepEqual(insert.params.slice(3, 6), [10000, 20000, 30000]);
    const basis = JSON.parse(insert.params[12]);
    assert.deepEqual(basis.lotIds, [11, 12, 13, 14]);
    assert.equal(basis.valuationFingerprint, 'abc');
    assert.equal(basis.estimateKind, 'market_range');
    assert.equal(basis.rangeAvailable, true);
    assert.deepEqual(events, [{
        userId: USER_ID,
        eventName: 'collection_valuation_ready',
        properties: { comparableBucket: '3-4' },
        sourceId: VALUATION_ID,
    }]);
});

test('valuation snapshot preserves the grading company spelling from the specimen', async () => {
    const pool = new FakePool((sql) => {
        if (sql.includes('FROM collection_item')) {
            return { rows: [{
                id: ITEM_ID, user_id: USER_ID, type_id: 77, grade_code: 'MS65',
                grade_source: 'slab_label', slab_status: 'slabbed',
                grading_company_code: 'NGC', grading_company_raw: 'НГС',
            }] };
        }
        if (sql.includes('INSERT INTO collection_valuation')) {
            return { rows: [valuationRow()] };
        }
        throw new Error(`unexpected SQL: ${sql}`);
    });

    await calculateCollectionValuation(
        { itemId: ITEM_ID },
        {
            pool,
            recordEvent: async () => {},
            valuationService: {
                async valuateCollectionItem() {
                    return {
                        status: 'ready', currency: 'RUB', low: 100, median: 200, high: 300,
                        confidence: 0.8, comparableCount: 4, basis: 'type_grade_slab_company',
                        estimateKind: 'market_range', rangeAvailable: true,
                        method: 'statistical_model', methodVersion: 'improved-type-slab-v2',
                        abstainReason: null, fingerprint: 'slab',
                        profile: {
                            typeId: 77, gradeCode: 'MS65', gradeSource: 'slab_label',
                            slabStatus: 'slabbed', gradingCompanyCode: 'NGC',
                            valuationDate: '2026-09-03', currency: 'RUB',
                        },
                        prediction: { exact_comparable_count: 4, comparable_lot_ids: [1, 2, 3, 4] },
                    };
                },
            },
        },
    );

    const insert = pool.queries.find(({ sql }) => sql.includes('INSERT INTO collection_valuation'));
    assert.deepEqual(insert.params.slice(14, 18), ['slabbed', 'NGC', 'НГС', 'slab_label']);
});

test('valuation activity preserves a shared-service abstention', async () => {
    const events = [];
    const pool = new FakePool((sql) => {
        if (sql.includes('FROM collection_item')) {
            return { rows: [{
                id: ITEM_ID, user_id: USER_ID, type_id: 77, grade_code: 'VF',
                grade_source: 'user', slab_status: 'unknown', grading_company_code: null,
            }] };
        }
        if (sql.includes('INSERT INTO collection_valuation')) {
            return { rows: [{ id: VALUATION_ID, status: 'insufficient_data', comparable_count: 2 }] };
        }
        throw new Error(`unexpected SQL: ${sql}`);
    });

    const result = await calculateCollectionValuation(
        { itemId: ITEM_ID },
        {
            pool,
            recordEvent: async (event) => events.push(event),
            valuationService: {
                async valuateCollectionItem() {
                    return {
                        status: 'insufficient_data', currency: 'RUB', low: null, median: null, high: null,
                        confidence: 0, comparableCount: 2, basis: 'type_grade_unknown_slab',
                        estimateKind: 'none', rangeAvailable: false,
                        method: 'no_similar_lots', methodVersion: 'improved-type-slab-v1',
                        abstainReason: 'no_similar_lots', fingerprint: 'def',
                        profile: {
                            typeId: 77, gradeCode: 'VF', gradeSource: 'user',
                            slabStatus: 'unknown', gradingCompanyCode: null,
                            valuationDate: '2026-08-29', currency: 'RUB',
                        },
                        prediction: { exact_comparable_count: 2, comparable_lot_ids: [21, 22] },
                    };
                },
            },
        },
    );
    assert.equal(result.status, 'insufficient_data');
    const insert = pool.queries.find(({ sql }) => sql.includes('INSERT INTO collection_valuation'));
    assert.deepEqual(insert.params.slice(3, 6), [null, null, null]);
    assert.equal(insert.params[13], 'no_similar_lots');
    assert.deepEqual(events[0], {
        userId: USER_ID,
        eventName: 'collection_valuation_abstained',
        properties: { reason: 'not_enough_exact_grade_sales', comparableBucket: '1-2' },
        sourceId: VALUATION_ID,
    });
});

test('single-comparable snapshot stores a constraint-safe point and publishes no range', async () => {
    const pool = new FakePool((sql) => {
        if (sql.includes('FROM collection_item')) {
            return { rows: [{
                id: ITEM_ID, user_id: USER_ID, type_id: 77, grade_code: 'XF',
                grade_source: 'heuristic', slab_status: 'unknown', grading_company_code: null,
            }] };
        }
        if (sql.includes('INSERT INTO collection_valuation')) {
            return { rows: [valuationRow({
                low_minor: '20000', median_minor: '20000', high_minor: '20000',
                comparable_count: 1, method: 'single_similar_lot',
                basis: { estimateKind: 'single_comparable', rangeAvailable: false },
            })] };
        }
        throw new Error(`unexpected SQL: ${sql}`);
    });

    const calculated = await calculateCollectionValuation(
        { itemId: ITEM_ID },
        {
            pool,
            recordEvent: async () => {},
            valuationService: {
                async valuateCollectionItem() {
                    return {
                        status: 'ready', currency: 'RUB', low: null, median: 200, high: null,
                        confidence: 0.6, comparableCount: 1, basis: 'type_grade_unknown_slab',
                        estimateKind: 'single_comparable', rangeAvailable: false,
                        method: 'single_similar_lot', methodVersion: 'improved-type-slab-v2',
                        abstainReason: null, fingerprint: 'single',
                        profile: {
                            typeId: 77, gradeCode: 'XF', gradeSource: 'heuristic',
                            slabStatus: 'unknown', gradingCompanyCode: null,
                            valuationDate: '2026-08-31', currency: 'RUB',
                        },
                        prediction: { exact_comparable_count: 1, comparable_lot_ids: [11] },
                    };
                },
            },
        },
    );

    const insert = pool.queries.find(({ sql }) => sql.includes('INSERT INTO collection_valuation'));
    assert.deepEqual(insert.params.slice(3, 6), [20000, 20000, 20000]);
    assert.equal(calculated.status, 'ready');
    const published = require('../app-v1/valuation/service').valuationFromRow(calculated.snapshot);
    assert.equal(published.estimateKind, 'single_comparable');
    assert.equal(published.rangeAvailable, false);
    assert.equal(published.lowMinor, null);
    assert.equal(published.medianMinor, 20000);
    assert.equal(published.highMinor, null);
});

test('valuation reads are owner-scoped and return immutable history', async () => {
    const pool = new FakePool((sql) => {
        if (sql.includes('SELECT id FROM collection_item')) return { rows: [{ id: ITEM_ID }] };
        if (sql.includes('FROM collection_valuation')) return { rows: [valuationRow()] };
        throw new Error(`unexpected SQL: ${sql}`);
    });
    const service = new CollectionValuationService({ pool });
    const latest = await service.latest(USER_ID, ITEM_ID);
    assert.equal(latest.medianMinor, 20000);
    assert.equal(latest.comparableCount, 5);
    assert.equal(latest.estimateKind, 'market_range');
    assert.equal(latest.rangeAvailable, true);
    assert.equal(latest.lowMinor, 10000);
    assert.equal(latest.highMinor, 30000);
    assert.deepEqual(pool.queries[0].params, [USER_ID, ITEM_ID]);
    assert.match(pool.queries[0].sql, /user_id = \$1 AND id = \$2/);
});

test('legacy single-comparable rows infer point-reference semantics', () => {
    const published = require('../app-v1/valuation/service').valuationFromRow(valuationRow({
        low_minor: '20000', median_minor: '20000', high_minor: '20000',
        comparable_count: 1,
        method: 'single_similar_lot',
        basis: { lotIds: [11] },
    }));

    assert.equal(published.estimateKind, 'single_comparable');
    assert.equal(published.rangeAvailable, false);
    assert.equal(published.lowMinor, null);
    assert.equal(published.highMinor, null);
});

test('valuation ownership failure is indistinguishable from a missing item', async () => {
    const service = new CollectionValuationService({ pool: new FakePool(() => ({ rows: [] })) });
    await assert.rejects(
        service.latest(USER_ID, ITEM_ID),
        (error) => error instanceof ValuationError && error.code === 'item_not_found',
    );
});

test('single-item recalculation calls the calculator directly and returns its snapshot', async () => {
    const pool = new FakePool((sql) => {
        if (sql.includes('SELECT id FROM collection_item')) return { rows: [{ id: ITEM_ID }] };
        throw new Error(`unexpected SQL: ${sql}`);
    });
    const calls = [];
    const service = new CollectionValuationService({
        pool,
        calculateRecalculation: async (input) => {
            calls.push(input);
            return { snapshot: valuationRow() };
        },
    });
    const result = await service.recalculate(USER_ID, ITEM_ID);
    assert.deepEqual(calls, [{ itemId: ITEM_ID }]);
    assert.equal(result.id, VALUATION_ID);
    assert.equal(result.medianMinor, 20000);
});

test('only valuation recalculation is mutating and requires auth plus CSRF', () => {
    const app = fakeApp();
    const authenticate = () => {};
    const requireCsrf = () => {};
    const recalculateLimiter = () => {};
    registerValuationRoutes(app, {
        authenticate,
        requireCsrf,
        service: {},
        recalculateLimiter,
    });
    const recalculate = app.routes.find(({ method, path }) => method === 'POST' && path.endsWith('/recalculate'));
    assert.equal(recalculate.handlers[0], authenticate);
    assert.equal(recalculate.handlers[1], requireCsrf);
    assert.equal(recalculate.handlers[2], recalculateLimiter);
    for (const route of app.routes.filter(({ method }) => method === 'GET')) {
        assert.equal(route.handlers[0], authenticate);
    }
});

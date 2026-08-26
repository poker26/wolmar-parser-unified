'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { normalizeGrade } = require('../app-v1/valuation/grade');
const { registerValuationRoutes } = require('../app-v1/valuation/routes');
const { CollectionValuationService, ValuationError } = require('../app-v1/valuation/service');
const {
    calculateCollectionValuation,
    confidenceFor,
    percentile,
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

test('percentiles and sample-size confidence are deterministic', () => {
    assert.equal(percentile([100, 200, 300, 400], 0.25), 175);
    assert.equal(percentile([100, 200, 300, 400], 0.5), 250);
    assert.equal(percentile([100, 200, 300, 400], 0.75), 325);
    assert.equal(confidenceFor(2), null);
    assert.equal(confidenceFor(3), 0.35);
    assert.equal(confidenceFor(20), 0.95);
});

test('valuation activity uses only closed RUB auction-house sales of the exact grade', async () => {
    const events = [];
    const pool = new FakePool((sql) => {
        if (sql.includes('FROM collection_item')) {
            return { rows: [{ id: ITEM_ID, user_id: USER_ID, type_id: 77, grade_code: ' xf ' }] };
        }
        if (sql.includes('FROM lot_type_link')) {
            return { rows: [
                { lot_id: 11, price_minor: '10000' },
                { lot_id: 12, price_minor: '20000' },
                { lot_id: 13, price_minor: '30000' },
                { lot_id: 14, price_minor: '40000' },
            ] };
        }
        if (sql.includes('INSERT INTO collection_valuation')) {
            return { rows: [{ id: VALUATION_ID, status: 'ready', comparable_count: 4 }] };
        }
        throw new Error(`unexpected SQL: ${sql}`);
    });

    const result = await calculateCollectionValuation(
        { itemId: ITEM_ID },
        { pool, recordEvent: async (event) => events.push(event) },
    );
    assert.equal(result.status, 'ready');
    const comparable = pool.queries.find(({ sql }) => sql.includes('FROM lot_type_link'));
    assert.match(comparable.sql, /collection_normalize_grade/);
    assert.match(comparable.sql, /source_site IN \('wolmar\.ru', 'numismat\.ru'\)/);
    assert.match(comparable.sql, /lot_status = 'closed'/);
    assert.match(comparable.sql, /auction_end_date <= now\(\)/);
    assert.match(comparable.sql, /currency, ''\), 'RUB'\) = 'RUB'/);
    assert.deepEqual(comparable.params, [77, 'XF', 250]);
    const insert = pool.queries.find(({ sql }) => sql.includes('INSERT INTO collection_valuation'));
    assert.deepEqual(insert.params.slice(2, 5), [17500, 25000, 32500]);
    const basis = JSON.parse(insert.params[11]);
    assert.deepEqual(basis.lotIds, [11, 12, 13, 14]);
    assert.equal(basis.rules.priceBasis, 'hammer');
    assert.deepEqual(events, [{
        userId: USER_ID,
        eventName: 'collection_valuation_ready',
        properties: { comparableBucket: '3-4' },
        sourceId: VALUATION_ID,
    }]);
});

test('valuation activity abstains instead of borrowing another grade', async () => {
    const events = [];
    const pool = new FakePool((sql) => {
        if (sql.includes('FROM collection_item')) {
            return { rows: [{ id: ITEM_ID, user_id: USER_ID, type_id: 77, grade_code: 'VF' }] };
        }
        if (sql.includes('FROM lot_type_link')) {
            return { rows: [{ lot_id: 21, price_minor: '10000' }, { lot_id: 22, price_minor: '12000' }] };
        }
        if (sql.includes('INSERT INTO collection_valuation')) {
            return { rows: [{ id: VALUATION_ID, status: 'insufficient_data', comparable_count: 2 }] };
        }
        throw new Error(`unexpected SQL: ${sql}`);
    });

    const result = await calculateCollectionValuation(
        { itemId: ITEM_ID },
        { pool, recordEvent: async (event) => events.push(event) },
    );
    assert.equal(result.status, 'insufficient_data');
    const insert = pool.queries.find(({ sql }) => sql.includes('INSERT INTO collection_valuation'));
    assert.deepEqual(insert.params.slice(2, 5), [null, null, null]);
    assert.equal(insert.params[12], 'not_enough_exact_grade_sales');
    assert.deepEqual(events[0], {
        userId: USER_ID,
        eventName: 'collection_valuation_abstained',
        properties: { reason: 'not_enough_exact_grade_sales', comparableBucket: '1-2' },
        sourceId: VALUATION_ID,
    });
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
    assert.deepEqual(pool.queries[0].params, [USER_ID, ITEM_ID]);
    assert.match(pool.queries[0].sql, /user_id = \$1 AND id = \$2/);
});

test('valuation ownership failure is indistinguishable from a missing item', async () => {
    const service = new CollectionValuationService({ pool: new FakePool(() => ({ rows: [] })) });
    await assert.rejects(
        service.latest(USER_ID, ITEM_ID),
        (error) => error instanceof ValuationError && error.code === 'item_not_found',
    );
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

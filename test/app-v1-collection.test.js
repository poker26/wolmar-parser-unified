'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { CollectionError, CollectionItemService } = require('../app-v1/collection/service');
const { registerCollectionRoutes } = require('../app-v1/collection/routes');
const {
    InputError,
    decodeCursor,
    encodeCursor,
    normalizeCreatePayload,
    normalizePatchPayload,
    normalizeSoldPayload,
    parseListQuery,
    uuid,
} = require('../app-v1/collection/validation');

const USER_ID = '00000000-0000-4000-8000-000000000001';
const ITEM_ID = '20000000-0000-4000-8000-000000000001';

function itemRow(overrides = {}) {
    return {
        id: ITEM_ID,
        user_id: USER_ID,
        type_id: 7,
        type_name_snapshot: '1 рубль 1900 СПБ',
        user_label: null,
        identification_status: 'linked',
        grade_system: 'adjectival',
        grade_code: 'XF',
        purchase_price_minor: '120000',
        purchase_currency: 'RUB',
        purchase_date: '2026-08-01',
        purchase_source: 'Wolmar',
        notes: null,
        status: 'active',
        sold_price_minor: null,
        sold_currency: null,
        sold_at: null,
        created_at: new Date('2026-08-26T09:00:00.000Z'),
        updated_at: new Date('2026-08-26T09:00:00.000Z'),
        catalog_name: '1 рубль 1900 СПБ',
        catalog_year: 1900,
        catalog_country: 'RU',
        catalog_era: 'imperial',
        catalog_metal: 'серебро',
        catalog_mint: 'СПБ',
        catalog_image_url: '/coin.jpg',
        catalog_cbr_number: null,
        catalog_bitkin_number: '951.299',
        ...overrides,
    };
}

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
    const add = (method) => (routePath, ...handlers) => routes.push({ method, path: routePath, handlers });
    return {
        routes,
        get: add('GET'),
        post: add('POST'),
        patch: add('PATCH'),
        delete: add('DELETE'),
    };
}

function response() {
    return {
        statusCode: 200,
        body: null,
        ended: false,
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; },
        end() { this.ended = true; return this; },
    };
}

test('create validation supports linked and unlinked physical specimens', () => {
    assert.deepEqual(normalizeCreatePayload({
        typeId: 7,
        gradeCode: 'xf',
        purchasePriceMinor: 120000,
    }), {
        typeId: 7,
        userLabel: null,
        gradeSystem: null,
        gradeCode: 'XF',
        purchasePriceMinor: 120000,
        purchaseCurrency: 'RUB',
        purchaseDate: null,
        purchaseSource: null,
        notes: null,
    });
    assert.equal(normalizeCreatePayload({ userLabel: 'Не определена' }).typeId, null);
    assert.throws(() => normalizeCreatePayload({}), (error) => error.code === 'identity_required');
    assert.throws(
        () => normalizeCreatePayload({ typeId: 7, purchaseCurrency: 'RUB' }),
        InputError,
    );
});

test('patch, sold and UUID validation reject ambiguous input', () => {
    assert.throws(() => normalizePatchPayload({}), (error) => error.code === 'empty_patch');
    assert.deepEqual(normalizePatchPayload({ gradeCode: null }), {
        gradeCode: null,
        gradeSystem: null,
    });
    assert.deepEqual(normalizeSoldPayload({}, () => '2026-08-26'), {
        soldPriceMinor: null,
        soldCurrency: null,
        soldAt: '2026-08-26',
    });
    assert.equal(uuid(ITEM_ID), ITEM_ID);
    assert.throws(() => uuid('not-a-uuid'), (error) => error.code === 'invalid_id');
});

test('cursor is opaque, stable and validated', () => {
    const row = itemRow();
    const encoded = encodeCursor(row);
    assert.deepEqual(decodeCursor(encoded), {
        createdAt: '2026-08-26T09:00:00.000Z',
        id: ITEM_ID,
    });
    assert.throws(() => decodeCursor('broken'), (error) => error.code === 'invalid_cursor');
    assert.equal(parseListQuery({ limit: '50' }).limit, 50);
    assert.throws(() => parseListQuery({ limit: '101' }), (error) => error.code === 'invalid_limit');
});

test('create is scoped to the authenticated owner and returns a catalog item', async () => {
    const pool = new FakePool((sql) => {
        if (sql.includes('INSERT INTO collection_item')) {
            return { rows: [{ id: ITEM_ID, inserted: true }], rowCount: 1 };
        }
        if (sql.includes('FROM collection_item ci')) return { rows: [itemRow()] };
        throw new Error(`unexpected SQL: ${sql}`);
    });
    const service = new CollectionItemService({ pool });
    const result = await service.create(USER_ID, normalizeCreatePayload({ typeId: 7 }), 'create-item-0001');

    assert.equal(result.created, true);
    assert.equal(result.item.id, ITEM_ID);
    assert.equal(result.item.typeName, '1 рубль 1900 СПБ');
    assert.equal(result.item.catalog.bitkinNumber, '951.299');
    const insert = pool.queries[0];
    assert.equal(insert.params[1], USER_ID);
    assert.equal(insert.params[11], 'create-item-0001');
    assert.match(pool.queries[1].sql, /ci\.user_id = \$1 AND ci\.id = \$2/);
});

test('list uses owner, filters and a composite cursor', async () => {
    const rows = [
        itemRow(),
        itemRow({ id: '20000000-0000-4000-8000-000000000002', created_at: new Date('2026-08-25T09:00:00Z') }),
    ];
    const pool = new FakePool(() => ({ rows }));
    const service = new CollectionItemService({ pool });
    const result = await service.list(USER_ID, parseListQuery({ limit: '1', status: 'active', q: 'рубль' }));

    assert.equal(result.items.length, 1);
    assert.ok(result.nextCursor);
    assert.equal(pool.queries[0].params[0], USER_ID);
    assert.match(pool.queries[0].sql, /ci\.deleted_at IS NULL/);
    assert.match(pool.queries[0].sql, /ci\.status = \$2/);
    assert.match(pool.queries[0].sql, /ORDER BY ci\.created_at DESC, ci\.id DESC/);
});

test('ownership failure is indistinguishable from a missing item', async () => {
    const pool = new FakePool(() => ({ rows: [], rowCount: 0 }));
    const service = new CollectionItemService({ pool });
    await assert.rejects(
        service.get(USER_ID, ITEM_ID),
        (error) => error instanceof CollectionError && error.code === 'item_not_found',
    );
    assert.deepEqual(pool.queries[0].params, [USER_ID, ITEM_ID]);
});

test('summary keeps monetary totals separated by currency', async () => {
    const pool = new FakePool((sql) => {
        if (sql.includes('WITH owned')) return { rows: [{
            total: 4,
            active: 2,
            sold: 1,
            archived: 1,
            unlinked: 1,
            distinct_types: 2,
            duplicates: 1,
        }] };
        return { rows: [
            { currency: 'RUB', amount_minor: '250000' },
            { currency: 'USD', amount_minor: '10000' },
        ] };
    });
    const service = new CollectionItemService({ pool });
    const result = await service.summary(USER_ID);
    assert.equal(result.distinctTypes, 2);
    assert.equal(result.duplicates, 1);
    assert.deepEqual(result.purchaseTotals, [
        { currency: 'RUB', amountMinor: 250000 },
        { currency: 'USD', amountMinor: 10000 },
    ]);
});

test('every mutating collection route requires auth and CSRF middleware', () => {
    const app = fakeApp();
    const authenticate = () => {};
    const requireCsrf = () => {};
    const service = {
        list: async () => ({ items: [], nextCursor: null }),
        get: async () => ({}),
        create: async () => ({ item: {}, created: true }),
        patch: async () => ({}),
        remove: async () => {},
        restore: async () => ({}),
        markSold: async () => ({}),
        archive: async () => ({}),
        activate: async () => ({}),
        summary: async () => ({}),
    };
    registerCollectionRoutes(app, { service, authenticate, requireCsrf });

    for (const route of app.routes.filter(({ method }) => method !== 'GET')) {
        assert.equal(route.handlers[0], authenticate, `${route.method} ${route.path} lacks auth`);
        assert.equal(route.handlers[1], requireCsrf, `${route.method} ${route.path} lacks CSRF`);
    }
});

test('v1 collection routes are registered before catalog and SPA fallback', () => {
    const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const collectionIndex = serverSource.indexOf("require('./app-v1/collection/routes').registerCollectionRoutes");
    const catalogIndex = serverSource.indexOf("require('./catalog/api')(app)");
    const fallbackIndex = serverSource.lastIndexOf("app.get('*'");
    assert.ok(collectionIndex > 0);
    assert.ok(collectionIndex < catalogIndex);
    assert.ok(collectionIndex < fallbackIndex);
});

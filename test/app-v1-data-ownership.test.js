'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { Readable } = require('node:stream');
const test = require('node:test');

const { registerDataOwnershipRoutes } = require('../app-v1/data-ownership/routes');
const { DataOwnershipService } = require('../app-v1/data-ownership/service');
const {
    buildCollectionExport,
    csv,
    csvCell,
    deleteAccountData,
} = require('../temporal/collection-data-activities');

const USER_ID = '00000000-0000-4000-8000-000000000001';
const EXPORT_ID = '50000000-0000-4000-8000-000000000001';
const DELETION_ID = '60000000-0000-4000-8000-000000000001';

class FakePool {
    constructor(handler) {
        this.handler = handler;
        this.queries = [];
        this.released = false;
    }

    async query(sql, params = []) {
        this.queries.push({ sql, params });
        return this.handler(sql, params, this.queries.length);
    }

    async connect() { return this; }
    release() { this.released = true; }
}

function exportRow(overrides = {}) {
    return {
        id: EXPORT_ID,
        user_id: USER_ID,
        status: 'queued',
        object_key: `users/${USER_ID}/exports/${EXPORT_ID}/collection.zip`,
        byte_size: null,
        sha256: null,
        item_count: null,
        photo_count: null,
        error_code: null,
        expires_at: null,
        created_at: new Date('2026-08-26T10:00:00Z'),
        completed_at: null,
        ...overrides,
    };
}

function fakeApp() {
    const routes = [];
    const add = (method) => (path, ...handlers) => routes.push({ method, path, handlers });
    return { routes, get: add('GET'), post: add('POST') };
}

test('CSV export quotes Unicode and neutralizes spreadsheet formulas', () => {
    assert.equal(csvCell('normal'), '"normal"');
    assert.equal(csvCell('a"b'), '"a""b"');
    assert.equal(csvCell('=WEBSERVICE("bad")'), '"\'=WEBSERVICE(""bad"")"');
    const content = csv(['name', 'notes'], [{ name: 'Рубль', notes: '+1' }]);
    assert.ok(content.startsWith('\uFEFF'));
    assert.match(content, /"Рубль","'\+1"/);
});

test('export request requires password confirmation and queues one private archive', async () => {
    let reauthenticated = false;
    const queued = [];
    const pool = new FakePool((sql, params) => {
        if (sql.includes("status IN ('queued', 'running')")) return { rows: [] };
        if (sql.includes('INSERT INTO collection_export')) {
            assert.equal(params[1], USER_ID);
            assert.match(params[2], new RegExp(`^users/${USER_ID}/exports/.+/collection\\.zip$`));
            return { rows: [exportRow({ id: params[0], object_key: params[2] })] };
        }
        throw new Error(`unexpected SQL: ${sql}`);
    });
    const service = new DataOwnershipService({
        pool,
        storage: {},
        authService: { reauthenticate: async (userId, password) => {
            assert.equal(userId, USER_ID);
            assert.equal(password, 'correct-password');
            reauthenticated = true;
        } },
        enqueueExport: async (input) => queued.push(input),
    });
    const result = await service.requestExport(USER_ID, 'correct-password');
    assert.equal(reauthenticated, true);
    assert.equal(result.created, true);
    assert.equal(queued.length, 1);
    assert.equal(queued[0].exportId, result.export.id);
});

test('export status is owner-scoped and only ready exports receive a short URL', async () => {
    const ready = exportRow({
        status: 'ready', byte_size: '1234', sha256: 'a'.repeat(64), item_count: 2,
        photo_count: 1, expires_at: new Date('2026-08-27T10:00:00Z'), completed_at: new Date(),
    });
    const pool = new FakePool((sql, params) => {
        assert.match(sql, /id = \$1 AND user_id = \$2/);
        assert.deepEqual(params, [EXPORT_ID, USER_ID]);
        return { rows: [ready] };
    });
    const service = new DataOwnershipService({
        pool,
        storage: { downloadUrl: async (key, ttl) => `private://${key}?ttl=${ttl}` },
        authService: { reauthenticate: async () => true },
        now: () => new Date('2026-08-26T10:00:00Z'),
    });
    const result = await service.getExport(USER_ID, EXPORT_ID);
    assert.equal(result.export.byteSize, 1234);
    assert.match(result.download.url, /^private:\/\//);
    assert.equal(result.download.fileName, 'numismat-collection.zip');
});

test('export activity creates a ZIP with CSV and original photos then stores its digest', async () => {
    let uploaded = null;
    const pool = new FakePool((sql) => {
        if (sql.includes('FROM collection_export ce JOIN app_user')) return { rows: [{
            ...exportRow(), email_normalized: 'owner@example.test', display_name: 'Owner',
            user_created_at: new Date('2026-01-01T00:00:00Z'),
        }] };
        if (sql.includes('UPDATE collection_export SET status = \'running\'')) return { rows: [] };
        if (sql.includes('FROM collection_item ci') && sql.includes('LEFT JOIN LATERAL')) return { rows: [{
            id: 'item-1', type_id: 40433, type_name_snapshot: '1 рубль 1899', notes: '=unsafe',
        }] };
        if (sql.includes('FROM collection_valuation cv')) return { rows: [{ id: 'valuation-1', item_id: 'item-1' }] };
        if (sql.includes('FROM collection_item_photo cip')) return { rows: [{
            id: 'photo-1', item_id: 'item-1', side: 'obverse', sort_order: 0,
            object_key_original: 'users/u/items/i/p/original', mime_type: 'image/jpeg',
        }] };
        if (sql.includes("SET status = 'ready'")) return { rows: [] };
        if (sql.includes("SET status = 'failed'")) return { rows: [] };
        throw new Error(`unexpected SQL: ${sql}`);
    });
    const storage = {
        getStream: async () => Readable.from(Buffer.from([0xff, 0xd8, 0xff, 0xd9])),
        putFile: async (key, filePath, size, mimeType) => {
            uploaded = { key, bytes: await fs.readFile(filePath), size, mimeType };
        },
    };
    const events = [];
    const result = await buildCollectionExport(
        { exportId: EXPORT_ID },
        { pool, storage, heartbeat: () => {}, recordEvent: async (event) => events.push(event) },
    );
    assert.equal(result.status, 'ready');
    assert.equal(result.itemCount, 1);
    assert.equal(result.photoCount, 1);
    assert.equal(uploaded.mimeType, 'application/zip');
    assert.deepEqual(uploaded.bytes.subarray(0, 2), Buffer.from('PK'));
    const binary = uploaded.bytes.toString('latin1');
    assert.match(binary, /collection\.csv/);
    assert.match(binary, /valuations\.csv/);
    assert.match(binary, /photos\/item-1\/0-obverse-photo-1\.jpg/);
    assert.match(result.sha256, /^[0-9a-f]{64}$/);
    assert.deepEqual(events, [{
        userId: USER_ID,
        eventName: 'collection_export_completed',
        properties: { itemCountBucket: '1-2', photoCountBucket: '1-2' },
        sourceId: EXPORT_ID,
    }]);
});

test('account deletion is queued before sessions are revoked', async () => {
    const order = [];
    const pool = new FakePool((sql) => {
        if (sql.includes('FROM account_deletion_request')) return { rows: [] };
        if (sql.includes('INSERT INTO account_deletion_request')) { order.push('insert'); return { rows: [] }; }
        if (sql === 'BEGIN') { order.push('begin'); return { rows: [] }; }
        if (sql.includes("SET status = 'deletion_pending'")) { order.push('lock'); return { rows: [{ id: USER_ID }] }; }
        if (sql.includes('UPDATE user_session SET revoked_at')) { order.push('revoke'); return { rows: [] }; }
        if (sql === 'COMMIT') { order.push('commit'); return { rows: [] }; }
        throw new Error(`unexpected SQL: ${sql}`);
    });
    const service = new DataOwnershipService({
        pool,
        storage: {},
        authService: { reauthenticate: async () => order.push('reauth') },
        enqueueDeletion: async () => order.push('enqueue'),
        now: () => new Date('2026-08-26T10:00:00Z'),
    });
    const result = await service.requestAccountDeletion(USER_ID, 'correct-password');
    assert.equal(result.status, 'scheduled');
    assert.deepEqual(order, ['reauth', 'insert', 'enqueue', 'begin', 'lock', 'revoke', 'commit']);
});

test('deletion activity removes every private object before cascading the account', async () => {
    const removed = [];
    const order = [];
    const pool = new FakePool((sql) => {
        if (sql.includes('FROM account_deletion_request adr')) return { rows: [{
            id: DELETION_ID, user_id: USER_ID, user_status: 'deletion_pending', status: 'scheduled', execute_after: new Date(0),
        }] };
        if (sql.includes("SET status = 'processing'")) return { rows: [] };
        if (sql.includes('SELECT object_key_original key')) return { rows: [{ key: 'original' }, { key: 'display' }, { key: 'zip' }] };
        if (sql === 'BEGIN') { order.push('begin'); return { rows: [] }; }
        if (sql.includes('DELETE FROM security_audit_event')) { order.push('delete-audit'); return { rows: [] }; }
        if (sql.includes('DELETE FROM product_event')) { order.push('delete-events'); return { rows: [] }; }
        if (sql.includes('DELETE FROM app_user')) { order.push('delete-user'); return { rows: [], rowCount: 1 }; }
        if (sql.includes("SET status = 'completed'")) { order.push('complete'); return { rows: [] }; }
        if (sql === 'COMMIT') { order.push('commit'); return { rows: [] }; }
        if (sql.includes("SET status = 'failed'")) return { rows: [] };
        throw new Error(`unexpected SQL: ${sql}`);
    });
    const result = await deleteAccountData(
        { deletionId: DELETION_ID },
        { pool, storage: { remove: async (key) => removed.push(key) }, heartbeat: () => {} },
    );
    assert.equal(result.status, 'completed');
    assert.deepEqual(removed, ['original', 'display', 'zip']);
    assert.deepEqual(order, ['begin', 'delete-audit', 'delete-events', 'delete-user', 'complete', 'commit']);
});

test('deletion activity cancels instead of erasing an account that is still active', async () => {
    let removed = false;
    const pool = new FakePool((sql) => {
        if (sql.includes('FROM account_deletion_request adr')) return { rows: [{
            id: DELETION_ID, user_id: USER_ID, user_status: 'active', status: 'scheduled', execute_after: new Date(0),
        }] };
        if (sql.includes("SET status = 'cancelled'")) return { rows: [] };
        throw new Error(`unexpected SQL: ${sql}`);
    });
    const result = await deleteAccountData(
        { deletionId: DELETION_ID },
        { pool, storage: { remove: async () => { removed = true; } }, heartbeat: () => {} },
    );
    assert.equal(result.status, 'cancelled');
    assert.equal(removed, false);
    assert.equal(pool.queries.some(({ sql }) => sql.includes('DELETE FROM app_user')), false);
});

test('export and account deletion routes require auth, CSRF and per-user limits', () => {
    const app = fakeApp();
    const authenticate = () => {};
    const requireCsrf = () => {};
    const exportLimiter = () => {};
    const deletionLimiter = () => {};
    registerDataOwnershipRoutes(app, {
        authenticate,
        requireCsrf,
        service: {},
        exportLimiter,
        deletionLimiter,
    });
    const exportPost = app.routes.find(({ method, path }) => method === 'POST' && path === '/api/v1/collection/exports');
    assert.deepEqual(exportPost.handlers.slice(0, 3), [authenticate, requireCsrf, exportLimiter]);
    const deletion = app.routes.find(({ path }) => path === '/api/v1/account/deletion');
    assert.deepEqual(deletion.handlers.slice(0, 3), [authenticate, requireCsrf, deletionLimiter]);
    const exportGet = app.routes.find(({ method }) => method === 'GET');
    assert.equal(exportGet.handlers[0], authenticate);
});

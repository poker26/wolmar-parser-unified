'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { CollectionItemService } = require('../app-v1/collection/service');
const { CollectionSyncError, CollectionSyncService } = require('../app-v1/collection/sync-service');
const {
    decodeSyncCursor,
    encodeSyncCursor,
    parseIfMatch,
    parseSyncQuery,
} = require('../app-v1/collection/validation');

const USER_ID = '00000000-0000-4000-8000-000000000001';
const ITEM_ID = '20000000-0000-4000-8000-000000000001';
const PHOTO_ID = '30000000-0000-4000-8000-000000000001';
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

function itemRow() {
    return {
        id: ITEM_ID,
        user_id: USER_ID,
        version: '7',
        type_id: null,
        catalog_issue_id: null,
        identified_year: 1990,
        type_name_snapshot: '25 рублей. Пётр I',
        user_label: null,
        identification_status: 'unlinked',
        slab_status: 'raw',
        grade_source: 'user',
        status: 'active',
        created_at: new Date('2026-09-01T10:00:00Z'),
        updated_at: new Date('2026-09-05T10:00:00Z'),
    };
}

function photoRow() {
    return {
        id: PHOTO_ID,
        item_id: ITEM_ID,
        item_version: '7',
        side: 'obverse',
        object_key_original: `users/${USER_ID}/items/${ITEM_ID}/${PHOTO_ID}/original`,
        object_key_display: `users/${USER_ID}/items/${ITEM_ID}/${PHOTO_ID}/display.jpg`,
        object_key_thumb: `users/${USER_ID}/items/${ITEM_ID}/${PHOTO_ID}/thumb.jpg`,
        declared_mime_type: 'image/jpeg',
        declared_byte_size: '4321',
        mime_type: 'image/jpeg',
        byte_size: '4321',
        width: 1200,
        height: 1200,
        sha256: 'a'.repeat(64),
        status: 'ready',
        sort_order: 0,
        created_at: new Date('2026-09-05T10:00:00Z'),
        updated_at: new Date('2026-09-05T10:00:01Z'),
    };
}

function valuationRow() {
    return {
        id: VALUATION_ID,
        item_id: ITEM_ID,
        currency: 'RUB',
        low_minor: '10000',
        median_minor: '12000',
        high_minor: '15000',
        comparable_count: 4,
        confidence: '0.7',
        status: 'ready',
        method: 'test',
        model_version: 'test-v1',
        basis: { rangeAvailable: true },
        calculated_at: new Date('2026-09-05T10:00:02Z'),
    };
}

test('sync cursor is opaque, versioned and bounded', () => {
    const cursor = encodeSyncCursor('9007199254740993');
    assert.equal(decodeSyncCursor(cursor), '9007199254740993');
    assert.deepEqual(parseSyncQuery({ cursor, limit: '500' }), {
        cursor: '9007199254740993', limit: 500,
    });
    assert.throws(() => decodeSyncCursor('broken'), (error) => error.code === 'invalid_cursor');
    assert.throws(() => parseSyncQuery({ limit: '501' }), (error) => error.code === 'invalid_limit');
});

test('If-Match accepts one strong numeric ETag and keeps the old client optional', () => {
    assert.equal(parseIfMatch(undefined), null);
    assert.equal(parseIfMatch('"17"'), 17);
    assert.equal(parseIfMatch('17'), 17);
    assert.throws(() => parseIfMatch('W/"17"'), (error) => error.code === 'invalid_version');
    assert.throws(() => parseIfMatch('*'), (error) => error.code === 'invalid_version');
});

test('delta sync returns ordered typed changes and signs original and display photos', async () => {
    const changedAt = new Date('2026-09-05T10:00:00Z');
    const pool = new FakePool((sql) => {
        if (sql.includes('FROM collection_sync_state')) return { rows: [{ minimum_available_seq: '0' }] };
        if (sql.includes('FROM collection_sync_change')) return { rows: [
            { seq: '11', entity_kind: 'item', entity_id: ITEM_ID, item_id: ITEM_ID, operation: 'upsert', changed_at: changedAt },
            { seq: '12', entity_kind: 'photo', entity_id: PHOTO_ID, item_id: ITEM_ID, operation: 'upsert', changed_at: changedAt },
            { seq: '13', entity_kind: 'valuation', entity_id: VALUATION_ID, item_id: ITEM_ID, operation: 'upsert', changed_at: changedAt },
        ] };
        if (sql.includes('FROM collection_item ci')) return { rows: [{
            ...itemRow(),
            created_idempotency_key: 'local-item-12345678',
        }] };
        if (sql.includes('FROM collection_item_photo photo')) return { rows: [photoRow()] };
        if (sql.includes('FROM collection_valuation valuation')) return { rows: [valuationRow()] };
        throw new Error(`unexpected SQL: ${sql}`);
    });
    const storage = {
        downloadUrl: async (key, ttl) => `https://objects.invalid/${key}?ttl=${ttl}`,
    };
    const service = new CollectionSyncService({ pool, storage, originalUrlTtlSeconds: 120 });

    const result = await service.sync(USER_ID, { cursor: '10', limit: 10 });

    assert.deepEqual(result.changes.map((change) => change.entityKind), ['item', 'photo', 'valuation']);
    assert.equal(result.changes[0].item.version, 7);
    assert.equal(result.changes[0].clientMutationId, 'local-item-12345678');
    assert.equal('createdIdempotencyKey' in result.changes[0].item, false);
    assert.equal(result.changes[1].photo.byteSize, 4321);
    assert.equal(result.changes[1].photo.sha256, 'a'.repeat(64));
    assert.match(result.changes[1].photo.originalUrl, /\/original\?ttl=120$/);
    assert.match(result.changes[1].photo.displayUrl, /\/display\.jpg\?ttl=120$/);
    assert.equal(result.changes[1].photo.itemVersion, 7);
    assert.equal(result.changes[2].valuation.id, VALUATION_ID);
    assert.equal(decodeSyncCursor(result.nextCursor), '13');
    assert.equal(result.hasMore, false);
});

test('a missing current entity converges as a tombstone instead of a stale upsert', async () => {
    const pool = new FakePool((sql) => {
        if (sql.includes('FROM collection_sync_state')) return { rows: [{ minimum_available_seq: '0' }] };
        if (sql.includes('FROM collection_sync_change')) return { rows: [{
            seq: '20', entity_kind: 'item', entity_id: ITEM_ID, item_id: ITEM_ID,
            operation: 'upsert', changed_at: new Date(),
        }] };
        if (sql.includes('FROM collection_item ci')) return { rows: [] };
        throw new Error(`unexpected SQL: ${sql}`);
    });
    const result = await new CollectionSyncService({ pool, storage: {} })
        .sync(USER_ID, { cursor: '19', limit: 10 });
    assert.equal(result.changes[0].operation, 'delete');
    assert.equal('item' in result.changes[0], false);
});

test('an expired cursor requires a baseline reset', async () => {
    const pool = new FakePool((sql) => {
        if (sql.includes('FROM collection_sync_state')) return { rows: [{ minimum_available_seq: '50' }] };
        throw new Error(`unexpected SQL: ${sql}`);
    });
    await assert.rejects(
        new CollectionSyncService({ pool, storage: {} }).sync(USER_ID, { cursor: '49', limit: 10 }),
        (error) => error instanceof CollectionSyncError
            && error.status === 410
            && error.code === 'cursor_expired'
            && error.details.resetRequired === true,
    );
});

test('unknown journal events fail the page instead of advancing the cursor', async () => {
    const pool = new FakePool((sql) => {
        if (sql.includes('FROM collection_sync_state')) return { rows: [{ minimum_available_seq: '0' }] };
        if (sql.includes('FROM collection_sync_change')) return { rows: [{
            seq: '2', entity_kind: 'future_kind', entity_id: ITEM_ID, item_id: ITEM_ID,
            operation: 'upsert', changed_at: new Date(),
        }] };
        throw new Error(`unexpected SQL: ${sql}`);
    });
    await assert.rejects(
        new CollectionSyncService({ pool, storage: {} }).sync(USER_ID, { cursor: '1', limit: 10 }),
        (error) => error.code === 'unknown_sync_event',
    );
});

test('conditional item mutation reports the current object with HTTP 412 semantics', async () => {
    const pool = new FakePool((sql) => {
        if (sql.startsWith('UPDATE collection_item')) return { rows: [], rowCount: 0 };
        if (sql.includes('SELECT version, deleted_at')) {
            return { rows: [{ version: '8', deleted_at: null }] };
        }
        if (sql.includes('FROM collection_item ci')) return { rows: [{ ...itemRow(), version: '8' }] };
        throw new Error(`unexpected SQL: ${sql}`);
    });
    await assert.rejects(
        new CollectionItemService({ pool }).patch(USER_ID, ITEM_ID, { notes: 'new' }, 7),
        (error) => error.status === 412
            && error.code === 'version_conflict'
            && error.details.currentVersion === 8
            && error.details.currentItem.id === ITEM_ID,
    );
});

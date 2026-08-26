'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const sharp = require('sharp');

const { registerPhotoRoutes } = require('../app-v1/photos/routes');
const { CollectionPhotoService, PhotoError } = require('../app-v1/photos/service');
const {
    MAX_PHOTO_BYTES,
    normalizeComplete,
    normalizePhotoPatch,
    normalizeUploadIntent,
} = require('../app-v1/photos/validation');
const {
    detectedMime,
    processCollectionPhoto,
} = require('../temporal/collection-photo-activities');

const USER_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_USER_ID = '00000000-0000-4000-8000-000000000002';
const ITEM_ID = '20000000-0000-4000-8000-000000000001';
const PHOTO_ID = '30000000-0000-4000-8000-000000000001';

function photoRow(overrides = {}) {
    return {
        id: PHOTO_ID,
        item_id: ITEM_ID,
        side: 'obverse',
        object_key_original: `users/${USER_ID}/items/${ITEM_ID}/${PHOTO_ID}/original`,
        object_key_display: null,
        object_key_thumb: null,
        declared_mime_type: 'image/jpeg',
        declared_byte_size: 123,
        mime_type: null,
        byte_size: null,
        width: null,
        height: null,
        sha256: null,
        status: 'pending',
        sort_order: 0,
        upload_expires_at: new Date('2026-08-26T10:10:00Z'),
        error_code: null,
        created_at: new Date('2026-08-26T10:00:00Z'),
        updated_at: new Date('2026-08-26T10:00:00Z'),
        deleted_at: null,
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
    const add = (method) => (path, ...handlers) => routes.push({ method, path, handlers });
    return {
        routes,
        get: add('GET'),
        post: add('POST'),
        patch: add('PATCH'),
        delete: add('DELETE'),
    };
}

test('photo validation fixes type, size, side and server-side photo id', () => {
    assert.deepEqual(normalizeUploadIntent({
        side: 'reverse',
        mimeType: 'IMAGE/HEIC',
        byteSize: MAX_PHOTO_BYTES,
        sortOrder: 1,
    }), {
        side: 'reverse',
        mimeType: 'image/heic',
        byteSize: MAX_PHOTO_BYTES,
        sortOrder: 1,
    });
    assert.deepEqual(normalizeComplete({ photoId: PHOTO_ID }), { photoId: PHOTO_ID });
    assert.deepEqual(normalizePhotoPatch({ side: 'other', sortOrder: 3 }), {
        side: 'other',
        sortOrder: 3,
    });
    assert.throws(() => normalizeUploadIntent({ side: 'front', mimeType: 'image/jpeg', byteSize: 10 }));
    assert.throws(() => normalizeUploadIntent({ side: 'obverse', mimeType: 'image/svg+xml', byteSize: 10 }));
    assert.throws(() => normalizeUploadIntent({ side: 'obverse', mimeType: 'image/jpeg', byteSize: MAX_PHOTO_BYTES + 1 }));
    assert.throws(() => normalizePhotoPatch({ objectKey: 'chosen/by/client' }));
});

test('upload intent verifies owner and creates a server-controlled private key', async () => {
    const pool = new FakePool((sql) => {
        if (sql.includes('SELECT id FROM collection_item')) return { rows: [{ id: ITEM_ID }] };
        if (sql.includes('array_agg')) return { rows: [{ count: 1, used_orders: [0] }] };
        if (sql.includes('INSERT INTO collection_item_photo')) {
            return { rows: [photoRow({ sort_order: 1, declared_byte_size: 456 })] };
        }
        throw new Error(`unexpected SQL: ${sql}`);
    });
    const storage = { uploadUrl: async (key) => `https://storage.invalid/${key}` };
    const service = new CollectionPhotoService({ pool, storage });
    const result = await service.createUploadIntent(USER_ID, ITEM_ID, {
        side: 'reverse', mimeType: 'image/jpeg', byteSize: 456,
    });

    assert.match(result.upload.url, new RegExp(`users/${USER_ID}/items/${ITEM_ID}/[0-9a-f-]+/original$`));
    assert.equal(result.upload.method, 'PUT');
    assert.equal(result.upload.headers['Content-Type'], 'image/jpeg');
    assert.deepEqual(pool.queries[0].params, [USER_ID, ITEM_ID]);
    const insert = pool.queries.find(({ sql }) => sql.includes('INSERT INTO collection_item_photo'));
    assert.equal(insert.params[1], ITEM_ID);
    assert.equal(insert.params[6], 1);
    assert.ok(!insert.params[3].includes('..'));
});

test('upload intent removes its pending row when URL signing fails', async () => {
    const pool = new FakePool((sql) => {
        if (sql.includes('SELECT id FROM collection_item')) return { rows: [{ id: ITEM_ID }] };
        if (sql.includes('array_agg')) return { rows: [{ count: 0, used_orders: [] }] };
        if (sql.includes('INSERT INTO collection_item_photo')) return { rows: [photoRow()] };
        if (sql.includes('DELETE FROM collection_item_photo')) return { rows: [], rowCount: 1 };
        throw new Error(`unexpected SQL: ${sql}`);
    });
    const signingError = new Error('signing unavailable');
    const service = new CollectionPhotoService({
        pool,
        storage: { uploadUrl: async () => { throw signingError; } },
    });

    await assert.rejects(
        service.createUploadIntent(USER_ID, ITEM_ID, {
            side: 'obverse', mimeType: 'image/jpeg', byteSize: 123,
        }),
        signingError,
    );
    assert.ok(pool.queries.some(({ sql }) => sql.includes('DELETE FROM collection_item_photo')));
});

test('ownership failure is indistinguishable from a missing photo', async () => {
    const pool = new FakePool(() => ({ rows: [] }));
    const service = new CollectionPhotoService({ pool, storage: {} });
    await assert.rejects(
        service.ownedPhoto(OTHER_USER_ID, PHOTO_ID),
        (error) => error instanceof PhotoError && error.code === 'photo_not_found',
    );
    assert.deepEqual(pool.queries[0].params, [OTHER_USER_ID, PHOTO_ID]);
    assert.match(pool.queries[0].sql, /ci\.user_id = \$1 AND cip\.id = \$2/);
});

test('all mutating photo routes require authentication and CSRF', () => {
    const app = fakeApp();
    const authenticate = () => {};
    const requireCsrf = () => {};
    registerPhotoRoutes(app, {
        authenticate,
        requireCsrf,
        service: {},
    });

    for (const route of app.routes.filter(({ method }) => method !== 'GET')) {
        assert.equal(route.handlers[0], authenticate, `${route.method} ${route.path} lacks auth`);
        assert.equal(route.handlers[1], requireCsrf, `${route.method} ${route.path} lacks CSRF`);
    }
});

test('photo activity validates content, creates stripped derivatives and is idempotent', async () => {
    const original = await sharp({
        create: { width: 32, height: 24, channels: 3, background: '#c0a060' },
    }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const uploads = new Map();
    const storage = {
        getBuffer: async () => original,
        putBuffer: async (key, buffer, mimeType) => uploads.set(key, { buffer, mimeType }),
    };
    const row = photoRow({
        declared_byte_size: original.length,
        object_key_original: `users/${USER_ID}/items/${ITEM_ID}/${PHOTO_ID}/original`,
        status: 'processing',
    });
    const pool = new FakePool((sql) => {
        if (sql.includes('SELECT * FROM collection_item_photo')) return { rows: [row] };
        if (sql.includes("status = 'ready'")) return { rows: [], rowCount: 1 };
        throw new Error(`unexpected SQL: ${sql}`);
    });

    const result = await processCollectionPhoto({ photoId: PHOTO_ID }, { pool, storage });
    assert.equal(result.status, 'ready');
    assert.equal(detectedMime(original), 'image/jpeg');
    assert.equal(uploads.size, 2);
    for (const { buffer, mimeType } of uploads.values()) {
        assert.equal(mimeType, 'image/jpeg');
        const metadata = await sharp(buffer).metadata();
        assert.equal(metadata.exif, undefined);
        assert.ok(metadata.width <= 1600);
        assert.ok(metadata.height <= 1600);
    }
    const update = pool.queries.find(({ sql }) => sql.includes("status = 'ready'"));
    assert.match(update.params[7], /^[0-9a-f]{64}$/);
});

test('photo activity rejects a declared JPEG with non-image content', async () => {
    const body = Buffer.from('not an image');
    const row = photoRow({ declared_byte_size: body.length, status: 'processing' });
    const pool = new FakePool((sql) => {
        if (sql.includes('SELECT * FROM collection_item_photo')) return { rows: [row] };
        if (sql.includes('SELECT object_key_original')) return { rows: [row] };
        if (sql.includes("status = 'rejected'")) return { rows: [], rowCount: 1 };
        throw new Error(`unexpected SQL: ${sql}`);
    });
    const removed = [];
    const result = await processCollectionPhoto(
        { photoId: PHOTO_ID },
        { pool, storage: { getBuffer: async () => body, remove: async (key) => removed.push(key) } },
    );
    assert.deepEqual(result, { photoId: PHOTO_ID, status: 'rejected', errorCode: 'mime_mismatch' });
    assert.deepEqual(removed, [row.object_key_original]);
});

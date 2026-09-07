'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const sharp = require('sharp');
const {
    IdentificationPhotoStagingService,
    IdentificationStagingError,
} = require('../app-v1/identification/photo-staging');

const USER_ID = '00000000-0000-4000-8000-000000000001';
const ITEM_ID = '20000000-0000-4000-8000-000000000001';
const SESSION_ID = '10000000-0000-4000-8000-000000000001';

test('staging prepares both photos and all derivatives before identification returns', async () => {
    const queries = [];
    const pool = {
        query: async (sql, params = []) => {
            queries.push({ sql, params });
            if (sql.includes('INSERT INTO collection_identification_session')) return { rows: [] };
            if (sql.includes("SET status = 'ready'")) return { rows: [{ id: params[0] }] };
            throw new Error(`unexpected SQL: ${sql}`);
        },
    };
    const uploads = new Map();
    const storage = {
        putBuffer: async (key, buffer, mimeType) => uploads.set(key, { buffer, mimeType }),
        remove: async () => {},
    };
    const image = await sharp({
        create: { width: 80, height: 60, channels: 3, background: '#806040' },
    }).jpeg().toBuffer();
    const service = new IdentificationPhotoStagingService({
        pool,
        storage,
        now: () => new Date('2026-09-04T12:00:00Z'),
    });

    const result = await service.stage(USER_ID, [
        { buffer: image, mimeType: 'image/jpeg' },
        { buffer: image, mimeType: 'image/jpeg' },
    ]);

    assert.equal(result.photos.length, 2);
    assert.deepEqual(result.photos.map((photo) => photo.side), ['obverse', 'reverse']);
    assert.equal(uploads.size, 6);
    assert.ok(result.photos.every((photo) => photo.status === 'ready'));
    const insert = queries.find(({ sql }) => sql.includes('INSERT INTO collection_identification_session'));
    const processing = JSON.parse(insert.params[2]);
    assert.equal(processing.length, 2);
    assert.ok(processing.every((photo) => photo.status === 'processing' && photo.objectKeyOriginal));
    const update = queries.find(({ sql }) => sql.includes("SET status = 'ready'"));
    assert.equal(JSON.parse(update.params[2]).length, 2);
});

test('invalid staging input returns a stable client error and retains cleanup keys after storage failure', async () => {
    const queries = [];
    const pool = {
        query: async (sql, params = []) => {
            queries.push({ sql, params });
            return { rows: [] };
        },
    };
    let removals = 0;
    const service = new IdentificationPhotoStagingService({
        pool,
        storage: {
            remove: async () => {
                removals += 1;
                if (removals === 1) throw new Error('temporary storage failure');
            },
        },
    });

    await assert.rejects(
        service.stage(USER_ID, [{ buffer: Buffer.from('not an image'), mimeType: 'image/jpeg' }]),
        (error) => error instanceof IdentificationStagingError
            && error.status === 422
            && error.code === 'invalid_image_upload',
    );
    assert.ok(queries.some(({ sql }) => sql.includes("SET status = 'discarding'")));
    assert.equal(queries.some(({ sql }) => sql.includes('DELETE FROM collection_identification_session')), false);
    const insert = queries.find(({ sql }) => sql.includes('INSERT INTO collection_identification_session'));
    assert.equal(JSON.parse(insert.params[2])[0].status, 'processing');
});

test('claim atomically attaches staged photos to the owned item', async () => {
    const photos = [0, 1].map((index) => ({
        id: `${index + 3}0000000-0000-4000-8000-000000000001`,
        side: index === 0 ? 'obverse' : 'reverse',
        sortOrder: index,
        objectKeyOriginal: `original-${index}`,
        objectKeyDisplay: `display-${index}`,
        objectKeyThumb: `thumb-${index}`,
        declaredMimeType: 'image/jpeg',
        declaredByteSize: 100,
        mimeType: 'image/jpeg',
        byteSize: 100,
        width: 80,
        height: 60,
        sha256: 'a'.repeat(64),
        status: 'ready',
    }));
    const queries = [];
    const client = {
        query: async (sql, params = []) => {
            queries.push({ sql, params });
            if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
            if (sql.includes('FROM collection_identification_session')) {
                return { rows: [{
                    id: SESSION_ID,
                    status: 'ready',
                    claimed_item_id: null,
                    expires_at: new Date('2026-09-05T12:00:00Z'),
                    photos,
                }] };
            }
            if (sql.includes('SELECT id FROM collection_item')) return { rows: [{ id: ITEM_ID }] };
            if (sql.includes('INSERT INTO collection_item_photo')) return { rows: [] };
            if (sql.includes("SET status = 'claimed'")) return { rows: [] };
            throw new Error(`unexpected SQL: ${sql}`);
        },
        release: () => {},
    };
    const pool = { query: client.query, connect: async () => client };
    const service = new IdentificationPhotoStagingService({
        pool,
        storage: {},
        now: () => new Date('2026-09-04T12:00:00Z'),
    });

    const result = await service.claim(USER_ID, SESSION_ID, ITEM_ID);

    assert.deepEqual(result, { claimed: true, idempotent: false, photoCount: 2 });
    assert.equal(queries.filter(({ sql }) => sql.includes('INSERT INTO collection_item_photo')).length, 2);
    assert.ok(queries.some(({ sql }) => sql === 'COMMIT'));
    assert.equal(queries.some(({ sql }) => sql === 'ROLLBACK'), false);
});

test('claim rejects a session owned by another user without attaching photos', async () => {
    const queries = [];
    const pool = {
        query: async (sql) => {
            queries.push(sql);
            if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] };
            if (sql.includes('FROM collection_identification_session')) return { rows: [] };
            throw new Error(`unexpected SQL: ${sql}`);
        },
    };
    const service = new IdentificationPhotoStagingService({ pool, storage: {} });
    await assert.rejects(
        service.claim(USER_ID, SESSION_ID, ITEM_ID),
        (error) => error instanceof IdentificationStagingError
            && error.code === 'identification_session_not_found',
    );
    assert.equal(queries.some((sql) => sql.includes('INSERT INTO collection_item_photo')), false);
});

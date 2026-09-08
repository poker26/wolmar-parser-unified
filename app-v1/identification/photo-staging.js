'use strict';

const crypto = require('node:crypto');
const { MinioPhotoStorage } = require('../photos/storage');
const { InvalidPhotoError, preparePhotoAssets } = require('../photos/processor');

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const CLAIMED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

class IdentificationStagingError extends Error {
    constructor(status, code, message) {
        super(message);
        this.name = 'IdentificationStagingError';
        this.status = status;
        this.code = code;
    }
}

function photoKeys(userId, sessionId, photoId) {
    const prefix = `users/${userId}/identifications/${sessionId}/${photoId}`;
    return {
        original: `${prefix}/original`,
        display: `${prefix}/display.jpg`,
        thumb: `${prefix}/thumb.jpg`,
    };
}

function storedKeys(photos) {
    return (Array.isArray(photos) ? photos : []).flatMap((photo) => [
        photo.objectKeyOriginal,
        photo.objectKeyDisplay,
        photo.objectKeyThumb,
    ]).filter(Boolean);
}

async function removeStoredObjects(storage, photos) {
    const results = await Promise.allSettled(storedKeys(photos).map((key) => storage.remove(key)));
    return results.every((result) => result.status === 'fulfilled');
}

class IdentificationPhotoStagingService {
    constructor({ pool, storage = new MinioPhotoStorage(), now = () => new Date() } = {}) {
        if (!pool || typeof pool.query !== 'function') throw new TypeError('A pg-compatible pool is required');
        this.pool = pool;
        this.storage = storage;
        this.now = now;
    }

    async stage(userId, images) {
        if (!Array.isArray(images) || images.length < 1 || images.length > 2) {
            throw new IdentificationStagingError(400, 'invalid_image_count', 'One or two images are required');
        }
        const sessionId = crypto.randomUUID();
        const expiresAt = new Date(this.now().getTime() + SESSION_TTL_MS);
        const pending = images.map((image, index) => {
            const id = crypto.randomUUID();
            return {
                id,
                side: index === 0 ? 'obverse' : 'reverse',
                sortOrder: index,
                declaredMimeType: String(image.mimeType || '').split(';', 1)[0].trim().toLowerCase(),
                declaredByteSize: image.buffer?.length || 0,
                keys: photoKeys(userId, sessionId, id),
                buffer: image.buffer,
            };
        });
        const processingPhotos = pending.map((photo) => ({
            id: photo.id,
            side: photo.side,
            sortOrder: photo.sortOrder,
            objectKeyOriginal: photo.keys.original,
            objectKeyDisplay: photo.keys.display,
            objectKeyThumb: photo.keys.thumb,
            declaredMimeType: photo.declaredMimeType,
            declaredByteSize: photo.declaredByteSize,
            status: 'processing',
        }));

        await this.pool.query(
            `INSERT INTO collection_identification_session
                (id, user_id, status, photos, expires_at)
             VALUES ($1, $2, 'processing', $3::jsonb, $4)`,
            [sessionId, userId, JSON.stringify(processingPhotos), expiresAt],
        );

        try {
            const photoResults = await Promise.allSettled(pending.map(async (photo) => {
                const assets = await preparePhotoAssets(photo.buffer, photo.declaredMimeType);
                const storageResults = await Promise.allSettled([
                    this.storage.putBuffer(photo.keys.original, photo.buffer, assets.actualMime),
                    this.storage.putBuffer(photo.keys.display, assets.display, 'image/jpeg'),
                    this.storage.putBuffer(photo.keys.thumb, assets.thumb, 'image/jpeg'),
                ]);
                const storageFailure = storageResults.find((result) => result.status === 'rejected');
                if (storageFailure) throw storageFailure.reason;
                return {
                    id: photo.id,
                    side: photo.side,
                    sortOrder: photo.sortOrder,
                    objectKeyOriginal: photo.keys.original,
                    objectKeyDisplay: photo.keys.display,
                    objectKeyThumb: photo.keys.thumb,
                    declaredMimeType: photo.declaredMimeType,
                    declaredByteSize: photo.declaredByteSize,
                    mimeType: assets.actualMime,
                    byteSize: assets.byteSize,
                    width: assets.width,
                    height: assets.height,
                    sha256: assets.sha256,
                    status: 'ready',
                };
            }));
            const photoFailure = photoResults.find((result) => result.status === 'rejected');
            if (photoFailure) throw photoFailure.reason;
            const photos = photoResults.map((result) => result.value);
            const updated = await this.pool.query(
                `UPDATE collection_identification_session
                 SET status = 'ready', photos = $3::jsonb, updated_at = now()
                 WHERE id = $1 AND user_id = $2 AND status = 'processing'
                 RETURNING id`,
                [sessionId, userId, JSON.stringify(photos)],
            );
            if (!updated.rows[0]) throw new Error('Identification session disappeared while processing');
            return { id: sessionId, expiresAt: expiresAt.toISOString(), photos };
        } catch (error) {
            await this.pool.query(
                `UPDATE collection_identification_session
                 SET status = 'discarding', expires_at = now(), updated_at = now()
                 WHERE id = $1 AND user_id = $2 AND status <> 'claimed'`,
                [sessionId, userId],
            ).catch(() => {});
            const removed = await removeStoredObjects(this.storage, processingPhotos);
            if (removed) {
                await this.pool.query(
                    `DELETE FROM collection_identification_session
                     WHERE id = $1 AND user_id = $2 AND status = 'discarding'`,
                    [sessionId, userId],
                ).catch(() => {});
            }
            if (error instanceof IdentificationStagingError) throw error;
            if (error instanceof InvalidPhotoError) {
                throw new IdentificationStagingError(422, 'invalid_image_upload', 'Invalid image upload');
            }
            throw error;
        }
    }

    async discard(userId, sessionId) {
        const result = await this.pool.query(
            `UPDATE collection_identification_session
             SET status = 'discarding', expires_at = now(), updated_at = now()
             WHERE id = $1 AND user_id = $2 AND status <> 'claimed'
             RETURNING photos`,
            [sessionId, userId],
        );
        if (result.rows[0]) {
            const removed = await removeStoredObjects(this.storage, result.rows[0].photos);
            if (removed) {
                await this.pool.query(
                    `DELETE FROM collection_identification_session
                     WHERE id = $1 AND user_id = $2 AND status = 'discarding'`,
                    [sessionId, userId],
                );
            }
        }
    }

    async claim(userId, sessionId, itemId) {
        const client = typeof this.pool.connect === 'function' ? await this.pool.connect() : this.pool;
        try {
            await client.query('BEGIN');
            const result = await this.claimWithClient(client, userId, sessionId, itemId);
            await client.query('COMMIT');
            return result;
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            throw error;
        } finally {
            if (client !== this.pool && typeof client.release === 'function') client.release();
        }
    }

    async claimWithClient(client, userId, sessionId, itemId) {
        const session = await client.query(
                `SELECT * FROM collection_identification_session
                 WHERE id = $1 AND user_id = $2
                 FOR UPDATE`,
                [sessionId, userId],
        );
        const row = session.rows[0];
        if (!row) throw new IdentificationStagingError(404, 'identification_session_not_found', 'Identification session not found');
        if (row.status === 'claimed') {
            if (row.claimed_item_id !== itemId) {
                throw new IdentificationStagingError(409, 'identification_session_claimed', 'Identification session is already used');
            }
            return { claimed: true, idempotent: true, photoCount: row.photos.length };
        }
        if (row.status !== 'ready' || new Date(row.expires_at).getTime() <= this.now().getTime()) {
            throw new IdentificationStagingError(409, 'identification_session_unavailable', 'Identification session is not ready');
        }
        const ownedItem = await client.query(
                `SELECT id FROM collection_item
                 WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
                [itemId, userId],
        );
        if (!ownedItem.rows[0]) throw new IdentificationStagingError(404, 'item_not_found', 'Collection item not found');
        const photos = Array.isArray(row.photos) ? row.photos : [];
        if (photos.length < 1 || photos.length > 2 || photos.some((photo) => photo.status !== 'ready')) {
            throw new IdentificationStagingError(409, 'identification_photos_unavailable', 'Identification photos are not ready');
        }
        for (const photo of photos) {
            await client.query(
                    `INSERT INTO collection_item_photo (
                        id, item_id, side, object_key_original, object_key_display, object_key_thumb,
                        declared_mime_type, declared_byte_size, mime_type, byte_size,
                        width, height, sha256, status, sort_order, upload_expires_at
                     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'ready',$14,now())`,
                    [
                        photo.id, itemId, photo.side,
                        photo.objectKeyOriginal, photo.objectKeyDisplay, photo.objectKeyThumb,
                        photo.declaredMimeType, photo.declaredByteSize, photo.mimeType, photo.byteSize,
                        photo.width, photo.height, photo.sha256, photo.sortOrder,
                    ],
            );
        }
        await client.query(
                `UPDATE collection_identification_session
                 SET status = 'claimed', claimed_item_id = $3,
                     expires_at = now() + interval '7 days', updated_at = now()
                 WHERE id = $1 AND user_id = $2`,
                [sessionId, userId, itemId],
        );
        return { claimed: true, idempotent: false, photoCount: photos.length };
    }

    async cleanupExpired(limit = 100) {
        const result = await this.pool.query(
            `SELECT id, status, photos
             FROM collection_identification_session
             WHERE (status <> 'claimed' AND expires_at <= now())
                OR (status = 'claimed' AND updated_at <= now() - interval '7 days')
             ORDER BY expires_at
             LIMIT $1`,
            [limit],
        );
        for (const row of result.rows) {
            if (row.status === 'claimed') {
                await this.pool.query(
                    `DELETE FROM collection_identification_session
                     WHERE id = $1 AND status = 'claimed'
                       AND updated_at <= now() - interval '7 days'`,
                    [row.id],
                );
                continue;
            }
            const marked = await this.pool.query(
                `UPDATE collection_identification_session
                 SET status = 'discarding', updated_at = now()
                 WHERE id = $1 AND status <> 'claimed' AND expires_at <= now()
                 RETURNING photos`,
                [row.id],
            );
            if (!marked.rows[0]) continue;
            const removed = await removeStoredObjects(this.storage, marked.rows[0].photos);
            if (removed) {
                await this.pool.query(
                    `DELETE FROM collection_identification_session
                     WHERE id = $1 AND status = 'discarding'`,
                    [row.id],
                );
            }
        }
        return { removedSessions: result.rows.length };
    }
}

module.exports = {
    CLAIMED_RETENTION_MS,
    SESSION_TTL_MS,
    IdentificationPhotoStagingService,
    IdentificationStagingError,
    photoKeys,
    removeStoredObjects,
    storedKeys,
};

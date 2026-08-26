'use strict';

const crypto = require('node:crypto');

class PhotoError extends Error {
    constructor(status, code, message) {
        super(message);
        this.name = 'PhotoError';
        this.status = status;
        this.code = code;
    }
}

function photoFromRow(row) {
    return {
        id: row.id,
        itemId: row.item_id,
        side: row.side,
        mimeType: row.mime_type || row.declared_mime_type,
        byteSize: row.byte_size == null ? Number(row.declared_byte_size) : Number(row.byte_size),
        width: row.width,
        height: row.height,
        status: row.status,
        sortOrder: row.sort_order,
        errorCode: row.error_code,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function translateDatabaseError(error) {
    if (error instanceof PhotoError) return error;
    if (error.code === '23505') {
        if (error.constraint === 'collection_item_photo_primary_side_idx') {
            return new PhotoError(409, 'photo_side_exists', 'This coin already has a photo for that side');
        }
        if (error.constraint === 'collection_item_photo_sort_idx') {
            return new PhotoError(409, 'photo_order_exists', 'This photo position is already occupied');
        }
    }
    if (error.code === '23514' || error.code === '22P02') {
        return new PhotoError(400, 'invalid_photo', 'Photo violates data constraints');
    }
    return error;
}

class CollectionPhotoService {
    constructor({ pool, storage, enqueueProcessing = async () => {} }) {
        if (!pool || typeof pool.query !== 'function') throw new TypeError('A pg-compatible pool is required');
        if (!storage) throw new TypeError('Photo storage is required');
        this.pool = pool;
        this.storage = storage;
        this.enqueueProcessing = enqueueProcessing;
    }

    async assertItem(userId, itemId) {
        const result = await this.pool.query(
            `SELECT id FROM collection_item
             WHERE user_id = $1 AND id = $2 AND deleted_at IS NULL`,
            [userId, itemId],
        );
        if (!result.rows[0]) throw new PhotoError(404, 'item_not_found', 'Collection item not found');
    }

    async ownedPhoto(userId, photoId, { includeDeleted = false } = {}) {
        const deletedClause = includeDeleted ? '' : 'AND cip.deleted_at IS NULL';
        const result = await this.pool.query(
            `SELECT cip.*
             FROM collection_item_photo cip
             JOIN collection_item ci ON ci.id = cip.item_id
             WHERE ci.user_id = $1 AND cip.id = $2
               AND ci.deleted_at IS NULL ${deletedClause}`,
            [userId, photoId],
        );
        if (!result.rows[0]) throw new PhotoError(404, 'photo_not_found', 'Photo not found');
        return result.rows[0];
    }

    async list(userId, itemId) {
        await this.assertItem(userId, itemId);
        const result = await this.pool.query(
            `SELECT * FROM collection_item_photo
             WHERE item_id = $1 AND deleted_at IS NULL
             ORDER BY sort_order, created_at`,
            [itemId],
        );
        return result.rows.map(photoFromRow);
    }

    async createUploadIntent(userId, itemId, input) {
        await this.assertItem(userId, itemId);
        const count = await this.pool.query(
            `SELECT count(*)::int count,
                    COALESCE(array_agg(sort_order ORDER BY sort_order), '{}') used_orders
             FROM collection_item_photo
             WHERE item_id = $1 AND deleted_at IS NULL`,
            [itemId],
        );
        if (count.rows[0].count >= 4) {
            throw new PhotoError(409, 'photo_limit_reached', 'A coin can have no more than four photos');
        }
        const usedOrders = count.rows[0].used_orders.map(Number);
        const sortOrder = input.sortOrder ?? [0, 1, 2, 3].find((value) => !usedOrders.includes(value));
        if (sortOrder === undefined) {
            throw new PhotoError(409, 'photo_order_unavailable', 'No free photo position remains');
        }

        const id = crypto.randomUUID();
        const objectKey = `users/${userId}/items/${itemId}/${id}/original`;
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
        let inserted;
        try {
            inserted = await this.pool.query(
                `INSERT INTO collection_item_photo (
                    id, item_id, side, object_key_original, declared_mime_type,
                    declared_byte_size, sort_order, upload_expires_at
                 ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
                 RETURNING *`,
                [id, itemId, input.side, objectKey, input.mimeType, input.byteSize, sortOrder, expiresAt],
            );
        } catch (error) {
            throw translateDatabaseError(error);
        }

        try {
            const uploadUrl = await this.storage.uploadUrl(objectKey, 600);
            return {
                photo: photoFromRow(inserted.rows[0]),
                upload: {
                    method: 'PUT',
                    url: uploadUrl,
                    headers: { 'Content-Type': input.mimeType },
                    expiresAt: expiresAt.toISOString(),
                },
            };
        } catch (error) {
            await this.pool.query(
                `DELETE FROM collection_item_photo
                 WHERE id = $1 AND status = 'pending'`,
                [id],
            ).catch(() => {});
            throw error;
        }
    }

    async complete(userId, itemId, photoId) {
        await this.assertItem(userId, itemId);
        const row = await this.ownedPhoto(userId, photoId);
        if (row.item_id !== itemId) throw new PhotoError(404, 'photo_not_found', 'Photo not found');
        if (row.status === 'ready') return photoFromRow(row);
        if (row.status === 'rejected') throw new PhotoError(409, 'photo_rejected', 'Rejected photo must be uploaded again');

        let stat;
        try {
            stat = await this.storage.stat(row.object_key_original);
        } catch (error) {
            if (error.code === 'NoSuchKey' || error.code === 'NotFound') {
                throw new PhotoError(409, 'photo_not_uploaded', 'Photo upload has not completed');
            }
            throw error;
        }
        if (stat.byteSize !== Number(row.declared_byte_size)) {
            await this.storage.remove(row.object_key_original).catch(() => {});
            await this.pool.query(
                `UPDATE collection_item_photo
                 SET status = 'rejected', error_code = 'size_mismatch', updated_at = now()
                 WHERE id = $1`,
                [photoId],
            );
            throw new PhotoError(422, 'photo_size_mismatch', 'Uploaded photo size differs from the upload intent');
        }

        const updated = row.status === 'processing' ? { rows: [row] } : await this.pool.query(
            `UPDATE collection_item_photo
             SET status = 'processing', byte_size = $3,
                 mime_type = COALESCE($4, declared_mime_type), error_code = NULL, updated_at = now()
             WHERE id = $1 AND item_id = $2 AND status = 'pending' AND deleted_at IS NULL
             RETURNING *`,
            [photoId, itemId, stat.byteSize, stat.mimeType],
        );
        const current = updated.rows[0] || await this.ownedPhoto(userId, photoId);
        try {
            await this.enqueueProcessing({ photoId });
        } catch (error) {
            await this.pool.query(
                `UPDATE collection_item_photo
                 SET status = 'pending', error_code = 'queue_unavailable', updated_at = now()
                 WHERE id = $1 AND status = 'processing'`,
                [photoId],
            );
            throw new PhotoError(503, 'photo_queue_unavailable', 'Photo processing is temporarily unavailable');
        }
        return photoFromRow(current);
    }

    async url(userId, photoId) {
        const row = await this.ownedPhoto(userId, photoId);
        if (row.status !== 'ready' || !row.object_key_display) {
            throw new PhotoError(409, 'photo_not_ready', 'Photo is not ready for viewing');
        }
        return {
            url: await this.storage.downloadUrl(row.object_key_display, 600),
            expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        };
    }

    async patch(userId, photoId, changes) {
        const row = await this.ownedPhoto(userId, photoId);
        const params = [];
        const assignments = [];
        if (changes.side !== undefined) {
            params.push(changes.side);
            assignments.push(`side = $${params.length}`);
        }
        if (changes.sortOrder !== undefined) {
            params.push(changes.sortOrder);
            assignments.push(`sort_order = $${params.length}`);
        }
        params.push(photoId, row.item_id);
        try {
            const result = await this.pool.query(
                `UPDATE collection_item_photo
                 SET ${assignments.join(', ')}, updated_at = now()
                 WHERE id = $${params.length - 1} AND item_id = $${params.length}
                   AND deleted_at IS NULL
                 RETURNING *`,
                params,
            );
            return photoFromRow(result.rows[0]);
        } catch (error) {
            throw translateDatabaseError(error);
        }
    }

    async remove(userId, photoId) {
        const row = await this.ownedPhoto(userId, photoId);
        await this.pool.query(
            `UPDATE collection_item_photo
             SET deleted_at = now(), updated_at = now()
             WHERE id = $1 AND item_id = $2 AND deleted_at IS NULL`,
            [photoId, row.item_id],
        );
    }
}

module.exports = {
    CollectionPhotoService,
    PhotoError,
    photoFromRow,
    translateDatabaseError,
};

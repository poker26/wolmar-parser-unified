'use strict';

const crypto = require('node:crypto');

const EXPORT_TTL_MS = 24 * 60 * 60 * 1000;
const DELETION_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

class DataOwnershipError extends Error {
    constructor(status, code, message) {
        super(message);
        this.name = 'DataOwnershipError';
        this.status = status;
        this.code = code;
    }
}

function exportFromRow(row) {
    return {
        id: row.id,
        status: row.status,
        byteSize: row.byte_size == null ? null : Number(row.byte_size),
        sha256: row.sha256,
        itemCount: row.item_count == null ? null : Number(row.item_count),
        photoCount: row.photo_count == null ? null : Number(row.photo_count),
        errorCode: row.error_code,
        expiresAt: row.expires_at,
        createdAt: row.created_at,
        completedAt: row.completed_at,
    };
}

class DataOwnershipService {
    constructor({
        pool,
        storage,
        authService,
        enqueueExport = async () => {},
        enqueueDeletion = async () => {},
        now = () => new Date(),
        exportTtlMs = EXPORT_TTL_MS,
        deletionGraceMs = DELETION_GRACE_MS,
    }) {
        if (!pool || typeof pool.query !== 'function') throw new TypeError('A pg-compatible pool is required');
        if (!storage) throw new TypeError('Private object storage is required');
        if (!authService || typeof authService.reauthenticate !== 'function') {
            throw new TypeError('Authentication service with reauthenticate is required');
        }
        this.pool = pool;
        this.storage = storage;
        this.authService = authService;
        this.enqueueExport = enqueueExport;
        this.enqueueDeletion = enqueueDeletion;
        this.now = now;
        this.exportTtlMs = exportTtlMs;
        this.deletionGraceMs = deletionGraceMs;
    }

    async requestExport(userId, password) {
        await this.authService.reauthenticate(userId, password);
        const existing = await this.pool.query(
            `SELECT * FROM collection_export
             WHERE user_id = $1 AND status IN ('queued', 'running')
             ORDER BY created_at DESC LIMIT 1`,
            [userId],
        );
        if (existing.rows[0]) return { export: exportFromRow(existing.rows[0]), created: false };

        const exportId = crypto.randomUUID();
        const objectKey = `users/${userId}/exports/${exportId}/collection.zip`;
        let inserted;
        try {
            inserted = await this.pool.query(
                `INSERT INTO collection_export (id, user_id, object_key)
                 VALUES ($1, $2, $3) RETURNING *`,
                [exportId, userId, objectKey],
            );
        } catch (error) {
            if (error.code !== '23505') throw error;
            const concurrent = await this.pool.query(
                `SELECT * FROM collection_export
                 WHERE user_id = $1 AND status IN ('queued', 'running')
                 ORDER BY created_at DESC LIMIT 1`,
                [userId],
            );
            if (concurrent.rows[0]) return { export: exportFromRow(concurrent.rows[0]), created: false };
            throw error;
        }

        try {
            await this.enqueueExport({ exportId, userId });
        } catch (_) {
            await this.pool.query(
                `DELETE FROM collection_export WHERE id = $1 AND user_id = $2 AND status = 'queued'`,
                [exportId, userId],
            ).catch(() => {});
            throw new DataOwnershipError(503, 'export_queue_unavailable', 'Export is temporarily unavailable');
        }
        return { export: exportFromRow(inserted.rows[0]), created: true };
    }

    async getExport(userId, exportId) {
        const result = await this.pool.query(
            `SELECT * FROM collection_export WHERE id = $1 AND user_id = $2`,
            [exportId, userId],
        );
        const row = result.rows[0];
        if (!row) throw new DataOwnershipError(404, 'export_not_found', 'Export not found');
        if (row.status === 'ready' && new Date(row.expires_at).getTime() <= this.now().getTime()) {
            const expired = await this.pool.query(
                `UPDATE collection_export SET status = 'expired'
                 WHERE id = $1 AND user_id = $2 AND status = 'ready'
                 RETURNING *`,
                [exportId, userId],
            );
            return { export: exportFromRow(expired.rows[0] || { ...row, status: 'expired' }), download: null };
        }
        const output = { export: exportFromRow(row), download: null };
        if (row.status === 'ready') {
            output.download = {
                url: await this.storage.downloadUrl(row.object_key, 600),
                expiresAt: new Date(this.now().getTime() + 10 * 60 * 1000).toISOString(),
                fileName: 'numismat-collection.zip',
            };
        }
        return output;
    }

    async requestAccountDeletion(userId, password) {
        await this.authService.reauthenticate(userId, password);
        const duplicate = await this.pool.query(
            `SELECT id, status, execute_after FROM account_deletion_request
             WHERE user_id = $1 AND status IN ('scheduled', 'processing', 'failed')
             ORDER BY created_at DESC LIMIT 1`,
            [userId],
        );
        if (duplicate.rows[0]) {
            throw new DataOwnershipError(409, 'deletion_already_scheduled', 'Account deletion is already scheduled');
        }

        const deletionId = crypto.randomUUID();
        const executeAt = new Date(this.now().getTime() + this.deletionGraceMs);
        const pseudonym = crypto.createHash('sha256').update(`account-deletion:${userId}`).digest('hex');
        await this.pool.query(
            `INSERT INTO account_deletion_request
                (id, user_id, user_pseudonym, status, execute_after)
             VALUES ($1, $2, $3, 'scheduled', $4)`,
            [deletionId, userId, pseudonym, executeAt],
        );

        try {
            await this.enqueueDeletion({ deletionId, executeAt: executeAt.toISOString() });
        } catch (_) {
            await this.pool.query(
                `DELETE FROM account_deletion_request
                 WHERE id = $1 AND user_id = $2 AND status = 'scheduled'`,
                [deletionId, userId],
            ).catch(() => {});
            throw new DataOwnershipError(503, 'deletion_queue_unavailable', 'Account deletion is temporarily unavailable');
        }

        const client = typeof this.pool.connect === 'function' ? await this.pool.connect() : this.pool;
        try {
            await client.query('BEGIN');
            const locked = await client.query(
                `UPDATE app_user SET status = 'deletion_pending', updated_at = now()
                 WHERE id = $1 AND status = 'active' RETURNING id`,
                [userId],
            );
            if (!locked.rows[0]) {
                throw new DataOwnershipError(409, 'account_not_active', 'Account is not active');
            }
            await client.query(
                `UPDATE user_session SET revoked_at = now()
                 WHERE user_id = $1 AND revoked_at IS NULL`,
                [userId],
            );
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            await this.pool.query(
                `UPDATE account_deletion_request SET status = 'cancelled', error_code = 'account_lock_failed'
                 WHERE id = $1 AND status = 'scheduled'`,
                [deletionId],
            ).catch(() => {});
            throw error;
        } finally {
            if (client !== this.pool && typeof client.release === 'function') client.release();
        }
        return { deletionId, status: 'scheduled', executeAt: executeAt.toISOString() };
    }
}

module.exports = {
    DELETION_GRACE_MS,
    EXPORT_TTL_MS,
    DataOwnershipError,
    DataOwnershipService,
    exportFromRow,
};

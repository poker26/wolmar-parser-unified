'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const archiver = require('archiver');
const { heartbeat } = require('@temporalio/activity');
const { Pool } = require('pg');
const config = require('../config');
const {
    ProductAnalytics,
    countBucket,
    pseudonymizeUser,
    safeRecorder,
} = require('../app-v1/analytics/service');
const { hashSecuritySubject } = require('../app-v1/security/service');
const { MinioPhotoStorage } = require('../app-v1/photos/storage');

const EXPORT_TTL_MS = 24 * 60 * 60 * 1000;

function csvCell(value) {
    if (value === null || value === undefined) return '';
    let text = value instanceof Date ? value.toISOString() : String(value);
    if (/^[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
}

function csv(columns, rows) {
    const output = [columns.map(csvCell).join(',')];
    for (const row of rows) output.push(columns.map((column) => csvCell(row[column])).join(','));
    return `\uFEFF${output.join('\r\n')}\r\n`;
}

function extensionFor(mimeType) {
    return ({
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
        'image/heic': 'heic',
        'image/heif': 'heif',
    })[mimeType] || 'bin';
}

async function sha256File(filePath) {
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
    return hash.digest('hex');
}

async function createArchive({ tempPath, account, items, valuations, photos, storage, heartbeatFn = heartbeat }) {
    const output = fs.createWriteStream(tempPath, { flags: 'wx' });
    const archive = archiver('zip', { zlib: { level: 6 } });
    const completed = new Promise((resolve, reject) => {
        output.once('close', resolve);
        output.once('error', reject);
        archive.once('error', reject);
    });
    archive.pipe(output);
    archive.append(JSON.stringify({
        format: 'numismat-collection-export-v1',
        exportedAt: new Date().toISOString(),
        account: { email: account.email_normalized, displayName: account.display_name || null },
        itemCount: items.length,
        photoCount: photos.length,
        valuationCount: valuations.length,
    }, null, 2), { name: 'manifest.json' });
    archive.append(JSON.stringify({
        email: account.email_normalized,
        displayName: account.display_name || null,
        createdAt: account.created_at,
    }, null, 2), { name: 'account.json' });

    const itemColumns = [
        'id', 'type_id', 'type_name_snapshot', 'user_label', 'identification_status',
        'grade_system', 'grade_code', 'purchase_price_minor', 'purchase_currency',
        'purchase_date', 'purchase_source', 'notes', 'status', 'sold_price_minor',
        'sold_currency', 'sold_at', 'created_at', 'updated_at', 'deleted_at',
        'valuation_status', 'valuation_low_minor', 'valuation_median_minor',
        'valuation_high_minor', 'valuation_currency', 'valuation_calculated_at',
    ];
    archive.append(csv(itemColumns, items), { name: 'collection.csv' });
    const valuationColumns = [
        'id', 'item_id', 'currency', 'low_minor', 'median_minor', 'high_minor',
        'grade_code', 'comparable_count', 'confidence', 'status', 'method',
        'model_version', 'abstain_reason', 'calculated_at',
    ];
    archive.append(csv(valuationColumns, valuations), { name: 'valuations.csv' });

    for (let index = 0; index < photos.length; index += 1) {
        const photo = photos[index];
        heartbeatFn({ photo: index + 1, totalPhotos: photos.length });
        const stream = await storage.getStream(photo.object_key_original);
        const ext = extensionFor(photo.mime_type || photo.declared_mime_type);
        const name = `photos/${photo.item_id}/${photo.sort_order}-${photo.side}-${photo.id}.${ext}`;
        archive.append(stream, { name });
    }
    await archive.finalize();
    await completed;
}

async function buildCollectionExport({ exportId }, dependencies = {}) {
    const pool = dependencies.pool || new Pool({ ...config.dbConfig, max: 2 });
    const storage = dependencies.storage || new MinioPhotoStorage();
    const recordEvent = dependencies.recordEvent || safeRecorder(new ProductAnalytics({ pool }));
    const ownsPool = !dependencies.pool;
    const tempPath = path.join(os.tmpdir(), `wolmar-collection-export-${exportId}.zip`);
    try {
        const request = await pool.query(
            `SELECT ce.*, u.email_normalized, u.display_name, u.created_at user_created_at
             FROM collection_export ce JOIN app_user u ON u.id = ce.user_id
             WHERE ce.id = $1`,
            [exportId],
        );
        const row = request.rows[0];
        if (!row) return { exportId, skipped: 'missing' };
        if (row.status === 'ready') return { exportId, status: 'ready', existing: true };
        await pool.query(
            `UPDATE collection_export SET status = 'running', started_at = COALESCE(started_at, now()), error_code = NULL
             WHERE id = $1 AND status IN ('queued', 'running', 'failed')`,
            [exportId],
        );

        const itemsResult = await pool.query(
            `SELECT ci.*,
                    cv.status valuation_status, cv.low_minor valuation_low_minor,
                    cv.median_minor valuation_median_minor, cv.high_minor valuation_high_minor,
                    cv.currency valuation_currency, cv.calculated_at valuation_calculated_at
             FROM collection_item ci
             LEFT JOIN LATERAL (
                 SELECT * FROM collection_valuation
                 WHERE item_id = ci.id ORDER BY calculated_at DESC, id DESC LIMIT 1
             ) cv ON true
             WHERE ci.user_id = $1
             ORDER BY ci.created_at, ci.id`,
            [row.user_id],
        );
        const valuationsResult = await pool.query(
            `SELECT cv.* FROM collection_valuation cv
             JOIN collection_item ci ON ci.id = cv.item_id
             WHERE ci.user_id = $1 ORDER BY cv.calculated_at, cv.id`,
            [row.user_id],
        );
        const photosResult = await pool.query(
            `SELECT cip.* FROM collection_item_photo cip
             JOIN collection_item ci ON ci.id = cip.item_id
             WHERE ci.user_id = $1 AND cip.deleted_at IS NULL AND cip.status = 'ready'
             ORDER BY cip.item_id, cip.sort_order, cip.id`,
            [row.user_id],
        );
        await fsp.rm(tempPath, { force: true });
        await createArchive({
            tempPath,
            account: {
                email_normalized: row.email_normalized,
                display_name: row.display_name,
                created_at: row.user_created_at,
            },
            items: itemsResult.rows,
            valuations: valuationsResult.rows,
            photos: photosResult.rows,
            storage,
            heartbeatFn: dependencies.heartbeat || heartbeat,
        });
        const stat = await fsp.stat(tempPath);
        const digest = await sha256File(tempPath);
        await storage.putFile(row.object_key, tempPath, stat.size, 'application/zip');
        const expiresAt = new Date(Date.now() + EXPORT_TTL_MS);
        await pool.query(
            `UPDATE collection_export
             SET status = 'ready', byte_size = $2, sha256 = $3,
                 item_count = $4, photo_count = $5, completed_at = now(), expires_at = $6,
                 error_code = NULL
             WHERE id = $1`,
            [exportId, stat.size, digest, itemsResult.rows.length, photosResult.rows.length, expiresAt],
        );
        await recordEvent({
            userId: row.user_id,
            eventName: 'collection_export_completed',
            properties: {
                itemCountBucket: countBucket(itemsResult.rows.length),
                photoCountBucket: countBucket(photosResult.rows.length),
            },
            sourceId: exportId,
        });
        return {
            exportId,
            status: 'ready',
            byteSize: stat.size,
            sha256: digest,
            itemCount: itemsResult.rows.length,
            photoCount: photosResult.rows.length,
        };
    } catch (error) {
        await pool.query(
            `UPDATE collection_export SET status = 'failed', error_code = 'export_failed'
             WHERE id = $1 AND status <> 'ready'`,
            [exportId],
        ).catch(() => {});
        throw error;
    } finally {
        await fsp.rm(tempPath, { force: true }).catch(() => {});
        if (ownsPool) await pool.end();
    }
}

async function deleteAccountData({ deletionId }, dependencies = {}) {
    const pool = dependencies.pool || new Pool({ ...config.dbConfig, max: 2 });
    const storage = dependencies.storage || new MinioPhotoStorage();
    const ownsPool = !dependencies.pool;
    try {
        const request = await pool.query(
            `SELECT adr.*, u.status user_status, u.email_normalized
             FROM account_deletion_request adr
             LEFT JOIN app_user u ON u.id = adr.user_id
             WHERE adr.id = $1`,
            [deletionId],
        );
        const row = request.rows[0];
        if (!row) return { deletionId, skipped: 'missing' };
        if (row.status === 'completed' || row.status === 'cancelled') {
            return { deletionId, status: row.status, existing: true };
        }
        if (!row.user_id) return { deletionId, skipped: 'user_missing' };
        if (row.user_status !== 'deletion_pending') {
            await pool.query(
                `UPDATE account_deletion_request
                 SET status = 'cancelled', error_code = 'account_not_pending'
                 WHERE id = $1 AND status IN ('scheduled', 'failed')`,
                [deletionId],
            );
            return { deletionId, status: 'cancelled', skipped: 'account_not_pending' };
        }
        if (new Date(row.execute_after).getTime() > Date.now()) return { deletionId, skipped: 'too_early' };
        await pool.query(
            `UPDATE account_deletion_request
             SET status = 'processing', started_at = COALESCE(started_at, now()), error_code = NULL
             WHERE id = $1 AND status IN ('scheduled', 'failed', 'processing')`,
            [deletionId],
        );
        const objects = await pool.query(
            `SELECT object_key_original key FROM collection_item_photo cip
                 JOIN collection_item ci ON ci.id = cip.item_id WHERE ci.user_id = $1
             UNION SELECT object_key_display key FROM collection_item_photo cip
                 JOIN collection_item ci ON ci.id = cip.item_id WHERE ci.user_id = $1
             UNION SELECT object_key_thumb key FROM collection_item_photo cip
                 JOIN collection_item ci ON ci.id = cip.item_id WHERE ci.user_id = $1
             UNION SELECT object_key key FROM collection_export WHERE user_id = $1`,
            [row.user_id],
        );
        const keys = [...new Set(objects.rows.map((entry) => entry.key).filter(Boolean))];
        for (let index = 0; index < keys.length; index += 1) {
            (dependencies.heartbeat || heartbeat)({ object: index + 1, totalObjects: keys.length });
            await storage.remove(keys[index]);
        }
        const client = typeof pool.connect === 'function' ? await pool.connect() : pool;
        try {
            await client.query('BEGIN');
            const auditPseudonyms = [hashSecuritySubject('user', row.user_id)];
            if (row.email_normalized) {
                auditPseudonyms.push(hashSecuritySubject('login', row.email_normalized));
            }
            await client.query(
                `DELETE FROM security_audit_event
                 WHERE actor_pseudonym::text = ANY($1::text[])`,
                [auditPseudonyms],
            );
            await client.query(
                `DELETE FROM product_event WHERE user_pseudonym = $1`,
                [pseudonymizeUser(row.user_id)],
            );
            await client.query(`DELETE FROM app_user WHERE id = $1`, [row.user_id]);
            await client.query(
                `UPDATE account_deletion_request
                 SET status = 'completed', completed_at = now(), error_code = NULL
                 WHERE id = $1`,
                [deletionId],
            );
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            throw error;
        } finally {
            if (client !== pool && typeof client.release === 'function') client.release();
        }
        return { deletionId, status: 'completed', removedObjects: keys.length };
    } catch (error) {
        await pool.query(
            `UPDATE account_deletion_request SET status = 'failed', error_code = 'deletion_failed'
             WHERE id = $1 AND status <> 'completed'`,
            [deletionId],
        ).catch(() => {});
        throw error;
    } finally {
        if (ownsPool) await pool.end();
    }
}

module.exports = {
    EXPORT_TTL_MS,
    buildCollectionExport,
    createArchive,
    csv,
    csvCell,
    deleteAccountData,
    extensionFor,
    sha256File,
};

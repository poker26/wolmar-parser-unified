'use strict';

const crypto = require('node:crypto');
const { Pool } = require('pg');
const sharp = require('sharp');
const convertHeic = require('heic-convert');
const config = require('../config');
const { ProductAnalytics, safeRecorder } = require('../app-v1/analytics/service');
const { MinioPhotoStorage } = require('../app-v1/photos/storage');

class InvalidPhotoError extends Error {}

function detectedMime(buffer) {
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        return 'image/jpeg';
    }
    if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
        return 'image/png';
    }
    if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
        return 'image/webp';
    }
    if (buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp') {
        const brand = buffer.toString('ascii', 8, 12);
        if (['heic', 'heix', 'hevc', 'hevx'].includes(brand)) return 'image/heic';
        if (['mif1', 'msf1'].includes(brand)) return 'image/heif';
    }
    return null;
}

function compatibleMime(declared, actual) {
    if (declared === actual) return true;
    return ['image/heic', 'image/heif'].includes(declared)
        && ['image/heic', 'image/heif'].includes(actual);
}

async function processCollectionPhoto({ photoId }, dependencies = {}) {
    const pool = dependencies.pool || new Pool({ ...config.dbConfig, max: 1 });
    const storage = dependencies.storage || new MinioPhotoStorage();
    const recordEvent = dependencies.recordEvent || safeRecorder(new ProductAnalytics({ pool }));
    const ownsPool = !dependencies.pool;
    try {
        const result = await pool.query(
            `SELECT cip.*, ci.user_id
             FROM collection_item_photo cip
             JOIN collection_item ci ON ci.id = cip.item_id
             WHERE cip.id = $1 AND cip.deleted_at IS NULL AND ci.deleted_at IS NULL`,
            [photoId],
        );
        const row = result.rows[0];
        if (!row) return { photoId, skipped: 'missing' };
        if (row.status === 'ready') {
            await recordEvent({
                userId: row.user_id,
                eventName: 'collection_photo_ready',
                properties: { side: row.side },
                sourceId: photoId,
            });
            return { photoId, status: 'ready', idempotent: true };
        }
        if (row.status === 'rejected') return { photoId, status: 'rejected', idempotent: true };

        const original = await storage.getBuffer(row.object_key_original);
        if (original.length !== Number(row.declared_byte_size)) {
            throw new InvalidPhotoError('size_mismatch');
        }
        const actualMime = detectedMime(original);
        if (!actualMime || !compatibleMime(row.declared_mime_type, actualMime)) {
            throw new InvalidPhotoError('mime_mismatch');
        }

        let metadata;
        let display;
        let thumb;
        try {
            let imageInput = original;
            if (actualMime === 'image/heic' || actualMime === 'image/heif') {
                imageInput = Buffer.from(await convertHeic({
                    buffer: original,
                    format: 'JPEG',
                    quality: 0.95,
                }));
            }

            const base = sharp(imageInput, { limitInputPixels: 80_000_000 }).rotate();
            metadata = await base.clone().metadata();
            if (!metadata.width || !metadata.height || metadata.width * metadata.height > 80_000_000) {
                throw new InvalidPhotoError('invalid_dimensions');
            }
            display = await base.clone()
                .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
                .jpeg({ quality: 88, mozjpeg: true })
                .toBuffer();
            thumb = await base.clone()
                .resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true })
                .jpeg({ quality: 82, mozjpeg: true })
                .toBuffer();
        } catch (error) {
            if (error instanceof InvalidPhotoError) throw error;
            throw new InvalidPhotoError('decode_failed');
        }

        const prefix = row.object_key_original.replace(/\/original$/, '');
        const displayKey = `${prefix}/display.jpg`;
        const thumbKey = `${prefix}/thumb.jpg`;
        await storage.putBuffer(displayKey, display, 'image/jpeg');
        await storage.putBuffer(thumbKey, thumb, 'image/jpeg');

        const sha256 = crypto.createHash('sha256').update(original).digest('hex');
        await pool.query(
            `UPDATE collection_item_photo
             SET object_key_display = $2, object_key_thumb = $3,
                 mime_type = $4, byte_size = $5, width = $6, height = $7,
                 sha256 = $8, status = 'ready', error_code = NULL, updated_at = now()
             WHERE id = $1 AND deleted_at IS NULL`,
            [
                photoId, displayKey, thumbKey, actualMime, original.length,
                metadata.width, metadata.height, sha256,
            ],
        );
        await recordEvent({
            userId: row.user_id,
            eventName: 'collection_photo_ready',
            properties: { side: row.side },
            sourceId: photoId,
        });
        return { photoId, status: 'ready', width: metadata.width, height: metadata.height };
    } catch (error) {
        if (error instanceof InvalidPhotoError) {
            const row = await pool.query(
                `SELECT object_key_original FROM collection_item_photo
                 WHERE id = $1 AND deleted_at IS NULL`,
                [photoId],
            );
            if (row.rows[0]?.object_key_original) {
                await storage.remove(row.rows[0].object_key_original).catch(() => {});
            }
            await pool.query(
                `UPDATE collection_item_photo
                 SET status = 'rejected', error_code = $2, updated_at = now()
                 WHERE id = $1 AND deleted_at IS NULL`,
                [photoId, error.message],
            );
            return { photoId, status: 'rejected', errorCode: error.message };
        }
        throw error;
    } finally {
        if (ownsPool) await pool.end();
    }
}

module.exports = {
    InvalidPhotoError,
    compatibleMime,
    detectedMime,
    processCollectionPhoto,
};

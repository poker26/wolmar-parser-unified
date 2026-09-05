'use strict';

const express = require('express');
const multer = require('multer');
const { CoinIdentificationService, IdentificationError, MAX_IDENTIFY_BYTES } = require('./service');
const {
    IdentificationPhotoStagingService,
    IdentificationStagingError,
} = require('./photo-staging');
const { normalizeCreatePayload, uuid } = require('../collection/validation');
const { CollectionItemService } = require('../collection/service');
const { auditReasonCode, safeAuditRecorder } = require('../security/service');

function errorBody(code, message) {
    return { error: { code, message } };
}

function registerIdentificationRoutes(app, {
    pool = null,
    authenticate,
    requireCsrf,
    limiter = (req, res, next) => next(),
    service = null,
    stagingService = null,
    collectionServiceFactory = (client) => new CollectionItemService({ pool: client }),
    audit = null,
} = {}) {
    if (typeof authenticate !== 'function' || typeof requireCsrf !== 'function') {
        throw new TypeError('Auth middleware is required');
    }
    const identification = service || new CoinIdentificationService({ pool });
    const staging = stagingService || new IdentificationPhotoStagingService({ pool });
    const recordAudit = safeAuditRecorder(audit);
    const imageBody = express.raw({ type: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'], limit: MAX_IDENTIFY_BYTES });
    const imageUpload = multer({
        storage: multer.memoryStorage(),
        limits: { files: 2, fileSize: MAX_IDENTIFY_BYTES, fields: 0 },
    }).array('images', 2);
    const parseImages = (req, res, next) => {
        const parser = String(req.get('content-type') || '').toLowerCase().startsWith('multipart/form-data;')
            ? imageUpload
            : imageBody;
        parser(req, res, (error) => {
            if (!error) return next();
            const tooLarge = error instanceof multer.MulterError
                && (error.code === 'LIMIT_FILE_SIZE' || error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_PART_COUNT');
            const payloadTooLarge = tooLarge || error.type === 'entity.too.large';
            return res.status(payloadTooLarge ? 413 : 400).json(
                errorBody(payloadTooLarge ? 'image_too_large' : 'invalid_image_upload', payloadTooLarge ? 'Images are too large' : 'Invalid image upload'),
            );
        });
    };

    app.post('/api/v1/collection/identify', authenticate, requireCsrf, limiter, parseImages, async (req, res, next) => {
        try {
            const uploaded = Array.isArray(req.files) && req.files.length
                ? req.files.map((file) => ({ buffer: file.buffer, mimeType: file.mimetype }))
                : [{ buffer: req.body, mimeType: req.get('content-type') }];
            const [recognitionResult, stagingResult] = await Promise.allSettled([
                identification.identify(uploaded),
                staging.stage(req.appAuth.userId, uploaded),
            ]);
            if (recognitionResult.status === 'rejected') {
                if (stagingResult.status === 'fulfilled') {
                    await staging.discard(req.appAuth.userId, stagingResult.value.id).catch(() => {});
                }
                throw recognitionResult.reason;
            }
            if (stagingResult.status === 'rejected') throw stagingResult.reason;
            await recordAudit({
                actorKind: 'user', actorRef: req.appAuth.userId, action: 'coin.identify',
                outcome: 'succeeded', requestId: req.appRequestId || null,
            });
            return res.json({
                ...recognitionResult.value,
                identificationSessionId: stagingResult.value.id,
            });
        } catch (error) {
            await recordAudit({
                actorKind: 'user', actorRef: req.appAuth?.userId, action: 'coin.identify',
                outcome: error.status === 401 || error.status === 403 ? 'denied' : 'failed',
                reasonCode: auditReasonCode(error), requestId: req.appRequestId || null,
            });
            if (error instanceof IdentificationError || error instanceof IdentificationStagingError || error.status) {
                return res.status(error.status || 400).json(errorBody(error.code || 'recognition_failed', error.message));
            }
            return next(error);
        }
    });

    app.post('/api/v1/collection/identifications/:id/claim', authenticate, requireCsrf, async (req, res, next) => {
        try {
            const result = await staging.claim(
                req.appAuth.userId,
                uuid(req.params.id, 'identificationSessionId'),
                uuid(req.body?.itemId, 'itemId'),
            );
            return res.json(result);
        } catch (error) {
            if (error instanceof IdentificationStagingError || error.status) {
                return res.status(error.status || 400).json(errorBody(error.code || 'invalid_input', error.message));
            }
            return next(error);
        }
    });

    app.post('/api/v1/collection/identifications/:id/save', authenticate, requireCsrf, async (req, res, next) => {
        let client;
        try {
            const sessionId = uuid(req.params.id, 'identificationSessionId');
            const input = normalizeCreatePayload(req.body);
            client = await pool.connect();
            await client.query('BEGIN');
            const items = collectionServiceFactory(client);
            const created = await items.create(req.appAuth.userId, input, sessionId);
            await staging.claimWithClient(client, req.appAuth.userId, sessionId, created.item.id);
            const item = await items.get(req.appAuth.userId, created.item.id);
            await client.query('COMMIT');
            if (typeof res.set === 'function') res.set('ETag', `"${item.version}"`);
            return res.status(created.created ? 201 : 200).json({ item });
        } catch (error) {
            if (client) await client.query('ROLLBACK').catch(() => {});
            if (error instanceof IdentificationStagingError || error.status) {
                return res.status(error.status || 400).json(errorBody(error.code || 'invalid_input', error.message));
            }
            return next(error);
        } finally {
            client?.release?.();
        }
    });

    app.delete('/api/v1/collection/identifications/:id', authenticate, requireCsrf, async (req, res, next) => {
        try {
            await staging.discard(
                req.appAuth.userId,
                uuid(req.params.id, 'identificationSessionId'),
            );
            return res.status(204).end();
        } catch (error) {
            if (error instanceof IdentificationStagingError || error.status) {
                return res.status(error.status || 400).json(errorBody(error.code || 'invalid_input', error.message));
            }
            return next(error);
        }
    });

    const cleanupTimer = setInterval(() => {
        void staging.cleanupExpired().catch(() => {});
    }, 60 * 60 * 1000);
    cleanupTimer.unref?.();

    return { service: identification, stagingService: staging, cleanupTimer };
}

module.exports = { registerIdentificationRoutes };

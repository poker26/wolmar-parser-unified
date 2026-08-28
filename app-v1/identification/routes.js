'use strict';

const express = require('express');
const multer = require('multer');
const { CoinIdentificationService, IdentificationError, MAX_IDENTIFY_BYTES } = require('./service');
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
    audit = null,
} = {}) {
    if (typeof authenticate !== 'function' || typeof requireCsrf !== 'function') {
        throw new TypeError('Auth middleware is required');
    }
    const identification = service || new CoinIdentificationService({ pool });
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
            const result = await identification.identify(uploaded);
            await recordAudit({
                actorKind: 'user', actorRef: req.appAuth.userId, action: 'coin.identify',
                outcome: 'succeeded', requestId: req.appRequestId || null,
            });
            return res.json(result);
        } catch (error) {
            await recordAudit({
                actorKind: 'user', actorRef: req.appAuth?.userId, action: 'coin.identify',
                outcome: error.status === 401 || error.status === 403 ? 'denied' : 'failed',
                reasonCode: auditReasonCode(error), requestId: req.appRequestId || null,
            });
            if (error instanceof IdentificationError || error.status) {
                return res.status(error.status || 400).json(errorBody(error.code || 'recognition_failed', error.message));
            }
            return next(error);
        }
    });

    return { service: identification };
}

module.exports = { registerIdentificationRoutes };

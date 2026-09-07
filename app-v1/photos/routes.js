'use strict';

const { InputError, parseIfMatch, uuid } = require('../collection/validation');
const { CollectionPhotoService, PhotoError } = require('./service');
const { MinioPhotoStorage } = require('./storage');
const { normalizeComplete, normalizePhotoPatch, normalizeUploadIntent } = require('./validation');
const { auditReasonCode, safeAuditRecorder } = require('../security/service');

function errorBody(code, message, details = null) {
    return { error: { code, message, ...(details || {}) } };
}

function setVersion(res, value) {
    const version = value?.itemVersion;
    if (version != null && typeof res.set === 'function') res.set('ETag', `"${version}"`);
}

function registerPhotoRoutes(app, {
    pool,
    authenticate,
    requireCsrf,
    service = null,
    storage = null,
    processPhoto = null,
    uploadLimiter = (req, res, next) => next(),
    audit = null,
    analytics = null,
} = {}) {
    if (typeof authenticate !== 'function' || typeof requireCsrf !== 'function') {
        throw new TypeError('Auth middleware is required');
    }
    const photos = service || new CollectionPhotoService({
        pool,
        storage: storage || new MinioPhotoStorage(),
        processPhoto,
        analytics,
    });
    const recordAudit = safeAuditRecorder(audit);

    function handle(handler, auditAction = null) {
        return async (req, res, next) => {
            try {
                return await handler(req, res);
            } catch (error) {
                if (auditAction) {
                    await recordAudit({
                        actorKind: 'user', actorRef: req.appAuth?.userId, action: auditAction,
                        outcome: error.status === 403 || error.status === 404 ? 'denied' : 'failed',
                        reasonCode: auditReasonCode(error),
                        requestId: req.appRequestId || null,
                    });
                }
                if (error instanceof InputError || error instanceof PhotoError || error.status) {
                    return res.status(error.status || 400).json(errorBody(
                        error.code || 'invalid_input', error.message, error.details,
                    ));
                }
                return next(error);
            }
        };
    }

    app.get('/api/v1/collection/items/:id/photos', authenticate, handle(async (req, res) => {
        const result = await photos.list(req.appAuth.userId, uuid(req.params.id));
        return res.json({ photos: result });
    }));

    app.post('/api/v1/collection/items/:id/photos/upload-intent', authenticate, requireCsrf, uploadLimiter, handle(async (req, res) => {
        const result = await photos.createUploadIntent(
            req.appAuth.userId,
            uuid(req.params.id),
            normalizeUploadIntent(req.body),
            parseIfMatch(req.get('if-match')),
        );
        setVersion(res, result);
        await recordAudit({
            actorKind: 'user', actorRef: req.appAuth.userId, action: 'photo.upload_intent',
            outcome: 'succeeded', requestId: req.appRequestId || null,
        });
        return res.status(201).json(result);
    }, 'photo.upload_intent'));

    app.post('/api/v1/collection/items/:id/photos/complete', authenticate, requireCsrf, handle(async (req, res) => {
        const { photoId } = normalizeComplete(req.body);
        const result = await photos.complete(
            req.appAuth.userId,
            uuid(req.params.id),
            photoId,
            parseIfMatch(req.get('if-match')),
        );
        setVersion(res, result);
        await recordAudit({
            actorKind: 'user', actorRef: req.appAuth.userId, action: 'photo.upload_complete',
            outcome: 'succeeded', requestId: req.appRequestId || null,
        });
        return res.status(200).json({ photo: result });
    }, 'photo.upload_complete'));

    app.get('/api/v1/collection/photos/:id/url', authenticate, handle(async (req, res) => {
        return res.json(await photos.url(req.appAuth.userId, uuid(req.params.id)));
    }));

    app.patch('/api/v1/collection/photos/:id', authenticate, requireCsrf, handle(async (req, res) => {
        const result = await photos.patch(
            req.appAuth.userId,
            uuid(req.params.id),
            normalizePhotoPatch(req.body),
            parseIfMatch(req.get('if-match')),
        );
        setVersion(res, result);
        return res.json({ photo: result });
    }));

    app.delete('/api/v1/collection/photos/:id', authenticate, requireCsrf, handle(async (req, res) => {
        const result = await photos.remove(
            req.appAuth.userId,
            uuid(req.params.id),
            parseIfMatch(req.get('if-match')),
        );
        setVersion(res, result);
        return res.status(204).end();
    }));

    return { service: photos };
}

module.exports = { registerPhotoRoutes };

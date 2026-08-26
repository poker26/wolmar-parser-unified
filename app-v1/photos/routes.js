'use strict';

const { InputError, uuid } = require('../collection/validation');
const { CollectionPhotoService, PhotoError } = require('./service');
const { MinioPhotoStorage } = require('./storage');
const { normalizeComplete, normalizePhotoPatch, normalizeUploadIntent } = require('./validation');
const { auditReasonCode, safeAuditRecorder } = require('../security/service');

function errorBody(code, message) {
    return { error: { code, message } };
}

function registerPhotoRoutes(app, {
    pool,
    authenticate,
    requireCsrf,
    service = null,
    storage = null,
    enqueueProcessing = async () => {},
    uploadLimiter = (req, res, next) => next(),
    audit = null,
} = {}) {
    if (typeof authenticate !== 'function' || typeof requireCsrf !== 'function') {
        throw new TypeError('Auth middleware is required');
    }
    const photos = service || new CollectionPhotoService({
        pool,
        storage: storage || new MinioPhotoStorage(),
        enqueueProcessing,
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
                    return res.status(error.status || 400).json(errorBody(error.code || 'invalid_input', error.message));
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
        );
        await recordAudit({
            actorKind: 'user', actorRef: req.appAuth.userId, action: 'photo.upload_intent',
            outcome: 'succeeded', requestId: req.appRequestId || null,
        });
        return res.status(201).json(result);
    }, 'photo.upload_intent'));

    app.post('/api/v1/collection/items/:id/photos/complete', authenticate, requireCsrf, handle(async (req, res) => {
        const { photoId } = normalizeComplete(req.body);
        const result = await photos.complete(req.appAuth.userId, uuid(req.params.id), photoId);
        await recordAudit({
            actorKind: 'user', actorRef: req.appAuth.userId, action: 'photo.upload_complete',
            outcome: 'succeeded', requestId: req.appRequestId || null,
        });
        return res.status(202).json({ photo: result });
    }, 'photo.upload_complete'));

    app.get('/api/v1/collection/photos/:id/url', authenticate, handle(async (req, res) => {
        return res.json(await photos.url(req.appAuth.userId, uuid(req.params.id)));
    }));

    app.patch('/api/v1/collection/photos/:id', authenticate, requireCsrf, handle(async (req, res) => {
        const result = await photos.patch(
            req.appAuth.userId,
            uuid(req.params.id),
            normalizePhotoPatch(req.body),
        );
        return res.json({ photo: result });
    }));

    app.delete('/api/v1/collection/photos/:id', authenticate, requireCsrf, handle(async (req, res) => {
        await photos.remove(req.appAuth.userId, uuid(req.params.id));
        return res.status(204).end();
    }));

    return { service: photos };
}

module.exports = { registerPhotoRoutes };

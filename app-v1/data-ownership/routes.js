'use strict';

const { ReauthenticationError } = require('../auth/session-service');
const { uuid } = require('../collection/validation');
const { MinioPhotoStorage } = require('../photos/storage');
const { DataOwnershipError, DataOwnershipService } = require('./service');
const { auditReasonCode, safeAuditRecorder } = require('../security/service');

function errorBody(code, message) {
    return { error: { code, message } };
}

function createUserRateLimiter({ limit, windowMs, now = () => Date.now() }) {
    const attempts = new Map();
    return (req, res, next) => {
        const cutoff = now() - windowMs;
        const recent = (attempts.get(req.appAuth.userId) || []).filter((value) => value > cutoff);
        if (recent.length >= limit) return res.status(429).json(errorBody('rate_limited', 'Too many requests'));
        recent.push(now());
        attempts.set(req.appAuth.userId, recent);
        return next();
    };
}

function registerDataOwnershipRoutes(app, {
    pool,
    authenticate,
    requireCsrf,
    authService,
    clearAuthCookies = () => {},
    storage = new MinioPhotoStorage(),
    enqueueExport = async () => {},
    enqueueDeletion = async () => {},
    service = null,
    exportLimiter = createUserRateLimiter({ limit: 3, windowMs: 60 * 60 * 1000 }),
    deletionLimiter = createUserRateLimiter({ limit: 3, windowMs: 24 * 60 * 60 * 1000 }),
    audit = null,
} = {}) {
    if (typeof authenticate !== 'function' || typeof requireCsrf !== 'function') {
        throw new TypeError('Auth middleware is required');
    }
    const ownership = service || new DataOwnershipService({
        pool, storage, authService, enqueueExport, enqueueDeletion,
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
                        outcome: error instanceof ReauthenticationError || error.status === 403 || error.status === 404
                            ? 'denied'
                            : 'failed',
                        reasonCode: auditReasonCode(error),
                        requestId: req.appRequestId || null,
                    });
                }
                if (error instanceof DataOwnershipError || error instanceof ReauthenticationError || error.status) {
                    return res.status(error.status || 400).json(errorBody(error.code || 'invalid_input', error.message));
                }
                return next(error);
            }
        };
    }

    app.post('/api/v1/collection/exports', authenticate, requireCsrf, exportLimiter, handle(async (req, res) => {
        const result = await ownership.requestExport(req.appAuth.userId, req.body?.password);
        await recordAudit({
            actorKind: 'user', actorRef: req.appAuth.userId, action: 'collection.export',
            outcome: 'succeeded', requestId: req.appRequestId || null,
        });
        return res.status(202).json(result);
    }, 'collection.export'));

    app.get('/api/v1/collection/exports/:id', authenticate, handle(async (req, res) => {
        return res.json(await ownership.getExport(req.appAuth.userId, uuid(req.params.id, 'exportId')));
    }));

    app.post('/api/v1/account/deletion', authenticate, requireCsrf, deletionLimiter, handle(async (req, res) => {
        const result = await ownership.requestAccountDeletion(req.appAuth.userId, req.body?.password);
        await recordAudit({
            actorKind: 'user', actorRef: req.appAuth.userId, action: 'account.deletion',
            outcome: 'succeeded', requestId: req.appRequestId || null,
        });
        clearAuthCookies(res);
        return res.status(202).json(result);
    }, 'account.deletion'));

    return { service: ownership };
}

module.exports = { createUserRateLimiter, registerDataOwnershipRoutes };

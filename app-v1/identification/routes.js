'use strict';

const express = require('express');
const { CoinIdentificationService, IdentificationError, MAX_IDENTIFY_BYTES } = require('./service');
const { auditReasonCode, safeAuditRecorder } = require('../security/service');

function errorBody(code, message) {
    return { error: { code, message } };
}

function registerIdentificationRoutes(app, {
    authenticate,
    requireCsrf,
    limiter = (req, res, next) => next(),
    service = null,
    audit = null,
} = {}) {
    if (typeof authenticate !== 'function' || typeof requireCsrf !== 'function') {
        throw new TypeError('Auth middleware is required');
    }
    const identification = service || new CoinIdentificationService();
    const recordAudit = safeAuditRecorder(audit);
    const imageBody = express.raw({ type: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'], limit: MAX_IDENTIFY_BYTES });

    app.post('/api/v1/collection/identify', authenticate, requireCsrf, limiter, imageBody, async (req, res, next) => {
        try {
            const result = await identification.identify(req.body, req.get('content-type'));
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

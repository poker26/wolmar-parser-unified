'use strict';

const crypto = require('node:crypto');

const AUDIT_ACTIONS = new Set([
    'auth.login',
    'auth.register',
    'auth.logout',
    'auth.logout_all',
    'security.csrf',
    'photo.upload_intent',
    'photo.upload_complete',
    'coin.identify',
    'valuation.recalculate',
    'collection.export',
    'account.deletion',
]);
const AUDIT_OUTCOMES = new Set(['succeeded', 'denied', 'failed', 'rate_limited']);
const ACTOR_KINDS = new Set(['user', 'login', 'anonymous']);
const REASON_CODE = /^[a-z][a-z0-9_]{1,63}$/;

function hashSecuritySubject(kind, value) {
    return crypto.createHash('sha256')
        .update(`security-${kind}-v1:${String(value || 'anonymous')}`, 'utf8')
        .digest('hex');
}

function validateAuditEvent({ actorKind = 'anonymous', action, outcome, reasonCode = null }) {
    if (!ACTOR_KINDS.has(actorKind)) throw new TypeError(`Unsupported actor kind: ${actorKind}`);
    if (!AUDIT_ACTIONS.has(action)) throw new TypeError(`Unsupported audit action: ${action}`);
    if (!AUDIT_OUTCOMES.has(outcome)) throw new TypeError(`Unsupported audit outcome: ${outcome}`);
    if (reasonCode != null && !REASON_CODE.test(reasonCode)) {
        throw new TypeError('Invalid audit reason code');
    }
}

function auditReasonCode(error, fallback = 'operation_failed') {
    const candidate = String(error?.code || '').toLowerCase();
    return REASON_CODE.test(candidate) ? candidate : fallback;
}

class SecurityAudit {
    constructor({ pool, now = () => new Date(), cleanupIntervalMs = 24 * 60 * 60 * 1000 }) {
        if (!pool || typeof pool.query !== 'function') throw new TypeError('A pg-compatible pool is required');
        this.pool = pool;
        this.now = now;
        this.cleanupIntervalMs = cleanupIntervalMs;
        this.nextCleanupAt = 0;
    }

    async record({
        actorKind = 'anonymous', actorRef = null, action, outcome,
        reasonCode = null, requestId = null, occurredAt = this.now(),
    }) {
        validateAuditEvent({ actorKind, action, outcome, reasonCode });
        const result = await this.pool.query(
            `INSERT INTO security_audit_event (
                id, actor_pseudonym, actor_kind, action, outcome,
                reason_code, request_id, occurred_at
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
             RETURNING id`,
            [
                crypto.randomUUID(), hashSecuritySubject(actorKind, actorRef), actorKind,
                action, outcome, reasonCode, requestId, occurredAt,
            ],
        );
        const timestamp = this.now().getTime();
        if (timestamp >= this.nextCleanupAt) {
            this.nextCleanupAt = timestamp + this.cleanupIntervalMs;
            await this.pool.query(`DELETE FROM security_audit_event WHERE expires_at < now()`);
        }
        return { recorded: Boolean(result.rows[0]) };
    }
}

function safeAuditRecorder(audit, logger = console) {
    if (!audit || typeof audit.record !== 'function') return async () => ({ recorded: false });
    return async (event) => {
        try {
            return await audit.record(event);
        } catch (error) {
            logger.error(`[security-audit] ${event.action} failed: ${error.message}`);
            return { recorded: false };
        }
    };
}

class DatabaseRateLimiter {
    constructor({ pool, audit = null, now = () => Date.now(), cleanupIntervalMs = 60 * 60 * 1000 }) {
        if (!pool || typeof pool.query !== 'function') throw new TypeError('A pg-compatible pool is required');
        this.pool = pool;
        this.recordAudit = safeAuditRecorder(audit);
        this.now = now;
        this.cleanupIntervalMs = cleanupIntervalMs;
        this.nextCleanupAt = 0;
    }

    async consume({
        action, key, limit, windowMs, actorKind = 'anonymous', actorRef = null, requestId = null,
    }) {
        if (!AUDIT_ACTIONS.has(action)) throw new TypeError(`Unsupported rate-limit action: ${action}`);
        if (typeof key !== 'string' || !key) throw new TypeError('Rate-limit key is required');
        if (!Number.isSafeInteger(limit) || limit < 1) throw new TypeError('Rate-limit limit must be positive');
        if (!Number.isSafeInteger(windowMs) || windowMs < 1000) throw new TypeError('Rate-limit window is too short');

        const timestamp = this.now();
        const windowStartedAt = new Date(Math.floor(timestamp / windowMs) * windowMs);
        const expiresAt = new Date(windowStartedAt.getTime() + windowMs);
        const keyHash = hashSecuritySubject(`rate-${action}`, key);
        const result = await this.pool.query(
            `INSERT INTO security_rate_limit (
                action, key_hash, window_started_at, request_count, expires_at
             ) VALUES ($1,$2,$3,1,$4)
             ON CONFLICT (action, key_hash, window_started_at)
             DO UPDATE SET request_count = security_rate_limit.request_count + 1
             RETURNING request_count, expires_at`,
            [action, keyHash, windowStartedAt, expiresAt],
        );
        if (timestamp >= this.nextCleanupAt) {
            this.nextCleanupAt = timestamp + this.cleanupIntervalMs;
            await this.pool.query(`DELETE FROM security_rate_limit WHERE expires_at < now()`);
        }
        const row = result.rows[0];
        const allowed = Number(row.request_count) <= limit;
        if (!allowed) {
            await this.recordAudit({
                actorKind, actorRef, action, outcome: 'rate_limited',
                reasonCode: 'rate_limited', requestId,
            });
        }
        return {
            allowed,
            remaining: Math.max(0, limit - Number(row.request_count)),
            retryAfterSeconds: Math.max(1, Math.ceil((new Date(row.expires_at).getTime() - timestamp) / 1000)),
        };
    }

    async reset({ action, key }) {
        await this.pool.query(
            `DELETE FROM security_rate_limit WHERE action = $1 AND key_hash = $2`,
            [action, hashSecuritySubject(`rate-${action}`, key)],
        );
    }
}

function createRateLimitMiddleware({
    limiter, action, limit, windowMs, keyFor, clearOnSuccess = false,
}) {
    if (!limiter || typeof limiter.consume !== 'function') throw new TypeError('Database rate limiter is required');
    if (typeof keyFor !== 'function') throw new TypeError('Rate-limit key function is required');
    return async (req, res, next) => {
        try {
            const subject = keyFor(req) || {};
            const result = await limiter.consume({
                action,
                key: subject.key,
                limit,
                windowMs,
                actorKind: subject.actorKind,
                actorRef: subject.actorRef,
                requestId: req.appRequestId || null,
            });
            res.set('X-RateLimit-Remaining', String(result.remaining));
            if (!result.allowed) {
                res.set('Retry-After', String(result.retryAfterSeconds));
                return res.status(429).json({
                    error: { code: 'rate_limited', message: 'Too many requests' },
                });
            }
            if (clearOnSuccess) {
                req.clearLoginRateLimit = () => limiter.reset({ action, key: subject.key });
            }
            return next();
        } catch (error) {
            return next(error);
        }
    };
}

module.exports = {
    ACTOR_KINDS,
    AUDIT_ACTIONS,
    AUDIT_OUTCOMES,
    DatabaseRateLimiter,
    SecurityAudit,
    createRateLimitMiddleware,
    auditReasonCode,
    hashSecuritySubject,
    safeAuditRecorder,
    validateAuditEvent,
};

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
    DatabaseRateLimiter,
    SecurityAudit,
    createRateLimitMiddleware,
    auditReasonCode,
    hashSecuritySubject,
    safeAuditRecorder,
    validateAuditEvent,
} = require('../app-v1/security/service');
const { report, safeWindowHours } = require('../scripts/report-security-audit');

const USER_ID = '00000000-0000-4000-8000-000000000001';

class FakePool {
    constructor(handler) { this.handler = handler; this.queries = []; }
    async query(sql, params = []) {
        this.queries.push({ sql, params });
        return this.handler(sql, params, this.queries.length);
    }
}

function response() {
    return {
        headers: {}, statusCode: 200, body: null,
        set(name, value) { this.headers[name] = value; return this; },
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; },
    };
}

test('security audit persists only a purpose-specific actor pseudonym', async () => {
    const pool = new FakePool((sql) => ({ rows: sql.includes('INSERT') ? [{ id: 'event' }] : [] }));
    const audit = new SecurityAudit({ pool, now: () => new Date('2026-08-26T12:00:00Z') });
    await audit.record({
        actorKind: 'user', actorRef: USER_ID, action: 'collection.export',
        outcome: 'succeeded', requestId: '10000000-0000-4000-8000-000000000001',
    });
    const params = pool.queries[0].params;
    assert.equal(params[1], hashSecuritySubject('user', USER_ID));
    assert.equal(params.join(' ').includes(USER_ID), false);
    assert.equal(params[3], 'collection.export');
    assert.equal(params[4], 'succeeded');
});

test('security audit rejects uncontrolled actions and reason text', () => {
    assert.throws(
        () => validateAuditEvent({ action: 'request.body', outcome: 'succeeded' }),
        /Unsupported audit action/,
    );
    assert.equal(auditReasonCode({ code: 'PHOTO_NOT_FOUND' }), 'photo_not_found');
    assert.equal(auditReasonCode({ code: '23505' }), 'operation_failed');
    assert.throws(
        () => validateAuditEvent({ action: 'auth.login', outcome: 'denied', reasonCode: 'email=user@example.test' }),
        /Invalid audit reason/,
    );
});

test('database limiter blocks above the fixed-window limit and audits the block', async () => {
    let count = 0;
    const audited = [];
    const pool = new FakePool((sql, params) => {
        if (sql.includes('INSERT INTO security_rate_limit')) {
            count += 1;
            return { rows: [{ request_count: count, expires_at: params[3] }] };
        }
        return { rows: [] };
    });
    const limiter = new DatabaseRateLimiter({
        pool,
        audit: { record: async (event) => audited.push(event) },
        now: () => Date.parse('2026-08-26T12:00:00Z'),
    });
    assert.equal((await limiter.consume({
        action: 'valuation.recalculate', key: USER_ID, limit: 1, windowMs: 60000,
        actorKind: 'user', actorRef: USER_ID,
    })).allowed, true);
    const blocked = await limiter.consume({
        action: 'valuation.recalculate', key: USER_ID, limit: 1, windowMs: 60000,
        actorKind: 'user', actorRef: USER_ID,
    });
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.retryAfterSeconds, 60);
    assert.equal(audited[0].outcome, 'rate_limited');
    const insert = pool.queries.find(({ sql }) => sql.includes('INSERT INTO security_rate_limit'));
    assert.equal(insert.params.join(' ').includes(USER_ID), false);
});

test('rate-limit middleware returns standard 429 and can attach a success reset', async () => {
    let reset = null;
    const limiter = {
        consume: async () => ({ allowed: true, remaining: 2, retryAfterSeconds: 30 }),
        reset: async (input) => { reset = input; },
    };
    const middleware = createRateLimitMiddleware({
        limiter, action: 'auth.login', limit: 3, windowMs: 60000,
        clearOnSuccess: true,
        keyFor: () => ({ key: 'owner@example.test', actorKind: 'login', actorRef: 'owner@example.test' }),
    });
    const req = {};
    const res = response();
    let nextCalled = false;
    await middleware(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    assert.equal(res.headers['X-RateLimit-Remaining'], '2');
    await req.clearLoginRateLimit();
    assert.deepEqual(reset, { action: 'auth.login', key: 'owner@example.test' });

    const blockedMiddleware = createRateLimitMiddleware({
        limiter: { consume: async () => ({ allowed: false, remaining: 0, retryAfterSeconds: 30 }) },
        action: 'photo.upload_intent', limit: 1, windowMs: 60000,
        keyFor: () => ({ key: USER_ID }),
    });
    const blockedRes = response();
    await blockedMiddleware({}, blockedRes, () => {});
    assert.equal(blockedRes.statusCode, 429);
    assert.equal(blockedRes.headers['Retry-After'], '30');
    assert.equal(blockedRes.body.error.code, 'rate_limited');
});

test('safe audit failure never breaks the protected operation', async () => {
    const messages = [];
    const record = safeAuditRecorder(
        { record: async () => { throw new Error('audit unavailable'); } },
        { error: (message) => messages.push(message) },
    );
    assert.deepEqual(await record({ action: 'auth.login' }), { recorded: false });
    assert.match(messages[0], /auth\.login failed/);
});

test('security report contains aggregates only', async () => {
    const results = [
        { rows: [{ action: 'auth.login', outcome: 'denied', reason_code: 'invalid_credentials', events: 2 }] },
        { rows: [{ action: 'auth.login', active_buckets: 1, requests: 3, peak_bucket: 3 }] },
    ];
    const output = await report({ query: async () => results.shift() }, 24);
    assert.equal(output.audit[0].events, 2);
    assert.equal(output.activeRateLimits[0].requests, 3);
    assert.equal(JSON.stringify(output).includes(USER_ID), false);
    assert.equal(safeWindowHours('24'), 24);
    assert.throws(() => safeWindowHours('721'), /1 to 720/);
});

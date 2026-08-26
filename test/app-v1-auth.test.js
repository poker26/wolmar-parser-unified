'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
    InvalidCredentialsError,
    SessionService,
    hashToken,
    normalizeEmail,
    safeHashEqual,
} = require('../app-v1/auth/session-service');
const {
    cookieConfig,
    createIdentifierLimiter,
    parseCookies,
    registerAuthRoutes,
} = require('../app-v1/auth/routes');

class FakePool {
    constructor(handler) {
        this.handler = handler;
        this.queries = [];
    }

    async query(sql, params = []) {
        this.queries.push({ sql, params });
        return this.handler(sql, params, this.queries.length);
    }
}

function createResponse() {
    return {
        statusCode: 200,
        cookies: [],
        cleared: [],
        headers: {},
        body: undefined,
        ended: false,
        status(code) { this.statusCode = code; return this; },
        cookie(name, value, options) { this.cookies.push({ name, value, options }); return this; },
        clearCookie(name, options) { this.cleared.push({ name, options }); return this; },
        set(name, value) { this.headers[name] = value; return this; },
        json(value) { this.body = value; return this; },
        end() { this.ended = true; return this; },
    };
}

function createFakeApp() {
    const routes = [];
    return {
        routes,
        get(routePath, ...handlers) { routes.push({ method: 'GET', path: routePath, handlers }); },
        post(routePath, ...handlers) { routes.push({ method: 'POST', path: routePath, handlers }); },
    };
}

test('email normalization is deterministic and rejects malformed input', () => {
    assert.equal(normalizeEmail('  OWNER@Example.TEST  '), 'owner@example.test');
    assert.throws(() => normalizeEmail('not-an-email'), InvalidCredentialsError);
    assert.throws(() => normalizeEmail('owner @example.test'), InvalidCredentialsError);
});

test('login stores only token hashes and returns an opaque session', async () => {
    const account = {
        id: '00000000-0000-4000-8000-000000000001',
        email_normalized: 'owner@example.test',
        password_hash: 'stored-password-hash',
        display_name: 'Owner',
        status: 'active',
    };
    const pool = new FakePool((sql) => {
        if (sql.includes('FROM app_user')) return { rows: [account] };
        if (sql.includes('INSERT INTO user_session')) return { rows: [], rowCount: 1 };
        throw new Error(`unexpected SQL: ${sql}`);
    });
    const verified = [];
    const service = new SessionService({
        pool,
        passwordHasher: {
            hash: async () => 'unused',
            verify: async (password, digest) => {
                verified.push({ password, digest });
                return true;
            },
        },
    });

    const result = await service.login({ email: 'OWNER@example.test', password: 'correct horse' });
    assert.deepEqual(result.user, {
        id: account.id,
        email: account.email_normalized,
        displayName: account.display_name,
    });
    assert.equal(verified[0].digest, account.password_hash);
    assert.match(result.session.token, /^[A-Za-z0-9_-]{40,}$/);
    assert.match(result.session.csrfToken, /^[A-Za-z0-9_-]{40,}$/);

    const insert = pool.queries.find(({ sql }) => sql.includes('INSERT INTO user_session'));
    assert.equal(insert.params[2], hashToken(result.session.token));
    assert.equal(insert.params[3], hashToken(result.session.csrfToken));
    assert.notEqual(insert.params[2], result.session.token);
    assert.notEqual(insert.params[3], result.session.csrfToken);
});

test('unknown and blocked accounts return the same authentication error', async () => {
    const passwordHasher = {
        hash: async () => 'unused',
        verify: async () => false,
    };
    const missing = new SessionService({
        pool: new FakePool(() => ({ rows: [] })),
        passwordHasher,
    });
    await assert.rejects(
        missing.login({ email: 'missing@example.test', password: 'long-enough-password' }),
        (error) => error.code === 'invalid_credentials',
    );

    const blocked = new SessionService({
        pool: new FakePool(() => ({ rows: [{
            id: '1',
            email_normalized: 'blocked@example.test',
            password_hash: 'hash',
            status: 'blocked',
        }] })),
        passwordHasher: { ...passwordHasher, verify: async () => true },
    });
    await assert.rejects(
        blocked.login({ email: 'blocked@example.test', password: 'long-enough-password' }),
        (error) => error.code === 'invalid_credentials',
    );
});

test('authenticate validates an opaque token and CSRF hash', async () => {
    const csrfToken = 'c'.repeat(43);
    const pool = new FakePool((sql) => {
        if (sql.includes('FROM user_session s')) return { rows: [{
            session_id: 'session-1',
            user_id: 'user-1',
            csrf_token_hash: hashToken(csrfToken),
            email_normalized: 'owner@example.test',
            display_name: null,
        }] };
        if (sql.includes('UPDATE user_session SET last_seen_at')) return { rows: [], rowCount: 1 };
        throw new Error(`unexpected SQL: ${sql}`);
    });
    const service = new SessionService({
        pool,
        passwordHasher: { hash: async () => '', verify: async () => false },
    });

    const auth = await service.authenticate('s'.repeat(43));
    assert.equal(auth.userId, 'user-1');
    assert.equal(service.verifyCsrf(auth, csrfToken), true);
    assert.equal(service.verifyCsrf(auth, 'x'.repeat(43)), false);
    assert.equal(pool.queries[0].params[0], hashToken('s'.repeat(43)));
});

test('hash comparison rejects malformed values', () => {
    const digest = hashToken('value');
    assert.equal(safeHashEqual(digest, digest), true);
    assert.equal(safeHashEqual('', ''), false);
    assert.equal(safeHashEqual('not-hex', 'not-hex'), false);
});

test('production cookie configuration uses secure host-only names', () => {
    const cookies = cookieConfig({ NODE_ENV: 'production' });
    assert.equal(cookies.sessionName, '__Host-wolmar_session');
    assert.equal(cookies.csrfName, '__Host-wolmar_csrf');
    assert.equal(cookies.session.httpOnly, true);
    assert.equal(cookies.session.secure, true);
    assert.equal(cookies.session.path, '/');
    assert.equal(cookies.csrf.httpOnly, false);
    assert.equal(cookies.csrf.sameSite, 'strict');
});

test('cookie parser handles encoded values and ignores malformed cookies', () => {
    assert.deepEqual(parseCookies('a=one%20two; broken; b=three'), { a: 'one two', b: 'three' });
});

test('login route sets cookies but never returns session secrets in JSON', async () => {
    const app = createFakeApp();
    const user = { id: 'user-1', email: 'owner@example.test', displayName: null };
    const service = {
        sessionTtlMs: 60000,
        login: async () => ({
            user,
            session: {
                id: 'session-1',
                token: 'session-secret',
                csrfToken: 'csrf-secret',
                expiresAt: new Date(),
            },
        }),
        authenticate: async () => null,
        verifyCsrf: () => false,
    };
    registerAuthRoutes(app, {
        service,
        env: { NODE_ENV: 'production' },
        loginLimiter: (req, res, next) => next(),
    });
    const route = app.routes.find(({ method, path: routePath }) => (
        method === 'POST' && routePath === '/api/v1/auth/login'
    ));
    const req = { body: { email: 'owner@example.test', password: 'long-enough' } };
    const res = createResponse();
    let nextError = null;
    await route.handlers.at(-1)(req, res, (error) => { nextError = error; });

    assert.equal(nextError, null);
    assert.equal(res.cookies.length, 2);
    assert.equal(res.cookies[0].name, '__Host-wolmar_session');
    assert.equal(res.cookies[0].options.httpOnly, true);
    assert.equal(res.cookies[1].name, '__Host-wolmar_csrf');
    assert.deepEqual(res.body, { user });
    assert.equal(JSON.stringify(res.body).includes('session-secret'), false);
    assert.equal(JSON.stringify(res.body).includes('csrf-secret'), false);
});

test('logout requires matching CSRF cookie and header', async () => {
    const app = createFakeApp();
    const csrfToken = 'c'.repeat(43);
    let logoutCalls = 0;
    const service = {
        sessionTtlMs: 60000,
        authenticate: async () => ({
            sessionId: 'session-1',
            userId: 'user-1',
            csrfTokenHash: hashToken(csrfToken),
            user: { id: 'user-1', email: 'owner@example.test', displayName: null },
        }),
        verifyCsrf: (auth, token) => safeHashEqual(hashToken(token), auth.csrfTokenHash),
        logout: async () => { logoutCalls += 1; },
        logoutAll: async () => 1,
    };
    registerAuthRoutes(app, { service, env: { NODE_ENV: 'production' } });
    const route = app.routes.find(({ method, path: routePath }) => (
        method === 'POST' && routePath === '/api/v1/auth/logout'
    ));

    const rejectedReq = {
        headers: { cookie: `__Host-wolmar_session=${'s'.repeat(43)}; __Host-wolmar_csrf=${csrfToken}` },
        get: () => 'wrong-token'.repeat(4),
    };
    const rejectedRes = createResponse();
    await route.handlers[0](rejectedReq, rejectedRes, () => {});
    route.handlers[1](rejectedReq, rejectedRes, () => {});
    assert.equal(rejectedRes.statusCode, 403);
    assert.equal(logoutCalls, 0);

    const acceptedReq = {
        headers: { cookie: `__Host-wolmar_session=${'s'.repeat(43)}; __Host-wolmar_csrf=${csrfToken}` },
        get: () => csrfToken,
    };
    const acceptedRes = createResponse();
    await route.handlers[0](acceptedReq, acceptedRes, () => {});
    route.handlers[1](acceptedReq, acceptedRes, () => {});
    await route.handlers[2](acceptedReq, acceptedRes, () => {});
    assert.equal(acceptedRes.statusCode, 204);
    assert.equal(acceptedRes.cleared.length, 2);
    assert.equal(logoutCalls, 1);
});

test('identifier limiter blocks repeated failures and can reset after success', () => {
    let timestamp = 1000;
    const limiter = createIdentifierLimiter({ max: 2, windowMs: 10000, now: () => timestamp });
    const next = () => {};
    const first = { body: { email: 'owner@example.test' } };
    limiter(first, createResponse(), next);
    assert.equal(typeof first.clearLoginRateLimit, 'function');
    first.clearLoginRateLimit();

    limiter({ body: { email: 'owner@example.test' } }, createResponse(), next);
    limiter({ body: { email: 'owner@example.test' } }, createResponse(), next);
    const blockedResponse = createResponse();
    limiter({ body: { email: 'owner@example.test' } }, blockedResponse, next);
    assert.equal(blockedResponse.statusCode, 429);
    assert.equal(blockedResponse.body.error.code, 'rate_limited');

    timestamp += 10001;
    const afterWindow = createResponse();
    limiter({ body: { email: 'owner@example.test' } }, afterWindow, next);
    assert.equal(afterWindow.statusCode, 200);
});

test('v1 auth routes are registered before the SPA fallback', () => {
    const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const authIndex = serverSource.indexOf("require('./app-v1/auth/routes').registerAuthRoutes");
    const fallbackIndex = serverSource.lastIndexOf("app.get('*'");
    assert.ok(authIndex > 0);
    assert.ok(authIndex < fallbackIndex);
});

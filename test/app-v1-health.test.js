'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { checkDatabase, registerHealthRoutes } = require('../app-v1/health/routes');

function fakeApp() {
    return {
        routes: new Map(),
        get(path, handler) { this.routes.set(path, handler); },
    };
}

function fakeResponse() {
    return {
        headers: {}, statusCode: 200, body: null,
        set(name, value) { this.headers[name] = value; return this; },
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; },
    };
}

test('liveness is process-local and keeps the legacy endpoint compatible', () => {
    const app = fakeApp();
    registerHealthRoutes(app, {
        pool: { query: async () => { throw new Error('must not query'); } },
        now: () => new Date('2026-08-26T12:00:00Z'),
    });
    const legacy = fakeResponse();
    app.routes.get('/api/health')({}, legacy);
    assert.equal(legacy.statusCode, 200);
    assert.deepEqual(legacy.body, {
        status: 'ok', check: 'liveness', timestamp: '2026-08-26T12:00:00.000Z',
    });
    assert.equal(legacy.headers['Cache-Control'], 'no-store');
    assert.equal(app.routes.has('/api/health/live'), true);
});

test('readiness reports database availability without exposing an error', async () => {
    const app = fakeApp();
    const warnings = [];
    registerHealthRoutes(app, {
        pool: { query: async () => ({ rows: [{ ready: 1 }] }) },
        now: () => new Date('2026-08-26T12:00:00Z'),
        logger: { warn: (message) => warnings.push(message) },
    });
    const ready = fakeResponse();
    await app.routes.get('/api/health/ready')({}, ready);
    assert.equal(ready.statusCode, 200);
    assert.equal(ready.body.checks.database, 'up');

    const unavailable = fakeResponse();
    registerHealthRoutes(app, {
        pool: { query: async () => {} },
        databaseCheck: async () => { throw new Error('secret connection details'); },
        logger: { warn: (message) => warnings.push(message) },
    });
    await app.routes.get('/api/health/ready')({}, unavailable);
    assert.equal(unavailable.statusCode, 503);
    assert.deepEqual(unavailable.body.checks, { database: 'down' });
    assert.equal(JSON.stringify(unavailable.body).includes('secret'), false);
    assert.deepEqual(warnings, ['[readiness] database unavailable']);
});

test('database readiness query has a bounded timeout', async () => {
    await assert.rejects(
        checkDatabase({ query: async () => new Promise(() => {}) }, 10),
        /timed out/,
    );
});

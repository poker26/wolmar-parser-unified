'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

test('all API routes are registered before the SPA fallback', () => {
    const fallbackIndex = serverSource.lastIndexOf("app.get('*'");
    const apiRouteIndexes = Array.from(
        serverSource.matchAll(/app\.(?:get|post|put|delete|patch)\(['"]\/api\//g),
        (match) => match.index,
    );

    assert.notEqual(fallbackIndex, -1, 'SPA fallback is missing');
    assert.ok(apiRouteIndexes.length > 0, 'no API routes found');
    assert.ok(
        fallbackIndex > Math.max(...apiRouteIndexes),
        'SPA fallback must be registered after every API route',
    );
});

test('error middleware and listen are registered after the SPA fallback', () => {
    const fallbackIndex = serverSource.lastIndexOf("app.get('*'");
    const errorMiddlewareIndex = serverSource.lastIndexOf('app.use((error, req, res, next)');
    const listenIndex = serverSource.lastIndexOf('app.listen(');

    assert.ok(errorMiddlewareIndex > fallbackIndex, 'error middleware must follow the fallback');
    assert.ok(listenIndex > errorMiddlewareIndex, 'server must start after route registration');
});

test('PM2 log endpoint does not interpolate request input into a shell command', () => {
    assert.doesNotMatch(serverSource, /exec\(`pm2 logs[^`]*\$\{/);
    assert.match(serverSource, /execFile\('pm2', \['logs', 'wolmar-parser'/);
});

test('authorization headers are not written to application logs', () => {
    assert.doesNotMatch(serverSource, /console\.log\([^\n]*Authorization header/);
});

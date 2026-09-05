'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { fetchText } = require('../catalog/shop-source-ingester');

function response(status, body = '') {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: () => 'text/html; charset=utf-8' },
        body: { cancel: async () => {} },
        text: async () => body,
    };
}

test('shared shop fetch retries transient server failures', async () => {
    const statuses = [500, 502, 200];
    const waits = [];
    const body = await fetchText('https://example.test/coin', async () => response(statuses.shift(), 'coin'), {
        sleep: async (delay) => waits.push(delay),
    });
    assert.equal(body, 'coin');
    assert.deepEqual(waits, [500, 1500]);
    assert.equal(statuses.length, 0);
});

test('shared shop fetch retries network errors but not a missing card', async () => {
    let calls = 0;
    const body = await fetchText('https://example.test/coin', async () => {
        calls += 1;
        if (calls === 1) throw new TypeError('fetch failed');
        return response(200, 'ok');
    }, { sleep: async () => {} });
    assert.equal(body, 'ok');
    assert.equal(calls, 2);

    calls = 0;
    await assert.rejects(() => fetchText('https://example.test/missing', async () => {
        calls += 1;
        return response(404);
    }, { sleep: async () => {} }), /HTTP 404/);
    assert.equal(calls, 1);
});

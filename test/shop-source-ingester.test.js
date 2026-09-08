'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createShopIngester, fetchText } = require('../catalog/shop-source-ingester');

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

test('a rejected source match removes only its automatic link and stages a qualified candidate', async () => {
    const product = {
        sourceKey: 'mint.example', sourceItemKey: 'coin-2025', sourceUrl: 'https://mint.example/coin-2025',
        itemStatus: 'archive', title: '10 рублей 2025 Космос', matchTitle: '10 рублей 2025 Космос',
        country: 'RU', denomination: '10 рублей', year: 2025, metal: null, weightG: null,
        diameterMm: null, mintage: null, condition: null, themes: [], aversImageUrl: '/a.jpg',
        reversImageUrl: '/b.jpg', attributes: {},
    };
    const queries = [];
    const db = { query: async (sql, params) => {
        queries.push({ sql, params });
        if (/SELECT ru,en FROM numis_country_map/.test(sql)) {
            return { rows: [{ ru: 'Россия', en: 'Russia' }] };
        }
        if (/SELECT country, ru FROM numis_country_ru/.test(sql)) {
            return { rows: [{ country: 'Russia', ru: 'Россия' }] };
        }
        if (/SELECT country, count\(\*\)::int c FROM coin_type/.test(sql)) {
            return { rows: [{ country: 'Россия', c: 1 }] };
        }
        if (/RETURNING id,\(xmax=0\)/.test(sql)) return { rows: [{ id: 41, inserted: false }] };
        if (/FROM catalog_source_item_type_link/.test(sql)) {
            return { rows: [{ type_id: 52, match_method: 'mint-primary' }] };
        }
        if (/DELETE FROM catalog_source_item_type_link/.test(sql)) return { rows: [] };
        if (/WITH candidate AS/.test(sql)) return { rows: [{ candidate_id: 63, observation_added: true }] };
        if (/UPDATE catalog_source_item/.test(sql)) return { rows: [] };
        throw new Error(`unexpected query: ${sql}`);
    } };
    const ingester = createShopIngester({
        sourceKey: 'mint.example', matchMethod: 'mint-primary',
        discoverProducts: async () => ({ maps: 0, items: [] }), parseProduct: () => product,
        isUsableProduct: () => true, matchProduct: async () => ({ id: 52, conf: 0.9 }),
        acceptMatch: async () => ({ accepted: false, reason: 'official_title_mismatch' }),
        candidateIdentity: (item) => item.title.toLowerCase(),
    });
    assert.equal(await ingester.ingestProduct(db, product), 'candidate-new');
    const deletion = queries.find(({ sql }) => /DELETE FROM catalog_source_item_type_link/.test(sql));
    assert.deepEqual(deletion.params, [41, 'mint-primary']);
    const staging = queries.find(({ sql }) => /WITH candidate AS/.test(sql));
    assert.match(staging.params[0], /\|identity:[0-9a-f]{20}$/);
});

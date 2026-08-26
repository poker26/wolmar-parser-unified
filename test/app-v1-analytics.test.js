'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
    ProductAnalytics,
    comparableBucket,
    countBucket,
    pseudonymizeUser,
    safeRecorder,
    sanitizeProperties,
} = require('../app-v1/analytics/service');
const { report, safeWindowDays } = require('../scripts/report-product-metrics');

const USER_ID = '00000000-0000-4000-8000-000000000001';
const SOURCE_ID = '20000000-0000-4000-8000-000000000001';

class FakePool {
    constructor(rows = [{ id: 'event-id' }]) { this.rows = rows; this.queries = []; }
    async query(sql, params) { this.queries.push({ sql, params }); return { rows: this.rows }; }
}

test('analytics stores only a pseudonym and allowlisted properties', async () => {
    const pool = new FakePool();
    const analytics = new ProductAnalytics({ pool, now: () => new Date('2026-08-26T12:00:00Z') });
    const result = await analytics.record({
        userId: USER_ID,
        eventName: 'collection_item_created',
        properties: { linked: true },
        sourceId: SOURCE_ID,
    });
    assert.equal(result.recorded, true);
    const params = pool.queries[0].params;
    assert.equal(params[1], pseudonymizeUser(USER_ID));
    assert.notEqual(params[1], USER_ID);
    assert.equal(params[2], 'collection_item_created');
    assert.deepEqual(JSON.parse(params[3]), { linked: true });
    assert.match(params[4], /^[0-9a-f]{64}$/);
    assert.equal(params.join(' ').includes(USER_ID), false);
    assert.equal(params.join(' ').includes(SOURCE_ID), false);
});

test('analytics rejects sensitive or unknown properties before querying', async () => {
    assert.throws(
        () => sanitizeProperties('collection_item_created', { linked: true, email: 'owner@example.test' }),
        /not allowed/,
    );
    assert.throws(
        () => sanitizeProperties('collection_photo_ready', { url: 'private://photo' }),
        /not allowed/,
    );
    assert.throws(() => sanitizeProperties('unknown', {}), /Unsupported/);
});

test('metric buckets do not expose exact collection sizes', () => {
    assert.equal(comparableBucket(2), '1-2');
    assert.equal(comparableBucket(20), '20+');
    assert.equal(countBucket(3), '3-9');
    assert.equal(countBucket(99), '50+');
});

test('safe recorder never breaks the primary user action', async () => {
    const errors = [];
    const record = safeRecorder(
        { record: async () => { throw new Error('database unavailable'); } },
        { error: (message) => errors.push(message) },
    );
    assert.deepEqual(await record({ eventName: 'collection_item_sold' }), { recorded: false });
    assert.match(errors[0], /collection_item_sold failed/);
});

test('aggregate report returns counts and ratios without user identifiers', async () => {
    const results = [
        { rows: [{ event_name: 'collection_item_created', events: 6, users: 2 }] },
        { rows: [{
            active_accounts: 3, activated_users: 2, photo_activated_users: 1,
            collection_items: 10, linked_items: 8, valued_items: 5,
        }] },
        { rows: [{ d7_eligible: 2, d7_retained: 1, d30_eligible: 0, d30_retained: 0 }] },
    ];
    const pool = { query: async () => results.shift() };
    const output = await report(pool, 30);
    assert.equal(output.current.linkedItemShare, 0.8);
    assert.equal(output.current.valuedItemShare, 0.5);
    assert.equal(output.retention.d7Rate, 0.5);
    assert.equal(output.retention.d30Rate, null);
    assert.equal(JSON.stringify(output).includes(USER_ID), false);
});

test('aggregate report window is bounded', () => {
    assert.equal(safeWindowDays('30'), 30);
    assert.throws(() => safeWindowDays('0'), /1 to 400/);
    assert.throws(() => safeWindowDays('401'), /1 to 400/);
});

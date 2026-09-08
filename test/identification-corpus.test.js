'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { captureIdentificationCandidate } = require('../app-v1/identification/corpus');

test('candidate capture requires two ready photos whose hashes match the owned source request', async () => {
    let query;
    const pool = {
        async query(sql, params) {
            query = { sql, params };
            return { rows: [{ id: '17' }], rowCount: 1 };
        },
    };
    const result = await captureIdentificationCandidate(pool, {
        userId: '00000000-0000-4000-8000-000000000001',
        itemId: '20000000-0000-4000-8000-000000000001',
    });

    assert.deepEqual(result, { captured: true, eventId: '17' });
    assert.match(query.sql, /run\.user_id = label\.user_id/);
    assert.match(query.sql, /obverse\.status = 'ready'/);
    assert.match(query.sql, /reverse\.status = 'ready'/);
    assert.match(query.sql, /run\.image_sha256 @> ARRAY\[obverse\.sha256::text, reverse\.sha256::text\]/);
    assert.match(query.sql, /'candidate', 'exact_type'/);
    assert.match(query.sql, /'evaluation_only'/);
    assert.match(query.sql, /ON CONFLICT \(batch_id, case_id\) DO NOTHING/);
});

test('candidate capture abstains when the SQL invariants find no eligible pair', async () => {
    const pool = { query: async () => ({ rows: [], rowCount: 0 }) };
    assert.deepEqual(await captureIdentificationCandidate(pool, {
        userId: '00000000-0000-4000-8000-000000000001',
        itemId: '20000000-0000-4000-8000-000000000001',
    }), { captured: false, eventId: null });
});

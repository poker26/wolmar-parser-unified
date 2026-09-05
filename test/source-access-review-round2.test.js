'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const sql = fs.readFileSync(path.resolve(__dirname, '..', 'migrations', 'sql', '202609050012_source_access_review_round2.sql'), 'utf8');

test('second access review blocks prohibited cards and keeps allowed shops queued', () => {
    assert.match(sql, /source_key='numizmat\.ru'/);
    assert.match(sql, /status='blocked'/);
    assert.match(sql, /\/catalog\/moneta\/\*/);
    assert.match(sql, /source_key='vmiremonet\.ru'/);
    assert.match(sql, /source_key='numiscollect\.eu'/);
    assert.match(sql, /https:\/\/shop\.numiscollect\.eu/);
});

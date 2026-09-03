'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseStandartArchive, parseOptions } = require('../temporal/start-standart-year-backfill');

test('Standart archive is deduplicated and sorted newest first', () => {
    const html = `
      <a href="/auction/2236">Аукцион Standart №839</a>
      <a href="/auction/2234">Аукцион Standart №838</a>
      <footer><a href="/auction/2236">Аукцион Standart №839</a></footer>`;
    assert.deepEqual(parseStandartArchive(html), [
        { wolmarId: '2236', displayNumber: '839', auctionNumber: 's839' },
        { wolmarId: '2234', displayNumber: '838', auctionNumber: 's838' },
    ]);
});

test('year backfill is dry-run by default and validates descending range', () => {
    assert.deepEqual(parseOptions([]), { from: 839, to: 790, apply: false });
    assert.deepEqual(parseOptions(['--from=810', '--to=800', '--apply']), { from: 810, to: 800, apply: true });
    assert.throws(() => parseOptions(['--from=790', '--to=839']), /from >= to/);
});

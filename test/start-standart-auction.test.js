'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseOptions } = require('../temporal/start-standart-auction');

test('full Standart launcher is dry-run by default', () => {
    assert.deepEqual(parseOptions(['--wolmar-id=2238', '--number=840']), {
        wolmarId: '2238',
        displayNumber: '840',
        maxLotsPerCategory: null,
        apply: false,
    });
});

test('full Standart launcher requires explicit apply and validates limit', () => {
    assert.equal(parseOptions([
        '--wolmar-id=2238',
        '--number=840',
        '--max-lots-per-category=50',
        '--apply',
    ]).apply, true);
    assert.equal(parseOptions([
        '--wolmar-id=2238',
        '--number=840',
        '--max-lots-per-category=50',
    ]).maxLotsPerCategory, 50);
    assert.throws(
        () => parseOptions(['--wolmar-id=2238', '--number=840', '--max-lots-per-category=0']),
        /positive integer/,
    );
});

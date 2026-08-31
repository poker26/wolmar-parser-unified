'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    aggregateReferencePrices,
    analyzeKrauseReference,
    referencePriceForGrade,
} = require('../domain/krause-reference');

test('Krause grade table uses the same per-grade median as the catalog API', () => {
    const issues = [
        { year: 1985, prices: { XF40: 10, MS60: 20 } },
        { year: 1986, prices: { XF40: 30, MS60: 40 } },
    ];
    assert.deepEqual(aggregateReferencePrices(issues), [
        { grade: 'XF40', usd: 20, n: 2 },
        { grade: 'MS60', usd: 30, n: 2 },
    ]);
});

test('Krause numeric parsing preserves the existing catalog API behavior', () => {
    const issues = [{ prices: { XF40: '12.5 USD', MS60: '' } }];
    assert.deepEqual(aggregateReferencePrices(issues), [
        { grade: 'XF40', usd: 12.5, n: 1 },
    ]);
});

test('XF40 is preferred over XF and zero prices are not a fallback value', () => {
    const issues = [
        { prices: { XF: 8, XF40: 12 } },
        { prices: { XF: 10, XF40: 0 } },
    ];
    assert.deepEqual(referencePriceForGrade(issues, ['XF40', 'XF']), {
        grade: 'XF40', usd: 12, n: 1,
    });
});

test('quality gate rejects a decreasing circulation-grade scale', () => {
    const analysis = analyzeKrauseReference([
        { year: 1913, prices: { F12: 0.2, VF20: 20.3, XF40: 2.5, MS60: 5 } },
    ]);
    assert.equal(analysis.usableXf, false);
    assert.equal(analysis.issueViolations.length, 1);
    assert.equal(analysis.xf.usd, 2.5);
});

test('quality gate accepts a positive monotonic XF scale', () => {
    const analysis = analyzeKrauseReference([
        { year: 2001, prices: { VF20: 0.25, XF40: 0.75, MS60: 1.25, MS63: 2 } },
    ]);
    assert.equal(analysis.usableXf, true);
    assert.equal(analysis.xf.usd, 0.75);
});

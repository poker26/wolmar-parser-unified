'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { ComparableRepository } = require('../app-v1/valuation/comparable-repository');
const {
    MetalAdjustment,
    compositionFineness,
    normalizeMetal,
    pureWeight,
} = require('../app-v1/valuation/metal-adjustment');
const {
    METHOD_VERSION,
    comparablePlan,
    normalizeValuationInput,
    valuateCoin,
    weightedQuantile,
} = require('../domain/valuation');
const {
    auditLotTypeLink,
    explicitIssueYears,
    resolveLotYear,
} = require('../domain/identity-link-quality');
const { parseCbrCardMetadata } = require('../catalog/cbr-card');
const { historicalIssuerPattern, parseTitle } = require('../catalog/coin-matcher');

const NOW = new Date('2026-08-28T00:00:00Z');

function input(overrides = {}) {
    return {
        typeId: 77,
        gradeCode: 'ms 65',
        gradeSource: 'slab_label',
        slabStatus: 'slabbed',
        gradingCompanyCode: 'NGC',
        valuationDate: NOW,
        currency: 'RUB',
        ...overrides,
    };
}

function rows(prices) {
    return prices.map((price, index) => ({
        lotId: 100 + index,
        price,
        soldAt: NOW,
    }));
}

test('slabbed company plan expands company then status but never drops a known grade', () => {
    const normalized = normalizeValuationInput(input());
    const plan = comparablePlan(normalized);
    assert.deepEqual(plan.map(({ level }) => level), [
        'same_company_and_grade',
        'same_slab_group',
        'same_grade_market',
    ]);
    assert.ok(plan.every(({ gradeCode }) => gradeCode === 'MS65'));
    assert.equal(plan[0].gradingCompanyCode, 'NGC');
    assert.equal(plan[1].gradingCompanyCode, null);
    assert.equal(plan[1].slabStatus, 'slabbed');
    assert.equal(plan[2].slabStatus, null);
});

test('unknown slab status is not silently treated as raw', () => {
    const plan = comparablePlan(normalizeValuationInput(input({
        slabStatus: 'unknown',
        gradingCompanyCode: null,
        gradeSource: 'auction_house',
    })));
    assert.equal(plan.length, 1);
    assert.equal(plan[0].level, 'same_grade_unknown_slab_status');
    assert.equal(plan[0].slabStatus, null);
    assert.equal(plan[0].expanded, true);
});

test('weighted quantiles retain the production six-month recency weighting', () => {
    const comparableRows = [
        { price: 100, soldAt: '2025-08-28T00:00:00Z' },
        { price: 200, soldAt: '2026-02-28T00:00:00Z' },
        { price: 300, soldAt: '2026-08-28T00:00:00Z' },
    ];
    assert.equal(weightedQuantile(comparableRows, 0.5, NOW, 6), 300);
});

test('metal profile normalization preserves the existing predictor purity rules', () => {
    assert.equal(normalizeMetal('Ag'), 'Ag');
    assert.equal(normalizeMetal(null, 'Silver .925'), 'Ag');
    assert.equal(compositionFineness('Silver .925'), 925);
    assert.equal(compositionFineness('Au 900/1000'), 900);
    assert.equal(pureWeight({ metal: 'Ag', mass: 10, composition: 'Silver .925' }), 9.25);
    assert.equal(pureWeight({ metal: 'Au', weight: 10 }), 9);
});

test('metal adjustment applies the production historical melt delta', async () => {
    const pool = {
        async query(sql) {
            if (sql.includes('FROM auction_lots WHERE id')) {
                return { rows: [{ metal: 'Ag', weight: 10, fineness: 900 }] };
            }
            if (sql.includes('WITH requested')) {
                return { rows: [
                    { date: new Date('2026-08-28T00:00:00Z'), silver_price: 100 },
                    { date: new Date('2026-02-28T00:00:00Z'), silver_price: 50 },
                ] };
            }
            throw new Error(`unexpected SQL: ${sql}`);
        },
    };
    const adjustment = new MetalAdjustment({ pool });
    const result = await adjustment.adjust([
        { lotId: 9, price: 1000, soldAt: '2026-02-28', weight: 10, fineness: 900 },
    ], {
        typeId: 77,
        identityFallback: { lotId: 42 },
        valuationDate: NOW,
    });
    assert.equal(result.method, 'historical_melt_delta');
    assert.equal(result.rows[0].adjustedPrice, 1450);
});

test('valuateCoin uses exact same-company sales when sufficient', async () => {
    const calls = [];
    const result = await valuateCoin(input(), {
        findComparables: async (criteria) => {
            calls.push(criteria);
            return { rows: rows([100, 200, 300, 400, 500]), totalCount: 5 };
        },
    });
    assert.equal(calls.length, 1);
    assert.equal(result.status, 'ready');
    assert.equal(result.basisLevel, 'same_company_and_grade');
    assert.equal(result.exactComparableCount, 5);
    assert.equal(result.expandedComparableCount, 5);
    assert.deepEqual([result.low, result.median, result.high], [200, 300, 400]);
    assert.equal(result.methodVersion, METHOD_VERSION);
});

test('valuateCoin expands without a company coefficient and reports exact count separately', async () => {
    const responses = [
        { rows: rows([100]), totalCount: 1 },
        { rows: rows([90, 100, 110, 120]), totalCount: 4 },
    ];
    const calls = [];
    const result = await valuateCoin(input(), {
        findComparables: async (criteria) => {
            calls.push(criteria);
            return responses.shift();
        },
    });
    assert.equal(calls.length, 2);
    assert.equal(result.status, 'ready');
    assert.equal(result.basisLevel, 'same_slab_group');
    assert.equal(result.exactComparableCount, 1);
    assert.equal(result.expandedComparableCount, 4);
    assert.equal(result.confidence, 'low');
    assert.equal(result.median, 100);
});

test('unknown grade always returns a broad range even for the same slab company', async () => {
    const result = await valuateCoin(input({ gradeCode: null, gradeSource: 'unknown' }), {
        async findComparables(criteria) {
            assert.equal(criteria.level, 'same_company_unknown_grade');
            return { rows: rows([100, 200, 300, 400, 500]), totalCount: 5 };
        },
    });
    assert.equal(result.status, 'ready');
    assert.equal(result.low, 100);
    assert.equal(result.median, 300);
    assert.equal(result.high, 500);
    assert.equal(result.confidence, 'low');
});

test('known grade abstains instead of borrowing another grade', async () => {
    const seenGrades = [];
    const result = await valuateCoin(input(), {
        findComparables: async (criteria) => {
            seenGrades.push(criteria.gradeCode);
            return { rows: rows([100, 200]), totalCount: 2 };
        },
    });
    assert.deepEqual(seenGrades, ['MS65', 'MS65', 'MS65']);
    assert.equal(result.status, 'insufficient_data');
    assert.equal(result.abstainReason, 'not_enough_comparable_sales');
    assert.equal(result.median, null);
});

test('missing catalog identity abstains before querying market data', async () => {
    let queried = false;
    const result = await valuateCoin(input({ typeId: null, identityFallback: null }), {
        findComparables: async () => { queried = true; return { rows: [] }; },
    });
    assert.equal(queried, false);
    assert.equal(result.status, 'insufficient_data');
    assert.equal(result.abstainReason, 'identity_required');
});

test('paper money mislinked to a coin type is rejected before comparable lookup', async () => {
    let queried = false;
    const result = await valuateCoin(input({
        identityFallback: { lotId: 42, assetKind: 'paper_money' },
    }), {
        findComparables: async () => { queried = true; return { rows: [] }; },
    });
    assert.equal(queried, false);
    assert.equal(result.status, 'insufficient_data');
    assert.equal(result.abstainReason, 'unsupported_asset_kind');
});

test('SQL repository filters completed sales by type, grade, slab and company', async () => {
    const queries = [];
    const pool = {
        async query(sql, params) {
            queries.push({ sql, params });
            return { rows: [{ lot_id: 9, price: '1234', sold_at: NOW, total_count: 1 }] };
        },
    };
    const repository = new ComparableRepository({ pool, linkQualityPolicy: 'all-conflicts' });
    const result = await repository.findComparables({
        typeId: 77,
        gradeCode: 'MS65',
        slabStatus: 'slabbed',
        gradingCompanyCode: 'NGC',
        valuationDate: NOW,
        currency: 'RUB',
        excludeLotId: 42,
        excludeAuctionNumber: '1016',
        limit: 250,
    });
    assert.equal(result.totalCount, 1);
    assert.deepEqual(result.rows[0], {
        lotId: 9,
        price: 1234,
        soldAt: NOW,
        metal: undefined,
        weight: null,
        fineness: null,
        pureMetalWeight: null,
    });
    assert.match(queries[0].sql, /ltl\.type_id = \$1/);
    assert.match(queries[0].sql, /LEFT JOIN lot_type_link_quality lq/);
    assert.match(queries[0].sql, /lq\.type_id = ltl\.type_id/);
    assert.match(queries[0].sql, /COALESCE\(lq\.status, 'unverified'\) <> 'conflict'/);
    assert.match(queries[0].sql, /al\.lot_status = 'closed'/);
    assert.match(queries[0].sql, /NULLIF\(al\.slab_grade_code, ''\)/);
    assert.match(queries[0].sql, /al\.slab_status = \$6/);
    assert.match(queries[0].sql, /al\.grading_company_code = \$7/);
    assert.match(queries[0].sql, /al\.id <> \$8/);
    assert.match(queries[0].sql, /al\.auction_number IS DISTINCT FROM \$9/);
    assert.deepEqual(queries[0].params, [
        77,
        ['wolmar.ru', 'numismat.ru', 'meshok.net', 'auction.ru'],
        'RUB',
        NOW,
        'MS65',
        'slabbed',
        'NGC',
        42,
        '1016',
        250,
    ]);
});

test('SQL repository leaves link quality filtering disabled unless a shadow policy is selected', async () => {
    const queries = [];
    const pool = {
        async query(sql) {
            queries.push(sql);
            return { rows: [] };
        },
    };
    const repository = new ComparableRepository({ pool });
    await repository.findComparables({
        typeId: 77,
        valuationDate: NOW,
        currency: 'RUB',
    });
    assert.doesNotMatch(queries[0], /lot_type_link_quality|lq\.status|lq\.reasons/);
});

test('denomination-only link policy does not quarantine year or mint conflicts', async () => {
    const queries = [];
    const pool = {
        async query(sql) {
            queries.push(sql);
            return { rows: [] };
        },
    };
    const repository = new ComparableRepository({ pool, linkQualityPolicy: 'denomination-only' });
    await repository.findComparables({
        typeId: 77,
        valuationDate: NOW,
        currency: 'RUB',
    });
    assert.match(queries[0], /lq\.reasons \? 'denomination_unit_mismatch'/);
    assert.match(queries[0], /lq\.reasons \? 'denomination_value_mismatch'/);
    assert.doesNotMatch(queries[0], /year_mismatch|mint_mismatch/);
});

test('identity audit rejects an explicit mint contradiction', () => {
    const result = auditLotTypeLink({
        lot: {
            year: 1852,
            denomination: { num: 3, unit: 'копейки', value: 0.03, isRf: true },
            mints: ['ЕМ'],
        },
        type: {
            name: '3 копейки 1852 ВМ',
            country: 'RU',
            year: 1852,
            denominationValue: 0.03,
            mint: 'ВМ',
        },
    });
    assert.equal(result.status, 'conflict');
    assert.deepEqual(result.reasons, ['mint_mismatch']);
});

test('canonical matcher extracts Cyrillic mint codes with real boundaries', () => {
    assert.deepEqual(
        parseTitle('3 копейки 1852г. ЕМ. Cu. | Екатеринбургский монетный двор').mints,
        ['ЕМ'],
    );
    assert.deepEqual(parseTitle('3 копейки 1852г. ВМ. Cu.').mints, ['ВМ']);
});

test('canonical matcher parses a fractional denomination before the denominator tail', () => {
    const parsed = parseTitle('1/2 доллара. США 1934г. Ag.');
    assert.equal(parsed.denom.num, 0.5);
    assert.equal(parsed.denom.unit, 'доллара');
    assert.equal(parsed.denom.fraction, true);
});

test('canonical matcher keeps the leading denomination when a secondary denomination follows', () => {
    const parsed = parseTitle('1 талер (48 шиллингов). Любек 1752г.');
    assert.equal(parsed.denom.num, 1);
    assert.equal(parsed.denom.unit, 'талер');
});

test('audit year resolver prefers a stored issue year that is explicit in a multi-year title', () => {
    const description = '100 рублей. Камчатская экспедиция 1733-1743 гг 2004г. СПМД.';
    assert.deepEqual(explicitIssueYears(description), [1733, 1743, 2004]);
    assert.deepEqual(resolveLotYear({
        parsedYear: 1733,
        storedYear: 2004,
        description,
    }), {
        year: 2004,
        evidence: 'year_lot_column',
        explicitYears: [1733, 1743, 2004],
    });
});

test('audit year resolver rejects a stored year absent from source text', () => {
    assert.equal(resolveLotYear({
        parsedYear: 2014,
        storedYear: 2012,
        description: '50 рублей. Олимпиада 2014г.',
    }).year, 2014);
});

test('CBR card metadata keeps release date and inscribed coin year separate', () => {
    const metadata = parseCbrCardMetadata(`
        <div>Дата выпуска</div><div>01.10.2010</div>
        <p>в центре - дата выпуска &quot;2011 г.&quot;</p>
    `);
    assert.deepEqual(metadata, {
        issueDate: '2010-10-01',
        issueYear: 2010,
        coinYear: 2011,
    });
});

test('CBR card metadata reads a plain date from the obverse section only', () => {
    const metadata = parseCbrCardMetadata(`
        <div>Дата выпуска</div><div>21.02.2012</div>
        <h2>Аверс</h2><p>внизу дата: &quot;2014&quot;</p>
        <h2>Реверс</h2><p>к 100-летию события 1914 года</p>
    `);
    assert.equal(metadata.coinYear, 2014);
});

test('identity audit accepts either official issue year or year inscribed on the coin', () => {
    const baseType = {
        country: 'RU',
        year: 2010,
        coinYear: 2011,
        denominationValue: 3,
        name: '3 рубля. Кролик',
    };
    assert.equal(auditLotTypeLink({
        lot: parseTitle('3 рубля. Кролик 2011г.'),
        type: baseType,
    }).status, 'consistent');
    assert.equal(auditLotTypeLink({
        lot: parseTitle('3 рубля. Кролик 2010г.'),
        type: baseType,
    }).status, 'consistent');
    assert.deepEqual(auditLotTypeLink({
        lot: parseTitle('3 рубля. Кролик 2012г.'),
        type: baseType,
    }).reasons, ['year_mismatch']);
});

test('historical issuer narrows German-state candidates before theme scoring', () => {
    const pattern = historicalIssuerPattern('Германия Пруссия 1 талер 1793 года');
    assert.equal(pattern.test('1 талер. GERMANY — Регенсбург 1793'), false);
    assert.equal(pattern.test('THALER. PRUSSIA 1793'), true);
});

test('identity audit accepts an imperial fractional kopek when ruble value metadata is absent', () => {
    const result = auditLotTypeLink({
        lot: parseTitle('1/2 копейки 1840г. ЕМ. Cu.'),
        type: {
            country: 'RU',
            year: 1840,
            denominationText: '1/2 копейки',
            denominationValue: null,
            name: '1/2 копейки 1840 ЕМ',
            mint: 'ЕМ',
        },
    });
    assert.equal(result.status, 'consistent');
    assert.deepEqual(result.reasons, []);
});

test('identity audit rejects foreign denomination-unit mismatch', () => {
    const result = auditLotTypeLink({
        lot: {
            year: 1962,
            denomination: { num: 5, unit: 'франков', value: 5, isRf: false },
            mints: [],
        },
        type: {
            name: '5 CENTIMES. FRANCE',
            country: 'France',
            yearStart: 1961,
            yearEnd: 1964,
            denominationText: '5 CENTIMES',
        },
    });
    assert.equal(result.status, 'conflict');
    assert.deepEqual(result.reasons, ['denomination_unit_mismatch']);
});

test('identity audit understands Russian mark and pfennig inflections', () => {
    assert.deepEqual(auditLotTypeLink({
        lot: parseTitle('5 марок. Босния и Герцеговина 2005г.'),
        type: { name: '10 марок. BOSNIA 1998', country: 'Bosnia', year: 1998 },
    }).reasons, ['year_mismatch', 'denomination_value_mismatch']);
    assert.deepEqual(auditLotTypeLink({
        lot: parseTitle('5 феннигов. Босния и Герцеговина 2005г.'),
        type: { name: '10 марок. BOSNIA 1998', country: 'Bosnia', year: 1998 },
    }).reasons, ['year_mismatch', 'denomination_unit_mismatch']);
});

test('identity audit rejects Swiss rappen linked to a batzen type', () => {
    const audit = auditLotTypeLink({
        lot: parseTitle('5 раппенов. Швейцария 1962г. Cu-Ni.'),
        type: {
            name: '5 BATZEN. SWISS CANTONS',
            year: 1810,
            yearStart: 1807,
            yearEnd: 1810,
            denominationText: '5 BATZEN',
        },
    });

    assert.equal(audit.status, 'conflict');
    assert.ok(audit.reasons.includes('denomination_unit_mismatch'));
});

test('identity audit treats cent and centime spellings as the same minor-unit family', () => {
    const result = auditLotTypeLink({
        lot: {
            year: 1939,
            denomination: { num: 20, unit: 'сантимов', value: 20, isRf: false },
            mints: [],
        },
        type: {
            country: 'French Indochina',
            year: 1939,
            denominationText: '20 CENTS',
        },
    });
    assert.equal(result.status, 'consistent');
});

test('identity audit accepts compatible year range denomination and mint', () => {
    const result = auditLotTypeLink({
        lot: {
            year: 1962,
            denomination: { num: 1, unit: 'песо', value: 1, isRf: false },
            mints: [],
        },
        type: {
            name: 'PESO. MEXICO',
            country: 'Mexico',
            yearStart: 1957,
            yearEnd: 1967,
            denominationText: 'PESO',
        },
    });
    assert.equal(result.status, 'consistent');
    assert.deepEqual(result.reasons, []);
});

test('identity audit understands compound English denomination numbers', () => {
    const result = auditLotTypeLink({
        lot: {
            year: 2001,
            denomination: { num: 25, unit: 'центов', value: 25, isRf: false },
            mints: [],
        },
        type: {
            country: 'United States',
            year: 2001,
            denominationText: 'TWENTY FIVE CENTS',
        },
    });
    assert.equal(result.status, 'consistent');
    assert.deepEqual(result.reasons, []);
});

test('identity audit accepts an explicit type name when secondary denomination metadata differs', () => {
    const result = auditLotTypeLink({
        lot: {
            year: 1752,
            denomination: { num: 1, unit: 'талер', value: 1, isRf: false },
            mints: [],
        },
        type: {
            country: 'German States',
            year: 1752,
            denominationText: '48 SCHILLINGE',
            name: '1 талер (48 шиллингов). GERMAN STATES 1752',
        },
    });
    assert.equal(result.status, 'consistent');
    assert.deepEqual(result.reasons, []);
});

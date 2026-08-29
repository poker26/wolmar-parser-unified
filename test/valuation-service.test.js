'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
    METHOD_VERSION,
    ValuationService,
    canonicalResult,
} = require('../valuation-service');

const NOW = new Date('2026-08-29T12:00:00Z');

function prediction(price = 2500) {
    return {
        predicted_price: price,
        metal_value: 100,
        numismatic_premium: price - 100,
        confidence_score: 0.65,
        prediction_method: 'statistical_model',
        sample_size: 6,
        comparable_basis: 'type_grade_raw',
    };
}

test('canonical result retains the established point prediction', () => {
    const result = canonicalResult(prediction(), {
        type_id: 77,
        condition: 'XF',
        slab_status: 'raw',
        grade_source: 'user',
    }, NOW);

    assert.equal(result.status, 'ready');
    assert.equal(result.median, 2500);
    assert.equal(result.method, 'statistical_model');
    assert.equal(result.methodVersion, METHOD_VERSION);
    assert.equal(result.basis, 'type_grade_raw');
});

test('lot loading carries the audited link quality into comparable selection', async () => {
    let query;
    const db = {
        async query(sql, params) {
            query = { sql, params };
            return { rows: [{ id: 42, type_id: 77, link_quality_status: 'conflict' }] };
        },
    };
    const generator = { dbClient: db, async predictPrice() { return prediction(); } };
    const service = new ValuationService({ db, generator, clock: () => NOW });

    const lot = await service.loadLot(42);

    assert.equal(lot.link_quality_status, 'conflict');
    assert.deepEqual(query.params, [42]);
    assert.match(query.sql, /lq\.audit_version = 'hard-consistency-v1'/);
    assert.match(query.sql, /linked\.link_quality_status/);
    assert.match(query.sql, /WHEN 'conflict' THEN 2/);
});

test('lot, catalog and collection adapters produce one valuation identity', async () => {
    const seen = [];
    const generator = {
        dbClient: {},
        async predictPrice(target) {
            seen.push(target);
            return prediction();
        },
    };
    const db = {
        async query(sql) {
            if (sql.includes('FROM lot_type_link ltl')) {
                return { rows: [{
                    id: 999,
                    lot_number: '9',
                    auction_number: '1000',
                    category: 'Монеты',
                    coin_description: '5 рублей 1998',
                    condition: 'XF',
                    grade_source: 'user',
                    slab_status: 'raw',
                    type_id: 77,
                    winning_bid: 2000,
                }] };
            }
            throw new Error(`unexpected SQL: ${sql}`);
        },
    };
    const service = new ValuationService({ db, generator, clock: () => NOW });

    const fromLot = await service.valuateLot({
        id: 1,
        type_id: 77,
        condition: 'XF',
        grade_source: 'user',
        slab_status: 'raw',
        category: 'Монеты',
    });
    const fromCatalog = await service.valuateType({
        typeId: 77,
        gradeCode: 'XF',
        gradeSource: 'user',
        slabStatus: 'raw',
    });
    const fromCollection = await service.valuateCollectionItem({
        type_id: 77,
        grade_code: 'XF',
        grade_source: 'user',
        slab_status: 'raw',
    });

    assert.equal(seen.length, 3);
    assert.deepEqual(
        [fromLot.median, fromCatalog.median, fromCollection.median],
        [2500, 2500, 2500],
    );
    assert.equal(fromLot.fingerprint, fromCatalog.fingerprint);
    assert.equal(fromCatalog.fingerprint, fromCollection.fingerprint);
    assert.deepEqual(
        seen.map((target) => target.coin_description),
        ['5 рублей 1998', '5 рублей 1998', '5 рублей 1998'],
    );
});

test('typed lot does not leak its title into a type-wide valuation', async () => {
    const seen = [];
    const generator = {
        dbClient: {},
        async predictPrice(target) {
            seen.push(target);
            return prediction(target.coin_description === 'canonical representative' ? 2500 : 9999);
        },
    };
    const db = {
        async query(sql) {
            if (sql.includes('FROM lot_type_link ltl')) {
                return { rows: [{
                    id: 999,
                    lot_number: '9',
                    auction_number: '1000',
                    category: 'Монеты',
                    coin_description: 'canonical representative',
                    condition: 'XF',
                    grade_source: 'user',
                    slab_status: 'raw',
                    type_id: 77,
                    winning_bid: 2000,
                }] };
            }
            throw new Error(`unexpected SQL: ${sql}`);
        },
    };
    const service = new ValuationService({ db, generator, clock: () => NOW });

    const fromFirstLot = await service.valuateLot({
        id: 1, type_id: 77, coin_description: 'first lot title',
        condition: 'XF', grade_source: 'user', slab_status: 'raw', category: 'Монеты',
    });
    const fromSecondLot = await service.valuateLot({
        id: 2, type_id: 77, coin_description: 'another title from the same type',
        condition: 'XF', grade_source: 'user', slab_status: 'raw', category: 'Монеты',
    });
    const fromCatalog = await service.valuateType({
        typeId: 77, gradeCode: 'XF', gradeSource: 'user', slabStatus: 'raw',
    });

    assert.deepEqual(
        [fromFirstLot.median, fromSecondLot.median, fromCatalog.median],
        [2500, 2500, 2500],
    );
    assert.deepEqual(
        seen.map((target) => target.coin_description),
        ['canonical representative', 'canonical representative', 'canonical representative'],
    );
});

test('known type abstention remains an abstention in every adapter', () => {
    const result = canonicalResult({
        predicted_price: null,
        confidence_score: 0,
        prediction_method: 'no_similar_lots',
        sample_size: 0,
        comparable_basis: 'type_grade_unknown_slab',
    }, { type_id: 77, condition: 'XF' }, NOW);

    assert.equal(result.status, 'insufficient_data');
    assert.equal(result.median, null);
    assert.equal(result.abstainReason, 'no_similar_lots');
});

test('an unslabbed catalog or collection type without a user grade uses the agreed XF heuristic', async () => {
    const seen = [];
    const queries = [];
    const generator = {
        dbClient: {},
        async predictPrice(target) {
            seen.push(target);
            return prediction();
        },
    };
    const db = {
        async query(sql, params) {
            queries.push({ sql, params });
            return { rows: [{
                id: 999,
                lot_number: '9',
                auction_number: '1000',
                category: 'Монеты',
                coin_description: '1 рубль 1897 г. АГ Ag',
                type_id: 77,
                winning_bid: 7000,
            }] };
        },
    };
    const service = new ValuationService({ db, generator, clock: () => NOW });

    const result = await service.valuateType({ typeId: 77, slabStatus: 'unknown' });

    assert.equal(seen[0].condition, 'XF');
    assert.equal(seen[0].link_grade, 'XF');
    assert.equal(seen[0].grade_source, 'heuristic');
    assert.equal(result.profile.gradeCode, 'XF');
    assert.equal(result.profile.gradeSource, 'heuristic');
    assert.deepEqual(queries[0].params, [77, 'XF', 'unknown', null]);
    assert.match(queries[0].sql, /COALESCE\(lq\.status, 'unverified'\) <> 'conflict'/);
    assert.match(queries[0].sql, /collection_normalize_grade/);
});

test('a slabbed type without a label grade is not assigned the XF heuristic', async () => {
    const seen = [];
    const generator = {
        dbClient: {},
        async predictPrice(target) {
            seen.push(target);
            return prediction();
        },
    };
    const db = {
        async query() {
            return { rows: [{ id: 999, type_id: 77, winning_bid: 7000 }] };
        },
    };
    const service = new ValuationService({ db, generator, clock: () => NOW });

    const result = await service.valuateType({ typeId: 77, slabStatus: 'slabbed' });

    assert.equal(seen[0].condition, null);
    assert.equal(result.profile.gradeCode, null);
    assert.equal(result.profile.gradeSource, 'unknown');
});

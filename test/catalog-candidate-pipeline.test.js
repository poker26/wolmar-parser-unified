'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
    classifyMeshokObservation,
    classifyAuctionRuObservation,
} = require('../catalog/marketplace-observation');
const { candidateKey } = require('../catalog/catalog-candidates');
const { sourceKey } = require('../catalog/source-registry');

const root = path.resolve(__dirname, '..');

test('meshok keeps unsold and active cards for catalog without inventing sale prices', () => {
    assert.deepEqual(
        classifyMeshokObservation({ mode: 'ended', bidsCount: 0, price: 1500 }),
        { lotStatus: 'ended_unsold', storedPrice: null, isSale: false },
    );
    assert.deepEqual(
        classifyMeshokObservation({ mode: 'ended', bidsCount: 3, price: 1700 }),
        { lotStatus: 'sold', storedPrice: 1700, isSale: true },
    );
    assert.deepEqual(
        classifyMeshokObservation({ mode: 'active', bidsCount: 0, price: 1900 }),
        { lotStatus: 'active', storedPrice: 1900, isSale: false },
    );
});

test('a future meshok end date remains active even if it came from an ended listing', () => {
    const result = classifyMeshokObservation({
        mode: 'ended', bidsCount: 2, price: 1000,
        endDate: '2030-01-01T00:00:00Z', now: Date.parse('2026-01-01T00:00:00Z'),
    });
    assert.equal(result.lotStatus, 'active');
    assert.equal(result.isSale, false);
});

test('auction.ru terminal cards without bids remain catalog evidence, not sales', () => {
    assert.deepEqual(
        classifyAuctionRuObservation({ availability: 'OutOfStock', hasBids: false, price: 2500 }),
        { lotStatus: 'ended_unsold', storedPrice: null, isSale: false, terminal: true },
    );
    assert.deepEqual(
        classifyAuctionRuObservation({ availability: 'SoldOut', hasBids: true, price: 2600 }),
        { lotStatus: 'sold', storedPrice: 2600, isSale: true, terminal: true },
    );
    assert.deepEqual(
        classifyAuctionRuObservation({ availability: 'InStock', hasBids: false, price: 2700 }),
        { lotStatus: 'active', storedPrice: 2700, isSale: false, terminal: false },
    );
});

test('candidate identity is independent of source and subject word order', () => {
    const a = candidateKey({
        era: 'foreign', country: 'Niue', denominationText: '2 долларов', year: 2024,
        subjectWords: ['дарт', 'вейдер'],
    });
    const b = candidateKey({
        era: 'foreign', country: 'Niue', denominationText: '2 доллара', year: 2024,
        subjectWords: ['вейдер', 'дарт'],
    });
    assert.equal(a, b);
    assert.doesNotMatch(a, /auction|meshok/);
});

test('marketplace ingesters stage gaps and no longer reject unsold cards before parsing', () => {
    const meshok = fs.readFileSync(path.join(root, 'catalog', 'ingest-meshok.js'), 'utf8');
    const auction = fs.readFileSync(path.join(root, 'catalog', 'poll-auctionru.js'), 'utf8');
    const legacyAuctionIntegration = fs.readFileSync(path.join(root, 'catalog', 'integrate-auctionru.js'), 'utf8');

    assert.match(meshok, /stageCatalogCandidate/);
    assert.match(meshok, /ended_unsold/);
    assert.doesNotMatch(meshok, /if \(sold && !\(l\.bidsCount > 0\)\) return/);
    assert.match(auction, /await saveObservation/);
    assert.match(auction, /stageCatalogCandidate/);
    assert.doesNotMatch(auction, /createSelf|matchOrCreateType/);
    assert.doesNotMatch(legacyAuctionIntegration, /INSERT INTO coin_type/);
});

test('catalog candidate migration preserves provenance outside public coin_type', () => {
    const sql = fs.readFileSync(
        path.join(root, 'migrations', 'sql', '202609040001_catalog_candidates.sql'),
        'utf8',
    );
    assert.match(sql, /CREATE TABLE catalog_candidate \(/);
    assert.match(sql, /CREATE TABLE catalog_candidate_observation \(/);
    assert.match(sql, /lot_id INTEGER NOT NULL REFERENCES auction_lots/);
    assert.match(sql, /status IN \('pending', 'rejected', 'promoted'\)/);
    assert.doesNotMatch(sql, /INSERT INTO coin_type|UPDATE coin_type|DELETE FROM|TRUNCATE/i);
});

test('catalog source registry covers suggested Russian and primary foreign sources', () => {
    const sql = fs.readFileSync(
        path.join(root, 'migrations', 'sql', '202609040002_catalog_sources.sql'),
        'utf8',
    );
    for (const key of [
        'numizm.at', 'coinsbolhov.ru', 'imperial-mag.ru', 'xn--b1aga1affsn5f.xn--p1ai',
        'en.numista.com', 'usmint.gov', 'mint.ca', 'royalmint.com', 'emk.com', 'powercoin.it',
    ]) assert.match(sql, new RegExp(key.replaceAll('.', '\\.')));
    assert.match(sql, /price_role TEXT NOT NULL DEFAULT 'none'/);
    assert.match(sql, /CREATE TABLE catalog_source_run/);
    assert.match(sql, /status = 'retired'/);
    assert.equal(sourceKey('EMK.COM'), 'emk.com');
    assert.throws(() => sourceKey('всемонеты.рф'), /ASCII/);
});

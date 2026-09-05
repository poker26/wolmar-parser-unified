'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { parseTitle } = require('../catalog/coin-matcher');
const {
    PRODUCT_QUERY, coinImages, denominationFromDescription, denominationFromTitle, isUsableCoinProduct,
    parseEmkProduct, parseProductSitemap, weightGrams,
} = require('../catalog/emk-catalog');

const root = path.resolve(__dirname, '..');

function raw(overrides = {}) {
    return {
        id: 'IBAU562512',
        title: '1 oz Gold Coin - Koala - 2025',
        description: '<p>The reverse shows the denomination “100 DOLLARS” and AUSTRALIA 2025.</p>',
        url: '/en-us/coins/australia/1-oz-gold-coin-koala-2025-ibau562512',
        categoriesPaths: [{ categories: [{ name: 'Gold' }, { name: 'Australia' }, { name: 'Koala' }] }],
        media: [0, 1].map((index) => ({ type: 'ProductImage', large: `/product/image/large/ibau562512_${index}.webp` })),
        specifications: [{ key: 'mint', name: 'Mintage', value: '1.000' }, { key: 'q', name: 'Quality', value: 'Proof' }],
        ...overrides,
    };
}

test('EMK sitemap keeps unique single-coin product IDs and rejects adjacent goods', () => {
    const xml = `<urlset>
      <url><loc>https://www.emk.com/en-us/a/1-oz-silver-coin-koala-2025-iaaa123456</loc></url>
      <url><loc>https://www.emk.com/en-us/b/1-oz-silver-coin-koala-2025-iaaa123456</loc></url>
      <url><loc>https://www.emk.com/en-us/a/coin-set-2025-ibbb123456</loc></url>
      <url><loc>https://www.emk.com/en-us/a/silver-bar-2025-iccc123456</loc></url>
      <url><loc>https://www.emk.com/en-us/a/coin-mintmark</loc></url>
      <url><loc>https://example.com/a/coin-2025-iddd123456</loc></url></urlset>`;
    const items = parseProductSitemap(xml);
    assert.equal(items.length, 1);
    assert.equal(items[0].sourceItemKey, 'iaaa123456');
    assert.equal(items[0].queryId, 'IAAA123456');
});

test('EMK parser retains identity and media while excluding prices', () => {
    const product = parseEmkProduct(raw());
    assert.equal(product.country, 'Australia');
    assert.equal(product.year, 2025);
    assert.equal(product.denomination, '100 DOLLARS');
    assert.match(product.matchTitle, /100 долларов.*Австралия/);
    assert.equal(product.mintage, 1000);
    assert.equal(product.condition, 'Proof');
    assert.equal(Math.round(product.weightG * 1000) / 1000, 31.103);
    assert.equal(product.aversImageUrl, 'https://www.emk.com/product/image/large/ibau562512_0.webp');
    assert.equal(product.reversImageUrl, 'https://www.emk.com/product/image/large/ibau562512_1.webp');
    assert.equal(isUsableCoinProduct(product, parseTitle(product.matchTitle)), true);
    assert.doesNotMatch(PRODUCT_QUERY, /\b(?:price|offer|salesPrice|listPrice)\b/i);
    assert.equal(Object.keys(product.attributes).some((key) => /price|offer/i.test(key)), false);
});

test('EMK denomination parser requires written face-value evidence', () => {
    assert.deepEqual(denominationFromDescription('the denomination $500 is included'), { source: '500 DOLLARS', matcher: '500 долларов' });
    assert.deepEqual(denominationFromDescription('outer edge: “SOMALI REPUBLIC 2025 2.000 SHILLINGS”'), { source: '2000 SHILLINGS', matcher: '2000 шиллингов' });
    assert.deepEqual(denominationFromDescription('inscriptions "25 DOLLARS", "SAMOA 2023"'), { source: '25 DOLLARS', matcher: '25 долларов' });
    assert.deepEqual(denominationFromDescription('SOMALI REPUBLIC 2024 100 SHILLINGS is written on the outer edge'), null);
    assert.deepEqual(denominationFromDescription('outer edge reads SOMALI REPUBLIC 2024 100 SHILLINGS'), { source: '100 SHILLINGS', matcher: '100 шиллингов' });
    assert.deepEqual(denominationFromTitle('20 Euro Silver Coin - Winckelmann - 2017'), { source: '20 EURO', matcher: '20 евро' });
    assert.equal(denominationFromDescription('the reverse shows the denomination and year'), null);
    assert.equal(denominationFromDescription('has no fixed denomination and is legal tender'), null);
});

test('EMK media heuristic skips marketing hero and final packaging when present', () => {
    const media = [0, 1, 2, 3, 4].map((index) => ({ type: 'ProductImage', large: `/product/image/large/x_${index}.webp` }));
    const images = coinImages(media);
    assert.match(images.avers, /_1\.webp$/);
    assert.match(images.revers, /_3\.webp$/);
    assert.equal(images.all.length, 5);
    assert.equal(weightGrams('1/62 oz Gold Coin - 2020') > 0, true);
});

test('EMK cards without a written denomination stay usable but cannot be matched', () => {
    const product = parseEmkProduct(raw({ description: '<p>The reverse bears the denomination and year.</p>' }));
    const parsed = parseTitle(product.matchTitle);
    assert.equal(product.denomination, null);
    assert.equal(parsed.denom, null);
    assert.equal(isUsableCoinProduct(product, parsed), true);
});

test('EMK rejects sets and accepts the USA category name', () => {
    const set = parseEmkProduct(raw({ title: '5 oz Gold Coin Prestige-Set - Big Five - 2021' }));
    assert.equal(isUsableCoinProduct(set, parseTitle(set.matchTitle)), false);
    const usa = parseEmkProduct(raw({ categoriesPaths: [{ categories: [{ name: 'USA' }] }] }));
    assert.equal(usa.country, 'USA');
    assert.match(usa.matchTitle, /США/);
});

test('EMK migration activates catalog-only GraphQL adapter', () => {
    const sql = fs.readFileSync(path.join(root, 'migrations', 'sql', '202609050008_emk_source.sql'), 'utf8');
    assert.match(sql, /adapter_key='emk-graphql'/);
    assert.match(sql, /price_role='none'/);
    assert.match(sql, /stored-incomplete/);
    assert.doesNotMatch(sql, /asking_price|sale_price|winning_bid/i);
});


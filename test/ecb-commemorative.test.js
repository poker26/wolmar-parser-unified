'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { parseTitle } = require('../catalog/coin-matcher');
const {
    NEW_COMMON_SIDE,
    OLD_COMMON_SIDE,
    commonSide,
    isUsableCoinProduct,
    mintageValue,
    parseCommemorativeIndex,
    parseCommemorativePage,
} = require('../catalog/ecb-commemorative');

const root = path.resolve(__dirname, '..');

function page(year, boxes) {
    return `<link rel="canonical" href="https://www.ecb.europa.eu/euro/coins/comm/html/comm_${year}.en.html">
      <main><h1>€2 commemorative coins - ${year}</h1><div class="boxes -grey">${boxes}</div></main>`;
}

function box({ country, feature, volume, image, description = 'The design bears the year of issue.' }) {
    return `<div class="box"><picture><img src="comm_2025/${image}"></picture><div class="content-box">
      <h3>${country}</h3><div><p><strong>Feature:</strong> ${feature}</p>
      <p><strong>Description:</strong> ${description}</p><p><strong>Issuing volume:</strong> ${volume}</p>
      <p><strong>Issuing date:</strong> June 2025</p></div></div></div>`;
}

test('ecb index retains unique English annual commemorative pages', () => {
    assert.deepEqual(parseCommemorativeIndex(`
      <a href="/euro/coins/comm/html/comm_2025.en.html">2025</a>
      <a href="/euro/coins/comm/html/comm_2025.en.html">duplicate</a>
      <a href="/euro/coins/comm/html/comm_2024.de.html">German</a>
      <a href="https://example.com/comm_2023.en.html">foreign</a>
      <a href="/euro/coins/comm/html/comm_2004.en.html">2004</a>`), [
        'https://www.ecb.europa.eu/euro/coins/comm/html/comm_2025.en.html',
        'https://www.ecb.europa.eu/euro/coins/comm/html/comm_2004.en.html',
    ]);
});

test('ecb parser creates one exact coin per box with both official sides and no prices', () => {
    const products = parseCommemorativePage(page(2025, box({
        country: 'France', feature: 'Notre-Dame', volume: '20 000 000 coins', image: 'France.jpg',
    })), 'https://www.ecb.europa.eu/euro/coins/comm/html/comm_2025.en.html');
    assert.equal(products.length, 1);
    const product = products[0];
    assert.equal(product.year, 2025);
    assert.equal(product.denomination, '2 euro');
    assert.equal(product.mintage, 20000000);
    assert.equal(product.weightG, 8.5);
    assert.equal(product.diameterMm, 25.75);
    assert.equal(product.aversImageUrl, 'https://www.ecb.europa.eu/euro/coins/comm/html/comm_2025/France.jpg');
    assert.equal(product.reversImageUrl, NEW_COMMON_SIDE);
    assert.match(product.sourceItemKey, /^comm\/2025\/france-[a-f0-9]{16}-france\.jpg$/);
    assert.match(product.matchTitle, /Франция/);
    assert.equal(Object.hasOwn(product, 'price'), false);
    assert.equal(Object.keys(product.attributes).some((key) => /price/i.test(key)), false);
    assert.equal(isUsableCoinProduct(product, parseTitle(product.matchTitle)), true);
});

test('ecb identity keys remain distinct when the source reuses a placeholder image', () => {
    const products = parseCommemorativePage(page(2025, [
        box({ country: 'Vatican', feature: 'Michelangelo', volume: '80 000 coins', image: 'placeholder.jpg' }),
        box({ country: 'Vatican', feature: 'Jubilee', volume: '80 000 coins', image: 'placeholder.jpg' }),
    ].join('')), 'https://www.ecb.europa.eu/euro/coins/comm/html/comm_2025.en.html');
    assert.equal(products.length, 2);
    assert.notEqual(products[0].sourceItemKey, products[1].sourceItemKey);
    assert.match(products[0].matchTitle, /Ватикан/);
    assert.match(products[1].matchTitle, /Ватикан/);
});

test('ecb parser rejects a conflicting page year and handles historical common sides', () => {
    const bad = page(2024, box({ country: 'Italy', feature: 'Example', volume: '1 million coins', image: 'it.jpg' }))
        .replace('comm_2024.en.html', 'comm_2025.en.html');
    assert.deepEqual(parseCommemorativePage(bad, 'https://www.ecb.europa.eu/euro/coins/comm/html/comm_2025.en.html'), []);
    assert.equal(commonSide(2007, 'Italy'), OLD_COMMON_SIDE);
    assert.equal(commonSide(2007, 'Germany'), NEW_COMMON_SIDE);
    assert.equal(commonSide(2008, 'Italy'), NEW_COMMON_SIDE);
    assert.equal(mintageValue('16 million coins'), 16000000);
    assert.equal(mintageValue('1.5 million coins'), 1500000);
    assert.equal(mintageValue('not available'), null);
});

test('ecb migration records the primary catalog-only adapter and crawl delay', () => {
    const sql = fs.readFileSync(path.join(root, 'migrations', 'sql', '202609050007_ecb_source.sql'), 'utf8');
    const ingester = fs.readFileSync(path.join(root, 'catalog', 'ingest-ecb.js'), 'utf8');
    assert.match(sql, /adapter_key='ecb-primary'/);
    assert.match(sql, /price_role='none'/);
    assert.match(sql, /crawl-delay 5/);
    assert.match(ingester, /CRAWL_DELAY_MS = 5000/);
    assert.doesNotMatch(sql, /asking_price|sale_price|winning_bid/i);
});


'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { parseTitle } = require('../catalog/coin-matcher');
const { stageCatalogCandidate } = require('../catalog/catalog-candidates');
const { sampleItems } = require('../catalog/ingest-numizmat');
const {
    isUsableCoinProduct,
    parseNumizmatProduct,
    parseProductSitemap,
    parseSitemapIndex,
    sourceItemKeyFromUrl,
} = require('../catalog/numizmat-shop');

const root = path.resolve(__dirname, '..');

test('numizm.at discovery uses every official product sitemap', () => {
    const maps = parseSitemapIndex(`
      <loc>https://numizm.at/sitemap-files.xml</loc>
      <loc>https://numizm.at/sitemap-iblock-2.xml</loc>
      <loc>https://numizm.at/sitemap-iblock-2.part12.xml</loc>
    `);
    assert.deepEqual(maps, [
        'https://numizm.at/sitemap-iblock-2.xml',
        'https://numizm.at/sitemap-iblock-2.part12.xml',
    ]);
});

test('numizm.at sitemap selection keeps individual coin SKUs of every age and rejects other goods', () => {
    const items = parseProductSitemap(`
      <loc>https://numizm.at/catalog/products/m2_54172_1_dollar_2022_goda_ssha/</loc>
      <loc>https://numizm.at/catalog/products/k12_04111_denga_1389_1425_goda/</loc>
      <loc>https://numizm.at/catalog/products/37_rubley_50_kopeek_1902_goda_m1_3602/</loc>
      <loc>https://numizm.at/catalog/products/b2_0003_50_griven_2014_goda/</loc>
      <loc>https://numizm.at/catalog/products/m3_0949_nabor_monet_2016_goda/</loc>
    `);
    assert.deepEqual(items.map((item) => item.sourceItemKey), ['M2_54172', 'K12_04111', 'M1_3602']);
    assert.equal(sourceItemKeyFromUrl(items[1].sourceUrl), 'K12_04111');
});

test('numizm.at product parser keeps structured identity and both source photos but no price', () => {
    const html = `
      <link rel="canonical" href="https://numizm.at/catalog/products/m2_54172_coin/">
      <h1 class="product-title" itemprop="name">Монета 1 доллар 2022 года D США «Эли Паркер» [Артикул: M2-54172]</h1>
      <div class="product-sku">Арт. M2-54172</div>
      <div class="product-in-stock"><link itemprop="availability" href="http://schema.org/InStock">В наличии 13 шт.</div>
      <a class="link-avers" href="/upload/a.jpg"></a>
      <a class="link-revers" href="/upload/r.jpg"></a>
      <span itemprop="additionalProperty"><meta itemprop="name" content="Страна"><meta itemprop="value" content="США"></span>
      <span itemprop="additionalProperty"><meta itemprop="name" content="Номинал"><meta itemprop="value" content="1 доллар"></span>
      <span itemprop="additionalProperty"><meta itemprop="name" content="Год"><meta itemprop="value" content="2022"></span>
      <span itemprop="additionalProperty"><meta itemprop="name" content="Металл"><meta itemprop="value" content="Медно-никелевый сплав"></span>
      <span itemprop="additionalProperty"><meta itemprop="name" content="Вес"><meta itemprop="value" content="8,1 г"></span>
      <span itemprop="additionalProperty"><meta itemprop="name" content="Диаметр"><meta itemprop="value" content="26.5 мм"></span>
      <span itemprop="additionalProperty"><meta itemprop="name" content="Тираж"><meta itemprop="value" content="7.500 шт."></span>
      <span itemprop="additionalProperty"><meta itemprop="name" content="Состояние"><meta itemprop="value" content="UNC"></span>
      <span itemprop="additionalProperty"><meta itemprop="name" content="Тематика"><meta itemprop="value" content="История, Персоны"></span>
      <span class="price">295 руб.</span>
    `;
    const product = parseNumizmatProduct(html);
    assert.equal(product.sourceItemKey, 'M2_54172');
    assert.equal(product.itemStatus, 'active');
    assert.equal(product.country, 'США');
    assert.equal(product.denomination, '1 доллар');
    assert.equal(product.year, 2022);
    assert.equal(product.weightG, 8.1);
    assert.equal(product.diameterMm, 26.5);
    assert.equal(product.mintage, 7500);
    assert.deepEqual(product.themes, ['История', 'Персоны']);
    assert.equal(product.aversImageUrl, 'https://numizm.at/upload/a.jpg');
    assert.equal(product.reversImageUrl, 'https://numizm.at/upload/r.jpg');
    assert.equal(Object.hasOwn(product, 'price'), false);
    assert.equal(isUsableCoinProduct(product, parseTitle(product.title)), true);
});

test('numizm.at old archived individual coins remain usable catalog targets', () => {
    const product = parseNumizmatProduct(`
      <link rel="canonical" href="https://numizm.at/catalog/products/k10_0145_coin/">
      <h1 class="product-title" itemprop="name">Монета 1 рубль 1725 года СПБ [Артикул: K10-0145]</h1>
      <div class="product-sku">Арт. K10-0145</div>
      <link itemprop="availability" href="http://schema.org/OutOfStock">
      <span itemprop="additionalProperty"><meta itemprop="name" content="Год"><meta itemprop="value" content="1725"></span>
    `);
    assert.equal(product.itemStatus, 'archive');
    assert.equal(product.year, 1725);
    assert.equal(isUsableCoinProduct(product, parseTitle(product.title)), true);
});

test('numizm.at rejects explicit counterfeits and samples every era for a probe', () => {
    const counterfeit = {
        sourceItemKey: 'K12_99999',
        sourceUrl: 'https://numizm.at/catalog/products/k12_99999_coin/',
        title: 'Монета Полушка 1719 года Подделка в ущерб обращению',
    };
    assert.equal(isUsableCoinProduct(counterfeit, parseTitle(counterfeit.title)), false);
    const journal = {
        sourceItemKey: 'K10_14433',
        sourceUrl: 'https://numizm.at/catalog/products/k10_14433_journal/',
        title: 'Журнал «Летопись войны» (Выпуск 5)',
        denomination: null,
        year: null,
    };
    assert.equal(isUsableCoinProduct(journal, parseTitle(journal.title)), false);
    assert.deepEqual(sampleItems([0, 1, 2, 3, 4, 5, 6, 7, 8], 3), [0, 4, 8]);
});

test('numizm.at treats the structured period as a year for older coin cards', () => {
    const product = parseNumizmatProduct(`
      <link rel="canonical" href="https://numizm.at/catalog/products/k12_04111_coin/">
      <h1 class="product-title" itemprop="name">Монета Деньга 1389-1425 года [Артикул: K12-04111]</h1>
      <div class="product-sku">Арт. K12-04111</div>
      <span itemprop="additionalProperty"><meta itemprop="name" content="Период"><meta itemprop="value" content="1389-1425"></span>
    `);
    assert.equal(product.year, 1389);
});

test('shop catalog migration separates source cards from auction lots and price analytics', () => {
    const sql = fs.readFileSync(
        path.join(root, 'migrations', 'sql', '202609040005_catalog_source_items.sql'),
        'utf8',
    );
    const candidates = fs.readFileSync(path.join(root, 'catalog', 'catalog-candidates.js'), 'utf8');
    const ingester = fs.readFileSync(path.join(root, 'catalog', 'ingest-numizmat.js'), 'utf8');
    assert.match(sql, /CREATE TABLE catalog_source_item \(/);
    assert.match(sql, /CREATE TABLE catalog_source_item_type_link \(/);
    assert.match(sql, /num_nonnulls\(lot_id, source_item_id\) = 1/);
    assert.match(sql, /source_key='numizm\.at'/);
    assert.doesNotMatch(sql, /winning_bid|asking_price|sale_price/i);
    assert.match(candidates, /sourceItem/);
    assert.match(ingester, /sitemap\.xml/);
    assert.match(ingester, /--limit 0/);
    assert.doesNotMatch(ingester, /winning_bid|asking_price|sale_price/i);
});

test('a numizm.at catalog gap is attached directly to its source item', async () => {
    const calls = [];
    const db = {
        async query(sql, params) {
            calls.push({ sql, params });
            return { rows: [{ candidate_id: 7, observation_added: true }] };
        },
    };
    const result = await stageCatalogCandidate(db, {
        parsed: parseTitle('10 рублей 2025 Россия Город трудовой доблести'),
        matchReason: 'нет типа после проверки каталога',
        sourceItem: {
            id: 91,
            sourceSite: 'numizm.at',
            sourceItemKey: 'M2_99999',
            sourceUrl: 'https://numizm.at/catalog/products/m2_99999_coin/',
            itemStatus: 'archive',
            title: '10 рублей 2025 Россия Город трудовой доблести',
        },
    });
    assert.equal(result.staged, true);
    assert.equal(result.observationAdded, true);
    assert.match(calls.at(-1).sql, /source_item_id/);
    assert.equal(calls.at(-1).params[8], 91);
});

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { parseTitle } = require('../catalog/coin-matcher');
const { fetchText, intervalFetch } = require('../catalog/shop-source-ingester');
const {
    isUsableCoinProduct, parseNewsProducts, parseSitemapNewsUrls, parseUnicoinProduct,
} = require('../catalog/unicoin-catalog');

const root = path.resolve(__dirname, '..');

function productHtml(title = 'Армения 500 драм 2026 Сретение Господне', rows = {}) {
    const values = { Страна: 'Армения', Номинал: '500', Валюта: 'драм', Год: '2026', 'KM#': 'New_2026', Тираж: 'до 5000 шт.', Материал: 'Серебро', Вес: '15.55 г', Диаметр: '30.00 мм', Состояние: 'BU', ...rows };
    return `<div id="in"><h1>${title}</h1><table class="coin"><tr>
      <td><a href="/files/goods/70000/70300/70393/one.jpg">1</a></td>
      <td><a href="/files/goods/70000/70300/70393/two.jpg">2</a></td></tr>
      <tr><td class="price"><a class="add" href="/basket/?id_good=70393">В корзину</a></td></tr></table>
      <table class="dsc">${Object.entries(values).map(([key, value]) => `<tr><td><strong>${key}:</strong></td><td>${value}</td></tr>`).join('')}</table></div>`;
}

test('UniCoin discovery reads sitemap news and deduplicates product links', () => {
    const sitemap = '<urlset><url><loc>https://unicoin.ru/news/id/71862/</loc></url><url><loc>https://unicoin.ru/cat/coins/</loc></url></urlset>';
    assert.deepEqual(parseSitemapNewsUrls(sitemap), ['https://www.unicoin.ru/news/id/71862/']);
    const items = parseNewsProducts('<a href="/cat/id/70393/">x</a><a href="/cat/id/70393/">x</a><a href="/cat/id/41942/archive/">y</a>');
    assert.deepEqual(items.map((item) => item.sourceItemKey), ['70393', '41942']);
});

test('UniCoin parser reads structured identity and excludes prices', () => {
    const product = parseUnicoinProduct(productHtml(), 'https://www.unicoin.ru/cat/id/70393/');
    assert.equal(product.sourceItemKey, '70393');
    assert.equal(product.itemStatus, 'active');
    assert.equal(product.country, 'Армения');
    assert.equal(product.denomination, '500 драм');
    assert.equal(product.year, 2026);
    assert.equal(product.mintage, 5000);
    assert.equal(product.weightG, 15.55);
    assert.equal(product.diameterMm, 30);
    assert.equal(product.attributes.price, undefined);
    assert.match(product.aversImageUrl, /one\.jpg$/);
    assert.equal(isUsableCoinProduct(product, parseTitle(product.matchTitle)), true);
});

test('UniCoin keeps archived individual coins and rejects sets and accessories', () => {
    const archivedHtml = productHtml('Армения 100 драм 2008 Дикий козел').replace('class="price"', 'class="price price-gray"').replace('class="add"', 'class="wlist"');
    const archived = parseUnicoinProduct(archivedHtml, 'https://www.unicoin.ru/cat/id/24150/archive/');
    assert.equal(archived.itemStatus, 'archive');
    assert.equal(isUsableCoinProduct(archived, parseTitle(archived.matchTitle)), true);
    const set = parseUnicoinProduct(productHtml('Набор 7 монет Армения 2026'), 'https://www.unicoin.ru/cat/id/1/');
    assert.equal(isUsableCoinProduct(set, parseTitle(set.matchTitle)), false);
    const album = parseUnicoinProduct(productHtml('Альбом для 9 монет США 2026'), 'https://www.unicoin.ru/cat/id/2/');
    assert.equal(isUsableCoinProduct(album, parseTitle(album.matchTitle)), false);
});

test('shared fetch decodes declared windows-1251 pages', async () => {
    const bytes = Uint8Array.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]);
    const fetchImpl = async () => ({
        ok: true,
        headers: { get: () => 'text/html; charset=windows-1251' },
        arrayBuffer: async () => bytes.buffer,
        text: async () => 'wrong',
    });
    assert.equal(await fetchText('https://example.test', fetchImpl), 'Привет');
});

test('shared request interval serializes request starts', async () => {
    const starts = [];
    const limited = intervalFetch(async () => { starts.push(Date.now()); return { ok: true }; }, 15);
    await Promise.all([limited('a'), limited('b'), limited('c')]);
    assert.ok(starts[1] - starts[0] >= 10);
    assert.ok(starts[2] - starts[1] >= 10);
});

test('UniCoin migration records the crawl and catalog-only boundaries', () => {
    const sql = fs.readFileSync(path.join(root, 'migrations', 'sql', '202609050010_unicoin_source.sql'), 'utf8');
    assert.match(sql, /adapter_key='unicoin-news-html'/);
    assert.match(sql, /five-second crawl delay/);
    assert.match(sql, /\/start\/ remains excluded/);
    assert.match(sql, /price_role='none'/);
    assert.doesNotMatch(sql, /asking_price|sale_price|winning_bid/i);
});

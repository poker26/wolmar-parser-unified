'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { parseTitle } = require('../catalog/coin-matcher');
const {
    isUsableCoinProduct, parseModernCoinUrls, parseMonetnikProduct, parseSitemapIndex,
} = require('../catalog/monetnik-catalog');

const root = path.resolve(__dirname, '..');

test('Monetnik sitemap selects only post-2018 coin product URLs', () => {
    const index = '<loc>https://www.monetnik.ru/sitemap.xml/www.monetnik.ru_0.xml</loc><loc>https://evil.test/x.xml</loc>';
    assert.equal(parseSitemapIndex(index).length, 1);
    const xml = `<loc>https://www.monetnik.ru/monety/mira/horvatiya/horvatiya-2-evro-2026-100-913298/</loc>
      <loc>https://www.monetnik.ru/monety/mira/franciya/franciya-1-frank-2018-22/</loc>
      <loc>https://www.monetnik.ru/monety/mira/franciya/franciya-1-frank-bez-goda-44/</loc>
      <loc>https://www.monetnik.ru/banknoty/rossii/100-rublej-2025-33/</loc>`;
    assert.deepEqual(parseModernCoinUrls(xml).map((item) => item.sourceItemKey), ['913298']);
});

test('Monetnik parser reads coin properties and media but no offer prices', () => {
    const html = `<link rel="canonical" href="https://www.monetnik.ru/monety/mira/horvatiya/horvatiya-2-evro-2026-100-913298/">
      <h1 class="view__title">Хорватия 2 евро 2026 «100 лет радио»</h1><meta itemprop="sku" content="913298">
      <div class="product-hero__imglist"><a data-zoom-image="//cdn.monetnik.ru/a_big.jpg"></a><a data-zoom-image="//cdn.monetnik.ru/b_big.jpg"></a></div>
      <link itemprop="availability" href="http://schema.org/InStock">
      ${[['Сохранность','BUNC'],['Год','2026 г.'],['Номинал','2 евро'],['Диаметр (мм)','25.75'],['Тираж (шт)','195000'],['Материал','Биметалл'],['Вес предмета (г)','8,5']].map(([k,v]) => `<li itemprop="additionalProperty"><span itemprop="name">${k}:</span><span itemprop="value">${v}</span></li>`).join('')}
      <meta itemprop="price" content="1797">`;
    const product = parseMonetnikProduct(html);
    assert.equal(product.sourceItemKey, '913298');
    assert.equal(product.country, 'Хорватия');
    assert.equal(product.year, 2026);
    assert.equal(product.denomination, '2 евро');
    assert.equal(product.mintage, 195000);
    assert.equal(product.weightG, 8.5);
    assert.equal(product.diameterMm, 25.75);
    assert.equal(product.attributes.price, undefined);
    assert.equal(isUsableCoinProduct(product, parseTitle(product.matchTitle)), true);
});

test('Monetnik rejects sets and pre-2019 cards', () => {
    const base = { sourceItemKey: '1', sourceUrl: 'https://www.monetnik.ru/monety/x-1/', title: 'Набор 3 монеты 2026', year: 2026, denomination: '2 евро', aversImageUrl: 'a', reversImageUrl: 'b' };
    assert.equal(isUsableCoinProduct(base, parseTitle(base.title)), false);
    const old = { ...base, title: 'Франция 2 евро 2018', year: 2018 };
    assert.equal(isUsableCoinProduct(old, parseTitle(old.title)), false);
});

test('Monetnik migration records the modern catalog-only boundary', () => {
    const sql = fs.readFileSync(path.join(root, 'migrations', 'sql', '202609050011_monetnik_source.sql'), 'utf8');
    assert.match(sql, /adapter_key='monetnik-modern-html'/);
    assert.match(sql, /year from 2019 onward/);
    assert.match(sql, /price_role='none'/);
    assert.doesNotMatch(sql, /asking_price|sale_price|winning_bid/i);
});

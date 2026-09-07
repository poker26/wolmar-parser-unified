'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { parseTitle } = require('../catalog/coin-matcher');
const p = require('../catalog/coinsmart-catalog');

test('Coinsmart sitemap keeps flat product cards and excludes categories', () => {
    assert.equal(p.parseSitemapIndex('<loc>https://coinsmart.ru/sitemap-shop-1.xml</loc><loc>https://coinsmart.ru/sitemap-blog.xml</loc>').length, 1);
    const xml = '<loc>https://coinsmart.ru/moneta-50-tsentov-2025-god-kyurasao/</loc><loc>https://coinsmart.ru/category/monety/</loc>';
    assert.deepEqual(p.parseProductUrls(xml).map((x) => x.sourceItemKey), ['moneta-50-tsentov-2025-god-kyurasao']);
});

test('Coinsmart reads coin identity and two gallery sides without price', () => {
    const html = `<nav class="breadcrumbs"><a href="/category/monety/">Монеты</a><a href="/category/monety/kyurasao/">Кюрасао</a></nav>
      <article class="product-wrapper" itemtype="http://schema.org/Product"><h1><span itemprop="name">Монета 50 центов. 2025 год, Кюрасао.</span></h1>
      <input name="product_id" value="41879"><link itemprop="availability" href="http://schema.org/InStock">
      <figure class="product-gallery"><a href="/wa-data/public/shop/products/1/a.970.jpg"></a><a href="/wa-data/public/shop/products/1/a.970.jpg"></a><a href="/wa-data/public/shop/products/1/b.970.jpg"></a></figure>
      <table id="product-features">${[['Номинал:','50 центов'],['Год:','2025'],['Материал:','сталь плакированная никелем'],['Диаметр, мм:','22,25'],['Вес, г:','4,45'],['Тираж:','15 000'],['Состояние :','на скане']].map(([k,v]) => `<tr><td class="name">${k}</td><td class="value">${v}</td></tr>`).join('')}</table><meta itemprop="price" content="300"></article>`;
    const x = p.parseProduct(html, 'https://coinsmart.ru/moneta-50-tsentov-2025-god-kyurasao/');
    assert.equal(x.country, 'Кюрасао'); assert.equal(x.year, 2025); assert.equal(x.denomination, '50 центов');
    assert.equal(x.weightG, 4.45); assert.equal(x.diameterMm, 22.25); assert.equal(x.mintage, 15000);
    assert.equal(x.aversImageUrl, 'https://coinsmart.ru/wa-data/public/shop/products/1/a.970.jpg');
    assert.equal(x.reversImageUrl, 'https://coinsmart.ru/wa-data/public/shop/products/1/b.970.jpg');
    assert.equal(x.attributes.price, undefined); assert.equal(p.usable(x, parseTitle(x.matchTitle)), true);
});

test('Coinsmart rejects adjacent Webasyst goods and sets', () => {
    const coin = { sourceItemKey: 'old', title: 'Франция 2 франка 1916', denomination: '2 франка', year: 1916, aversImageUrl: 'a', reversImageUrl: 'b', attributes: { coin_category: true } };
    assert.equal(p.usable(coin, parseTitle(coin.title)), true);
    assert.equal(p.usable({ ...coin, attributes: { coin_category: false } }, parseTitle(coin.title)), false);
    assert.equal(p.usable({ ...coin, title: 'Набор монет Франции 1916' }, parseTitle('Набор монет Франции 1916')), false);
});

test('Coinsmart migration preserves the full archive and excludes prices', () => {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', 'sql', '202609060003_coinsmart_source.sql'), 'utf8');
    assert.match(sql, /complete old and modern product archive/); assert.match(sql, /price_role='none'/);
    assert.doesNotMatch(sql, /asking_price|sale_price|winning_bid/i);
});

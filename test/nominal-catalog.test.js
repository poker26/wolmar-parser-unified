'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { parseTitle } = require('../catalog/coin-matcher');
const p = require('../catalog/nominal-catalog');

test('Nominal sitemap keeps dated old and modern product cards but not catalog sections', () => {
    const index = '<loc>https://nominal.club/sitemap-shop-12.xml</loc><loc>https://nominal.club/sitemap-blog.xml</loc>';
    assert.deepEqual(p.parseSitemapIndex(index), ['https://nominal.club/sitemap-shop-12.xml']);
    const xml = `<url><loc>https://nominal.club/category/monety/frantsiya-2-franka-1916-god/</loc><priority>0.8</priority></url>
      <url><loc>https://nominal.club/category/monety/frantsiya-2-evro-2026-god-yubiley/</loc><priority>0.8</priority></url>
      <url><loc>https://nominal.club/category/monety/rossiya-1812-goda/</loc><priority>0.6</priority></url>
      <url><loc>https://nominal.club/category/monety/1500-frankov-kfa/</loc><priority>0.8</priority></url>
      <url><loc>https://nominal.club/category/zhetony/zheton-2026-god/</loc><priority>0.8</priority></url>`;
    assert.equal(p.parseDatedCoinUrls(xml).length, 2);
});

test('Nominal parser reads product characteristics and photos without prices', () => {
    const html = `<link rel="canonical" href="https://nominal.club/category/monety/velikobritaniya-5-funtov-2026-god-portret/"><h1>Великобритания 5 фунтов 2026 год. Портрет</h1>
      <link itemprop="availability" href="http://schema.org/InStock"><div class="c-product-images"><div class="c-product-images__images"><div class="c-product-images__image"><a href="/wa-data/public/shop/products/1/a.970.jpg"></a></div><div class="c-product-images__image"><a href="/wa-data/public/shop/products/1/b.970.jpg"></a></div></div></div>
      <div class="c-product-features">${[['Страна','Великобритания'],['Год','2026'],['Номинал','5 фунтов'],['Состав','Медь-Никель'],['Вес','28.28 г'],['Диаметр','38,61'],['Качество','BU'],['Тираж','15.000']].map(([k,v]) => `<div class="c-product-feature_product-card"><span class="c-product-feature__name">${k}<span class="tip">подсказка</span></span><div class="c-product-feature__value">${v}</div></div>`).join('')}</div><meta itemprop="price" content="3038">`;
    const product = p.parseProduct(html);
    assert.equal(product.country, 'Великобритания');
    assert.equal(product.year, 2026);
    assert.equal(product.denomination, '5 фунтов');
    assert.equal(product.weightG, 28.28);
    assert.equal(product.diameterMm, 38.61);
    assert.equal(product.mintage, 15000);
    assert.equal(product.attributes.price, undefined);
    assert.equal(p.usable(product, parseTitle(product.matchTitle)), true);
});

test('Nominal accepts an old single coin and rejects sets', () => {
    const product = { sourceItemKey: 'category/monety/x', sourceUrl: 'https://nominal.club/category/monety/x/', title: 'Франция 2 франка 1916 год', country: 'Франция', denomination: '2 франка', year: 1916, aversImageUrl: 'a', reversImageUrl: 'b' };
    assert.equal(p.usable(product, parseTitle(product.title)), true);
    assert.equal(p.usable({ ...product, title: 'Набор монет Франции 1916 года' }, parseTitle('Набор монет Франции 1916 года')), false);
});

test('Nominal migration keeps old listings and excludes prices', () => {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', 'sql', '202609050015_nominal_source.sql'), 'utf8');
    assert.match(sql, /including old and unavailable listings/);
    assert.match(sql, /price_role='none'/);
    assert.doesNotMatch(sql, /asking_price|sale_price|winning_bid/i);
});

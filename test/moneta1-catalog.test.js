'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { parseTitle } = require('../catalog/coin-matcher');
const p = require('../catalog/moneta1-catalog');

test('Moneta1 sitemap keeps every product URL and excludes categories', () => {
    assert.equal(p.parseSitemapIndex('<loc>https://moneta1.ru/sitemap-shop-1.xml</loc><loc>https://moneta1.ru/sitemap-blog.xml</loc>').length, 1);
    const xml = '<loc>https://moneta1.ru/product/50-tsentov-ssha-2026-goda/</loc><loc>https://moneta1.ru/product/2-franka-1916-goda/</loc><loc>https://moneta1.ru/category/monety/</loc>';
    assert.deepEqual(p.parseProductUrls(xml).map((x) => x.sourceItemKey), ['50-tsentov-ssha-2026-goda', '2-franka-1916-goda']);
});

test('Moneta1 parser reads structured identity and two photos without price', () => {
    const html = `<h1>50 центов США 2026 года. 250 лет независимости</h1><link itemprop="availability" href="http://schema.org/InStock">
      <a class="p-images__slider-item" href="/wa-data/public/shop/products/1/a.970.jpg"></a><a class="p-images__slider-item" href="/wa-data/public/shop/products/1/b.970.jpg"></a>
      <div class="features">${[['Страна','США'],['Номинал США','50 центов (1/2 доллара)'],['Год','2026'],['Состояние','UNC'],['Металл','Медь'],['Диаметр монеты','30,61 мм'],['Вес','11.34 г'],['Тираж','15.000']].map(([k,v]) => `<div class="features-two-val__block"><div class="features-two-val__name">${k}</div><div class="features-two-val__value">${v}</div></div>`).join('')}</div><meta itemprop="price" content="800">`;
    const product = p.parseProduct(html, 'https://moneta1.ru/product/50-tsentov-ssha-2026-goda/');
    assert.equal(product.country, 'США'); assert.equal(product.year, 2026); assert.equal(product.denomination, '50 центов (1/2 доллара)');
    assert.equal(product.weightG, 11.34); assert.equal(product.diameterMm, 30.61); assert.equal(product.mintage, 15000);
    assert.equal(product.attributes.price, undefined); assert.equal(p.usable(product, parseTitle(product.matchTitle)), true);
});

test('Moneta1 keeps an old single coin and rejects sets', () => {
    const x = { sourceItemKey: 'old', title: 'Франция 2 франка 1916', country: 'Франция', denomination: '2 франка', year: 1916, aversImageUrl: 'a', reversImageUrl: 'b' };
    assert.equal(p.usable(x, parseTitle(x.title)), true);
    assert.equal(p.usable({ ...x, title: 'Набор монет Франции 1916' }, parseTitle('Набор монет Франции 1916')), false);
});

test('source migrations block unsafe TLS and keep Moneta1 prices out', () => {
    const tls = fs.readFileSync(path.join(__dirname, '..', 'migrations', 'sql', '202609050016_monetarus_access.sql'), 'utf8');
    const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', 'sql', '202609050017_moneta1_source.sql'), 'utf8');
    assert.match(tls, /status='blocked'/); assert.match(tls, /Do not disable TLS verification/);
    assert.match(sql, /complete old and modern product archive/); assert.match(sql, /price_role='none'/);
    assert.doesNotMatch(sql, /asking_price|sale_price|winning_bid/i);
});

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { parseTitle } = require('../catalog/coin-matcher');
const p = require('../catalog/vmiremonet-catalog');

test('V mire monet sitemap selects old and modern individual coin URLs', () => {
    const index = '<loc>https://vmiremonet.ru/sitemap-shop-1.xml</loc><loc>https://vmiremonet.ru/sitemap-blog.xml</loc>';
    assert.deepEqual(p.parseSitemapIndex(index), ['https://vmiremonet.ru/sitemap-shop-1.xml']);
    const xml = `<loc>https://vmiremonet.ru/moneta-lyuksemburg-2-evro-2026-god-yubiley/</loc>
      <loc>https://vmiremonet.ru/moneta-frantsiya-2-evro-2018-god/</loc>
      <loc>https://vmiremonet.ru/zheton-spmd-2026-god/</loc>
      <loc>https://evil.test/moneta-2-evro-2026-god/</loc>`;
    assert.deepEqual(p.parseCoinUrls(xml).map((item) => item.sourceItemKey), ['moneta-lyuksemburg-2-evro-2026-god-yubiley', 'moneta-frantsiya-2-evro-2018-god']);
});

test('V mire monet parser reads identity fields and full-size coin photos without prices', () => {
    const html = `<h1 class="product-name"><span itemprop="name">Монета. Люксембург. 2 евро 2026 год. Юбилей.</span></h1>
      <link itemprop="availability" href="http://schema.org/InStock">
      <figure class="product-gallery-wrap"><a href="/wa-data/public/shop/products/1/a.970.jpg"><img src="a.jpg"></a><a href="/wa-data/public/shop/products/1/b.970.jpg"><img src="b.jpg"></a></figure>
      <table class="features">${[['Страна эмитент','Люксембург'],['Номинал цифра','2'],['Номинал название','евро'],['Год выпуска','2026'],['Материал','Биметалл'],['Состояние','UNC'],['Тираж','120.000'],['Вес','8.5 г'],['Диаметр','25.75 мм'],['Тематика','Юбилейная']].map(([k,v]) => `<tr><td class="name">${k}</td><td class="value">${v}</td></tr>`).join('')}</table><meta itemprop="price" content="1900">`;
    const product = p.parseProduct(html, 'https://vmiremonet.ru/moneta-lyuksemburg-2-evro-2026-god-yubiley/');
    assert.equal(product.year, 2026);
    assert.equal(product.country, 'Люксембург');
    assert.equal(product.denomination, '2 евро');
    assert.equal(product.mintage, 120000);
    assert.equal(product.weightG, 8.5);
    assert.equal(product.diameterMm, 25.75);
    assert.equal(product.itemStatus, 'active');
    assert.equal(product.attributes.price, undefined);
    assert.equal(product.aversImageUrl, 'https://vmiremonet.ru/wa-data/public/shop/products/1/a.970.jpg');
    assert.equal(product.reversImageUrl, 'https://vmiremonet.ru/wa-data/public/shop/products/1/b.970.jpg');
    assert.equal(p.usable(product, parseTitle(product.matchTitle)), true);
});

test('V mire monet rejects sets and cards without two coin photos', () => {
    const product = { sourceItemKey: 'x', sourceUrl: 'https://vmiremonet.ru/x/', title: 'Набор монет Люксембург 2026', country: 'Люксембург', denomination: '2 евро', year: 2026, aversImageUrl: 'a', reversImageUrl: 'b' };
    assert.equal(p.usable(product, parseTitle(product.title)), false);
    assert.equal(p.usable({ ...product, title: 'Люксембург 2 евро 2026', reversImageUrl: null }, parseTitle('Люксембург 2 евро 2026')), false);
});

test('V mire monet keeps old exact-year coin cards', () => {
    const product = { sourceItemKey: 'old', sourceUrl: 'https://vmiremonet.ru/moneta-old/', title: 'Франция 2 франка 1916', country: 'Франция', denomination: '2 франка', year: 1916, aversImageUrl: 'a', reversImageUrl: 'b' };
    assert.equal(p.usable(product, parseTitle(product.title)), true);
});

test('V mire monet migration records the catalog-only boundary', () => {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', 'sql', '202609050014_vmiremonet_source.sql'), 'utf8');
    const correction = fs.readFileSync(path.join(__dirname, '..', 'migrations', 'sql', '202609060005_full_archive_scope.sql'), 'utf8');
    assert.match(sql, /adapter_key='vmiremonet-modern-html'/);
    assert.match(sql, /Current, unavailable and old listing cards remain eligible/);
    assert.match(sql, /price_role='none'/);
    assert.match(correction, /adapter_key='vmiremonet-html'/);
    assert.match(correction, /There is no lower issue-year boundary/);
    assert.doesNotMatch(sql, /asking_price|sale_price|winning_bid/i);
});

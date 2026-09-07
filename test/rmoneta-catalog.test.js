'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { parseTitle } = require('../catalog/coin-matcher');
const p = require('../catalog/rmoneta-catalog');

test('rmoneta normalizes HTTP sitemap URLs and keeps numeric product leaves', () => {
    assert.deepEqual(p.parseSitemapIndex('<loc>http://www.rmoneta.ru/sitemap_iblock_7.xml</loc><loc>http://www.rmoneta.ru/sitemap_iblock_1.xml</loc>'), ['https://www.rmoneta.ru/sitemap_iblock_7.xml']);
    const xml = '<loc>http://www.rmoneta.ru/catalog/inostrangnye_monety/monety_frantsii/5809/</loc><loc>http://www.rmoneta.ru/catalog/inostrangnye_monety/monety_frantsii/</loc><loc>http://www.rmoneta.ru/news/5809/</loc>';
    assert.deepEqual(p.parseProductUrls(xml).map((x) => x.sourceItemKey), ['5809']);
});

test('rmoneta reads an old coin and its composite two-side source image without price', () => {
    const html = `<ul class="breadcrumb-navigation"><li><a>Каталог монет и аксессуаров</a></li><li><a>Иностранные монеты</a></li><li><a>Монеты Франции</a></li></ul>
      <div itemtype="http://schema.org/Product" class="catalogElement prod5809"><h1 itemprop="name">5 франков Франция 1874</h1><span class="avalible">в наличии</span>
      <a href="/upload/iblock/42a/coin.jpg" class="galerytovar"><img itemprop="image"></a><meta itemprop="price" content="5400"></div>
      <table class="haraktAll">${[['Описание состояния','Хорошее состояние'],['Материал','Серебро'],['Вес (г)','25'],['Проба','900'],['Диаметр (мм)','37'],['Тираж','15 000']].map(([k,v]) => `<tr><td class="name">${k}</td><td>${v}</td></tr>`).join('')}</table>`;
    const x = p.parseProduct(html, 'http://www.rmoneta.ru/catalog/inostrangnye_monety/monety_frantsii/5809/');
    assert.equal(x.country, 'Франции'); assert.equal(x.year, 1874); assert.equal(x.denomination, '5 франков');
    assert.equal(x.weightG, 25); assert.equal(x.diameterMm, 37); assert.equal(x.mintage, 15000);
    assert.equal(x.aversImageUrl, 'https://www.rmoneta.ru/upload/iblock/42a/coin.jpg'); assert.equal(x.reversImageUrl, null);
    assert.equal(x.attributes.composite_sides_image, true); assert.equal(x.attributes.price, undefined);
    assert.equal(p.usable(x, parseTitle(x.matchTitle)), true);
});

test('rmoneta keeps archived exact-year coins and rejects uncertain dates and sets', () => {
    const coin = { sourceItemKey: '5887', title: 'Денежка 1863 ем', denomination: 'денежка', year: 1863, aversImageUrl: 'a', attributes: { composite_sides_image: true } };
    assert.equal(p.usable(coin, parseTitle(coin.title)), true);
    assert.equal(p.usable({ ...coin, year: null, title: '1/24 талера Швеция 163х' }, parseTitle('1/24 талера Швеция 163х')), false);
    assert.equal(p.usable({ ...coin, title: 'Набор монет Франции 1916' }, parseTitle('Набор монет Франции 1916')), false);
});

test('rmoneta migration includes the archive and excludes prices', () => {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', 'sql', '202609060004_rmoneta_source.sql'), 'utf8');
    assert.match(sql, /including the large archive/); assert.match(sql, /price_role='none'/);
    assert.doesNotMatch(sql, /asking_price|sale_price|winning_bid/i);
});

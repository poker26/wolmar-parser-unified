'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { parseTitle } = require('../catalog/coin-matcher');
const {
    hasPrimaryYearRange,
    isUsableCoinProduct,
    parseProductSitemap,
    parseVsemonetyProduct,
    singleTitleYear,
} = require('../catalog/vsemonety-catalog');

const root = path.resolve(__dirname, '..');

function card({ title, url, properties, productId = '1883' }) {
    const features = Object.entries(properties).map(([name, value]) => `
      <div class="ty-product-feature">
        <span class="ty-product-feature__label">${name}:</span>
        <div class="ty-product-feature__value">${value}</div>
      </div>`).join('');
    return `
      <link rel="canonical" href="${url}"><h1>${title}</h1>
      <div itemscope itemtype="http://schema.org/Product">
        <input name="product_data[${productId}][product_id]" value="${productId}">
        <div id="product_images_${productId}">
          <a class="cm-image-previewer" href="/images/detailed/10/coin.png"></a>
        </div>
        ${features}
        <span class="ty-price">75 000 ₽</span>
      </div>`;
}

test('vsemonety sitemap retains public paths and removes duplicates and foreign hosts', () => {
    const items = parseProductSitemap(`
      <loc>https://всемонеты.рф/серебряная-монета-сш/</loc>
      <loc>https://xn--b1aga1affsn5f.xn--p1ai/серебряная-монета-сш/</loc>
      <loc>https://example.com/coin/</loc>
    `);
    assert.equal(items.length, 1);
    assert.match(items[0].sourceUrl, /^https:\/\/xn--b1aga1affsn5f\.xn--p1ai\//);
});

test('vsemonety parser keeps coin identity and one composite image but excludes prices', () => {
    const product = parseVsemonetyProduct(card({
        title: '1 доллар 2014 года «Американский Орел» (серебро, США)',
        url: 'https://xn--b1aga1affsn5f.xn--p1ai/серебряная-инвестиционная-монета-сш/',
        properties: {
            'Денежная единица': 'Доллар', 'Диаметр, мм': '40,6', 'Качество': 'Proof',
            'Масса монеты, гр': '31,1', 'Метал': 'серебро', 'Монетный двор': 'Вест-Поинта',
            'Номинал': '1', 'Страна': 'США', 'Цена': '75 000 ₽',
        },
    }));
    assert.equal(product.year, 2014);
    assert.equal(product.weightG, 31.1);
    assert.equal(product.diameterMm, 40.6);
    assert.equal(product.itemStatus, 'unknown');
    assert.equal(product.aversImageUrl, 'https://xn--b1aga1affsn5f.xn--p1ai/images/detailed/10/coin.png');
    assert.equal(product.reversImageUrl, null);
    assert.equal(product.attributes['Цена'], undefined);
    assert.equal(Object.hasOwn(product, 'price'), false);
    assert.equal(isUsableCoinProduct(product, parseTitle(`${product.title} ${product.country}`)), true);
});

test('vsemonety rejects year ranges, sets and non-product pages', () => {
    assert.equal(singleTitleYear('25 долларов 2017-2022 годов'), null);
    assert.equal(singleTitleYear('10000 рублей 2007 год'), 2007);
    assert.equal(hasPrimaryYearRange('50 долларов 1997-1998 годов, Коала'), true);
    assert.equal(hasPrimaryYearRange('10 долларов 2011 года, Джулия Грант (1869-1877)'), false);
    const range = parseVsemonetyProduct(card({
        title: '25 долларов 2017-2022 годов, орел', url: 'https://xn--b1aga1affsn5f.xn--p1ai/range/',
        properties: { 'Номинал': '25', 'Страна': 'США' },
    }));
    assert.equal(isUsableCoinProduct(range, parseTitle(range.title)), false);
    const set = parseVsemonetyProduct(card({
        title: 'Набор 5 рублей 2022 года', url: 'https://xn--b1aga1affsn5f.xn--p1ai/set/',
        properties: { 'Номинал': '5', 'Страна': 'Россия' },
    }));
    assert.equal(isUsableCoinProduct(set, parseTitle(set.title)), false);
    const category = parseVsemonetyProduct('<h1>Монеты США</h1>', 'https://xn--b1aga1affsn5f.xn--p1ai/монеты/');
    assert.equal(isUsableCoinProduct(category, parseTitle(category.title)), false);
    const bond = parseVsemonetyProduct(card({
        title: '4 руб. 21 7/8 коп. 1906. 5% государственный займ', url: 'https://xn--b1aga1affsn5f.xn--p1ai/bond/',
        properties: { 'Год': '1906', 'Номинал': '4', 'Страна': 'Россия' },
    }));
    assert.equal(isUsableCoinProduct(bond, parseTitle(bond.title)), false);
});

test('vsemonety accepts a coin when optional country or structured denomination is absent', () => {
    const product = parseVsemonetyProduct(card({
        title: '2 копейки 1776 года, Екатерина 2', url: 'https://xn--b1aga1affsn5f.xn--p1ai/2-копейки-1776/',
        properties: { 'Год': '1776', 'Металл': 'медь', 'Масса монеты, гр': '20,48' },
    }));
    assert.equal(product.country, null);
    assert.equal(product.denomination, null);
    assert.equal(isUsableCoinProduct(product, parseTitle(product.title)), true);
});

test('vsemonety migration configures a catalog-only weekly source', () => {
    const sql = fs.readFileSync(path.join(root, 'migrations', 'sql', '202609050003_vsemonety_source.sql'), 'utf8');
    const ingester = fs.readFileSync(path.join(root, 'catalog', 'ingest-vsemonety.js'), 'utf8');
    assert.match(sql, /adapter_key='vsemonety-catalog'/);
    assert.match(sql, /source_key='xn--b1aga1affsn5f\.xn--p1ai'/);
    assert.match(sql, /interval '7 days'/);
    assert.doesNotMatch(sql, /asking_price|sale_price|winning_bid/i);
    assert.match(ingester, /sitemap\.xml/);
});

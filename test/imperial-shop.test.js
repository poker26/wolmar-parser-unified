'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { parseTitle } = require('../catalog/coin-matcher');
const { isUsableCoinProduct, parseImperialProduct, parseProductSitemap } = require('../catalog/imperial-shop');

const root = path.resolve(__dirname, '..');

function card({ title, url, status, properties, article = '25-07-25-94' }) {
    const rows = Object.entries(properties).map(([name, value]) => `
      <tr class="product-property-list__row">
        <td class="product-property-list__column product-property-list__column--title"><span>${name}</span></td>
        <td class="product-property-list__column">${value}</td>
      </tr>`).join('');
    return `
      <link rel="canonical" href="${url}"><h1>${title}</h1>
      <div class="product-info-price-sticky">
        <div class="product-info-price-sticky__info">${status === 'active' ? '\u0422\u043e\u0432\u0430\u0440 \u0432 \u043d\u0430\u043b\u0438\u0447\u0438\u0438: 1 \u0448\u0442.' : ''} \u0410\u0440\u0442\u0438\u043a\u0443\u043b: ${article}</div>
        ${status === 'archive' ? '<button class="product-info-price-sticky__button-disabled">\u041d\u0435\u0442 \u0432 \u043d\u0430\u043b\u0438\u0447\u0438\u0438</button>' : ''}
      </div><table>${rows}</table>
      <a class="product-gallery__thumb-link" href="/img/a/original/avers.jpg?signed=a"></a>
      <a class="product-gallery__thumb-link" href="/img/r/original/revers.jpg?signed=r"></a>
      <meta name="product:price:amount" content="8500">
    `;
}

test('imperial sitemap keeps every coin path and excludes other catalog sections', () => {
    const items = parseProductSitemap(`
      <loc>http://imperial-mag.ru/monety/imperia/nikolaj-1/denezhka-1853-em</loc>
      <loc>https://imperial-mag.ru/monety/mir/evropa/velikobritaniya/2-funta-2025</loc>
      <loc>https://imperial-mag.ru/banknoty/rossiya/100-rublej</loc>
    `);
    assert.deepEqual(items.map((item) => item.sourceItemKey), [
        'imperia/nikolaj-1/denezhka-1853-em',
        'mir/evropa/velikobritaniya/2-funta-2025',
    ]);
    assert.match(items[0].sourceUrl, /^https:/);
});

test('imperial parser keeps an active old coin and ignores every price field', () => {
    const product = parseImperialProduct(card({
        title: '\u041c\u043e\u043d\u0435\u0442\u0430 \u0414\u0435\u043d\u0435\u0436\u043a\u0430 1853 \u0415\u041c',
        url: 'https://imperial-mag.ru/monety/imperia/nikolaj-1/denezhka-1853-em',
        status: 'active', article: '24-04-26-594',
        properties: {
            '\u041c\u0435\u0442\u0430\u043b\u043b': '\u041c\u0435\u0434\u044c', '\u0413\u043e\u0434': '1853', '\u041d\u043e\u043c\u0438\u043d\u0430\u043b': '\u0414\u0435\u043d\u0435\u0436\u043a\u0430', '\u0421\u0442\u0440\u0430\u043d\u0430': '\u0420\u043e\u0441\u0441\u0438\u0439\u0441\u043a\u0430\u044f \u0418\u043c\u043f\u0435\u0440\u0438\u044f',
            '\u0421\u043e\u0445\u0440\u0430\u043d\u043d\u043e\u0441\u0442\u044c': 'VF', '\u0412\u0435\u0441, \u0433': '2.56 \u0433.', '\u0414\u0438\u0430\u043c\u0435\u0442\u0440, \u043c\u043c': '17,9', '\u0422\u0438\u0440\u0430\u0436, \u0448\u0442': '12243200',
            '\u0426\u0435\u043d\u0430 \u043c\u0435\u0442\u0430\u043b\u043b\u0430': '220 x 0.45 = 99 \u20bd',
        },
    }));
    assert.equal(product.itemStatus, 'active');
    assert.equal(product.year, 1853);
    assert.equal(product.weightG, 2.56);
    assert.equal(product.diameterMm, 17.9);
    assert.equal(product.mintage, 12243200);
    assert.equal(product.attributes['\u0410\u0440\u0442\u0438\u043a\u0443\u043b'], '24-04-26-594');
    assert.equal(product.attributes['\u0426\u0435\u043d\u0430 \u043c\u0435\u0442\u0430\u043b\u043b\u0430'], undefined);
    assert.equal(Object.hasOwn(product, 'price'), false);
    assert.equal(product.aversImageUrl, 'https://imperial-mag.ru/img/a/original/avers.jpg?signed=a');
    assert.equal(product.reversImageUrl, 'https://imperial-mag.ru/img/r/original/revers.jpg?signed=r');
    assert.equal(isUsableCoinProduct(product, parseTitle(product.title)), true);
});

test('imperial unavailable modern coin remains a catalog target', () => {
    const product = parseImperialProduct(card({
        title: '\u041c\u043e\u043d\u0435\u0442\u0430 2 \u0444\u0443\u043d\u0442\u0430 2025 \u0421\u0442\u043e\u044f\u0449\u0430\u044f \u0411\u0440\u0438\u0442\u0430\u043d\u0438\u044f \u0412\u0435\u043b\u0438\u043a\u043e\u0431\u0440\u0438\u0442\u0430\u043d\u0438\u044f',
        url: 'https://imperial-mag.ru/monety/mir/evropa/velikobritaniya/2-funta-2025', status: 'archive',
        properties: { '\u0413\u043e\u0434': '2025', '\u041d\u043e\u043c\u0438\u043d\u0430\u043b': '2 \u0444\u0443\u043d\u0442\u0430', '\u0421\u0442\u0440\u0430\u043d\u0430': '\u0412\u0435\u043b\u0438\u043a\u043e\u0431\u0440\u0438\u0442\u0430\u043d\u0438\u044f' },
    }));
    assert.equal(product.itemStatus, 'archive');
    assert.equal(product.year, 2025);
    assert.equal(isUsableCoinProduct(product, parseTitle(product.title)), true);
});

test('imperial records a source year conflict and follows the title confirmed by the URL', () => {
    const html = card({
        title: '\u041c\u043e\u043d\u0435\u0442\u0430 1 \u043a\u043e\u043f\u0435\u0439\u043a\u0430 1800 \u0415\u041c',
        url: 'https://imperial-mag.ru/monety/imperia/pavel/1-kopejka-1800-em', status: 'active',
        properties: { '\u0413\u043e\u0434': '1801', '\u041d\u043e\u043c\u0438\u043d\u0430\u043b': '1 \u043a\u043e\u043f\u0435\u0439\u043a\u0430' },
    });
    const product = parseImperialProduct(html);
    assert.equal(product.year, 1800);
    assert.deepEqual(product.attributes._year_conflict, { structuredYear: 1801, titleYear: 1800 });
});

test('imperial rejects sets and does not turn textual mintage into a number', () => {
    const product = parseImperialProduct(card({
        title: '\u041a\u043e\u043c\u043f\u043b\u0435\u043a\u0442 3 \u0440\u0443\u0431\u043b\u044f 2018 \u0424\u0443\u0442\u0431\u043e\u043b 12 \u043c\u043e\u043d\u0435\u0442',
        url: 'https://imperial-mag.ru/monety/rf/dragmetall/komplekt-3-rublya-2018', status: 'archive',
        properties: { '\u0413\u043e\u0434': '2018', '\u041d\u043e\u043c\u0438\u043d\u0430\u043b': '3 \u0440\u0443\u0431\u043b\u044f', '\u0422\u0438\u0440\u0430\u0436, \u0448\u0442': '\u043d\u0430 \u0441\u0443\u043c\u043c\u0443 200 000 \u0440\u0443\u0431\u043b\u0435\u0439' },
    }));
    assert.equal(product.mintage, null);
    assert.equal(isUsableCoinProduct(product, parseTitle(product.title)), false);
});

test('imperial migration activates a catalog-only source', () => {
    const sql = fs.readFileSync(path.join(root, 'migrations', 'sql', '202609050002_imperial_source.sql'), 'utf8');
    const ingester = fs.readFileSync(path.join(root, 'catalog', 'ingest-imperial.js'), 'utf8');
    assert.match(sql, /adapter_key='imperial-shop'/);
    assert.match(sql, /source_key='imperial-mag\.ru'/);
    assert.doesNotMatch(sql, /winning_bid|asking_price|sale_price/i);
    assert.match(ingester, /xml\/sitemap\.xml/);
    assert.match(ingester, /--run-kind backfill --limit 0/);
});

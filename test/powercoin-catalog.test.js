'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { parseTitle } = require('../catalog/coin-matcher');
const {
    isUsableCoinProduct, matcherDenomination, parseCategoryPage, parsePowercoinProduct, parseRegionUrls,
} = require('../catalog/powercoin-catalog');

const root = path.resolve(__dirname, '..');

function productHtml(overrides = {}) {
    const schema = {
        '@type': 'Product', name: 'KRAKEN 1/500 Oz Platinum Coin 25$ Liberia 2026',
        url: 'https://www.powercoin.it/en/africa/13356-kraken-coin-2026.html', productID: 13356,
        additionalProperty: [
            ['Country', 'Liberia'], ['Year', 2026], ['Face Value', '25 Dollars'], ['Metal', 'Platinum'],
            ['Weight (g)', '0.062 (1/500 oz)'], ['Diameter (mm)', 12], ['Quality', 'Prooflike'], ['Mintage (pcs)', '6.999'],
        ].map(([name, value]) => ({ '@type': 'PropertyValue', name, value })),
        offers: { availability: 'https://schema.org/InStock', price: '49.95', priceCurrency: 'EUR' },
        ...overrides,
    };
    return `<link rel="canonical" href="${schema.url}"><script type="application/ld+json">${JSON.stringify(schema)}</script>
      <a class="pro_popup_trigger" href="https://www.powercoin.it/73201-superlarge_default/kraken.jpg"></a>
      <a class="pro_popup_trigger" href="https://www.powercoin.it/73202-superlarge_default/kraken.jpg"></a>
      <a class="pro_popup_trigger" href="https://www.powercoin.it/73203-superlarge_default/kraken.jpg"></a>`;
}

test('Power Coin sitemap exposes the five top-level regional coin sections', () => {
    const html = `<li><a id="category-page-149">Coins by Country</a><ul>
      ${[94, 126, 127, 141, 150].map((id) => `<li><a href="https://www.powercoin.it/en/${id}-region">R</a></li>`).join('')}
      </ul></li>`;
    assert.equal(parseRegionUrls(html).length, 5);
});

test('Power Coin category parser deduplicates products and reads the last page', () => {
    const html = `<article class="product-miniature" data-id-product="1"><a href="/en/africa/13356-kraken-2026.html">x</a><a href="/en/africa/13356-kraken-2026.html">x</a></article>
      <a href="/en/126-africa?page=2">2</a><a href="/en/126-africa?page=114">114</a>`;
    const parsed = parseCategoryPage(html);
    assert.equal(parsed.items.length, 1);
    assert.equal(parsed.items[0].sourceItemKey, '13356');
    assert.equal(parsed.lastPage, 114);
});

test('Power Coin parser uses structured identity and two gallery sides but drops offer prices', () => {
    const product = parsePowercoinProduct(productHtml());
    assert.equal(product.sourceItemKey, '13356');
    assert.equal(product.country, 'Liberia');
    assert.equal(product.year, 2026);
    assert.equal(product.denomination, '25 Dollars');
    assert.equal(product.mintage, 6999);
    assert.equal(product.weightG, 0.062);
    assert.equal(product.diameterMm, 12);
    assert.match(product.matchTitle, /25 долларов.*Либерия/);
    assert.match(product.aversImageUrl, /73201/);
    assert.match(product.reversImageUrl, /73202/);
    assert.equal(product.attributes.price, undefined);
    assert.equal(product.attributes.offers, undefined);
    assert.equal(isUsableCoinProduct(product, parseTitle(product.matchTitle)), true);
});

test('Power Coin rejects mixed face values, sets, medals and conflicting years', () => {
    assert.equal(matcherDenomination('1 Dollar - 50 Dollars'), null);
    const mixed = parsePowercoinProduct(productHtml({ additionalProperty: [
        { name: 'Country', value: 'Niue' }, { name: 'Year', value: 2026 }, { name: 'Face Value', value: '1 Dollar - 50 Dollars' },
    ] }));
    assert.equal(isUsableCoinProduct(mixed, parseTitle(mixed.matchTitle)), false);
    const medal = parsePowercoinProduct(productHtml({ name: 'Historic Gold Medal 2026' }));
    assert.equal(isUsableCoinProduct(medal, parseTitle(medal.matchTitle)), false);
    const conflict = parsePowercoinProduct(productHtml({ name: 'Kraken Silver Coin 25$ Liberia 2025' }));
    assert.equal(conflict.year, null);
    assert.equal(isUsableCoinProduct(conflict, parseTitle(conflict.matchTitle)), false);
});

test('Power Coin retains an individual coin with incomplete identity and trusts an exact trailing year', () => {
    const product = parsePowercoinProduct(productHtml({
        name: 'PARROT Spectrum 1 Oz Silver Coin Cook Islands 2026',
        additionalProperty: [{ name: 'Country', value: 'Cook Islands' }],
    }));
    assert.equal(product.year, 2026);
    assert.equal(product.denomination, null);
    assert.equal(isUsableCoinProduct(product, parseTitle(product.matchTitle)), true);
});

test('Power Coin migration records the catalog-only boundary', () => {
    const sql = fs.readFileSync(path.join(root, 'migrations', 'sql', '202609050009_powercoin_source.sql'), 'utf8');
    assert.match(sql, /adapter_key='powercoin-html'/);
    assert.match(sql, /price_role='none'/);
    assert.match(sql, /Offer prices are ignored/);
    assert.doesNotMatch(sql, /asking_price|sale_price|winning_bid/i);
});

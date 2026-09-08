'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { parseTitle } = require('../catalog/coin-matcher');
const {
    isUsableCoinProduct,
    parseCoinsBolhovProduct,
    parseProductSitemap,
    parseSitemapIndex,
    sourceItemKeyFromUrl,
} = require('../catalog/coinsbolhov-shop');
const { ingestProduct } = require('../catalog/ingest-coinsbolhov');

const root = path.resolve(__dirname, '..');

function card({ title, article, url, status, properties }) {
    return `
      <link rel="canonical" href="${url}">
      <script type="application/ld+json">${JSON.stringify({
        '@context': 'http://schema.org',
        '@type': 'Product',
        name: title.replace(/^\u041c\u043e\u043d\u0435\u0442\u0430\s+/, ''),
        url,
        additionalProperty: Object.entries(properties).map(([name, value]) => ({ '@type': 'PropertyValue', name, value })),
        offers: { '@type': 'Offer', price: '765', priceCurrency: 'RUB' },
      })}</script>
      <a class="product__images-item fancybox" href="/upload/avers.jpg"></a>
      <a class="product__images-item fancybox" href="/upload/revers.jpg"></a>
      <h1 class="product__title title-1">${title}</h1>
      <div class="product__article">\u0410\u0440\u0442. ${article}</div>
      <div class="product__trading">${status === 'active'
        ? '<div class="product__trading-count-instock">\u0432 \u043d\u0430\u043b\u0438\u0447\u0438\u0438 5 \u0448\u0442.</div><div class="product__trading-buy">\u041a\u0443\u043f\u0438\u0442\u044c</div>'
        : '<div class="notifyme"><span id="btn-subscribe">\u0423\u0432\u0435\u0434\u043e\u043c\u0438\u0442\u044c \u043e \u043f\u043e\u0441\u0442\u0443\u043f\u043b\u0435\u043d\u0438\u0438</span></div>'}</div>
    `;
}

test('coinsbolhov discovery follows both official product sitemap parts only', () => {
    assert.deepEqual(parseSitemapIndex(`
      <loc>https://coinsbolhov.ru/sitemap-files.xml</loc>
      <loc>https://coinsbolhov.ru/sitemap-iblock-2.xml</loc>
      <loc>https://coinsbolhov.ru/sitemap-iblock-2.part1.xml</loc>
      <loc>https://coinsbolhov.ru/sitemap-iblock-3.xml</loc>
    `), [
        'https://coinsbolhov.ru/sitemap-iblock-2.xml',
        'https://coinsbolhov.ru/sitemap-iblock-2.part1.xml',
    ]);
});

test('coinsbolhov sitemap keeps old and modern coin URLs but excludes other sections and filters', () => {
    const items = parseProductSitemap(`
      <loc>http://coinsbolhov.ru/catalog/monety/11_86946_100_rialov_1982_goda_iran/</loc>
      <loc>https://coinsbolhov.ru/catalog/monety/inostrannye-monety/0002_176523_2_grivny_2025_goda_ukraina/</loc>
      <loc>https://coinsbolhov.ru/catalog/monety/filter/country-is-iran/</loc>
      <loc>https://coinsbolhov.ru/catalog/banknoty/001_note/</loc>
    `);
    assert.deepEqual(items.map((item) => item.sourceItemKey), [
        '11_86946_100_rialov_1982_goda_iran',
        'inostrannye-monety/0002_176523_2_grivny_2025_goda_ukraina',
    ]);
    assert.equal(sourceItemKeyFromUrl(items[0].sourceUrl), '11_86946_100_rialov_1982_goda_iran');
    assert.match(items[0].sourceUrl, /^https:/);
});

test('coinsbolhov active modern card keeps identity and two photos but no price', () => {
    const product = parseCoinsBolhovProduct(card({
        title: '\u041c\u043e\u043d\u0435\u0442\u0430 2 \u0433\u0440\u0438\u0432\u043d\u044b 2025 \u0433\u043e\u0434\u0430 \u0423\u043a\u0440\u0430\u0438\u043d\u0430 \u00ab100 \u043b\u0435\u0442 \u0441\u043e \u0434\u043d\u044f \u0440\u043e\u0436\u0434\u0435\u043d\u0438\u044f \u0418\u0433\u043e\u0440\u044f \u0428\u0430\u043c\u043e\u00bb',
        article: '0002-176523',
        url: 'http://coinsbolhov.ru/catalog/monety/inostrannye-monety/0002_176523_coin/',
        status: 'active',
        properties: {
            '\u0412\u0435\u0441': '12.8', '\u0413\u043e\u0434': '2025', '\u041c\u0435\u0442\u0430\u043b\u043b': '\u041c\u0435\u0434\u043d\u043e-\u043d\u0438\u043a\u0435\u043b\u0435\u0432\u044b\u0439 \u0441\u043f\u043b\u0430\u0432',
            '\u041d\u043e\u043c\u0438\u043d\u0430\u043b': '2 \u0433\u0440\u0438\u0432\u043d\u044b', '\u0421\u0442\u0440\u0430\u043d\u0430': '\u0423\u043a\u0440\u0430\u0438\u043d\u0430', '\u0421\u043e\u0441\u0442\u043e\u044f\u043d\u0438\u0435': 'UNC',
            '\u0414\u0438\u0430\u043c\u0435\u0442\u0440': '31', '\u0422\u0438\u0440\u0430\u0436': '50.000',
        },
    }));
    assert.equal(product.itemStatus, 'active');
    assert.equal(product.year, 2025);
    assert.equal(product.country, '\u0423\u043a\u0440\u0430\u0438\u043d\u0430');
    assert.equal(product.denomination, '2 \u0433\u0440\u0438\u0432\u043d\u044b');
    assert.equal(product.weightG, 12.8);
    assert.equal(product.diameterMm, 31);
    assert.equal(product.mintage, 50000);
    assert.equal(product.aversImageUrl, 'https://coinsbolhov.ru/upload/avers.jpg');
    assert.equal(product.reversImageUrl, 'https://coinsbolhov.ru/upload/revers.jpg');
    assert.equal(product.attributes['\u0410\u0440\u0442\u0438\u043a\u0443\u043b'], '0002-176523');
    assert.equal(Object.hasOwn(product, 'price'), false);
    assert.equal(Object.hasOwn(product.attributes, 'price'), false);
    assert.equal(isUsableCoinProduct(product, parseTitle(product.title)), true);
});

test('coinsbolhov unavailable old cards remain catalog targets', () => {
    const product = parseCoinsBolhovProduct(card({
        title: '\u041c\u043e\u043d\u0435\u0442\u0430 100 \u0440\u0438\u0430\u043b\u043e\u0432 1982 \u0433\u043e\u0434\u0430 \u0418\u0440\u0430\u043d',
        article: '11-86946',
        url: 'http://coinsbolhov.ru/catalog/monety/11_86946_100_rialov_1982_goda_iran/',
        status: 'archive',
        properties: { '\u0412\u0435\u0441': '1', '\u0413\u043e\u0434': '1982', '\u041d\u043e\u043c\u0438\u043d\u0430\u043b': '100 \u0440\u0438\u0430\u043b\u043e\u0432', '\u0421\u0442\u0440\u0430\u043d\u0430': '\u0418\u0440\u0430\u043d' },
    }));
    assert.equal(product.itemStatus, 'archive');
    assert.equal(product.year, 1982);
    assert.equal(isUsableCoinProduct(product, parseTitle(product.title)), true);
});

test('coinsbolhov refresh preserves a reviewed catalog link', async () => {
    const product = parseCoinsBolhovProduct(card({
        title: '\u041c\u043e\u043d\u0435\u0442\u0430 2 \u0433\u0440\u0438\u0432\u043d\u044b 2025 \u0433\u043e\u0434\u0430 \u0423\u043a\u0440\u0430\u0438\u043d\u0430 \u00ab100 \u043b\u0435\u0442 \u0441\u043e \u0434\u043d\u044f \u0440\u043e\u0436\u0434\u0435\u043d\u0438\u044f \u0418\u0433\u043e\u0440\u044f \u0428\u0430\u043c\u043e\u00bb',
        article: '0002-176523',
        url: 'https://coinsbolhov.ru/catalog/monety/inostrannye-monety/0002_176523_coin/',
        status: 'archive',
        properties: {
            '\u0412\u0435\u0441': '12.8', '\u0413\u043e\u0434': '2025', '\u041c\u0435\u0442\u0430\u043b\u043b': '\u041c\u0435\u0434\u043d\u043e-\u043d\u0438\u043a\u0435\u043b\u0435\u0432\u044b\u0439 \u0441\u043f\u043b\u0430\u0432',
            '\u041d\u043e\u043c\u0438\u043d\u0430\u043b': '2 \u0433\u0440\u0438\u0432\u043d\u044b', '\u0421\u0442\u0440\u0430\u043d\u0430': '\u0423\u043a\u0440\u0430\u0438\u043d\u0430',
        },
    }));
    const queries = [];
    const db = { query: async (sql, params) => {
        queries.push({ sql, params });
        if (/RETURNING id,\(xmax=0\)/.test(sql)) return { rows: [{ id: 412, inserted: false }] };
        if (/FROM catalog_source_item_type_link/.test(sql)) {
            return { rows: [{ type_id: 846209, match_method: 'catalog_candidate_review' }] };
        }
        if (/UPDATE catalog_source_item/.test(sql)) return { rows: [] };
        throw new Error(`unexpected query: ${sql}`);
    } };

    assert.equal(await ingestProduct(db, product), 'linked-reviewed-refresh');
    assert.equal(queries.some(({ sql }) => /FROM coin_type|DELETE FROM catalog_source_item_type_link/.test(sql)), false);
});

test('coinsbolhov rejects sets and coin-like non-coins', () => {
    for (const title of [
        '\u041d\u0430\u0431\u043e\u0440 \u043c\u043e\u043d\u0435\u0442 25 \u0440\u0443\u0431\u043b\u0435\u0439 2019 \u0433\u043e\u0434\u0430',
        '\u041c\u043e\u043d\u0435\u0442\u043e\u0432\u0438\u0434\u043d\u044b\u0439 \u0436\u0435\u0442\u043e\u043d 1 \u0440\u0443\u0431\u043b\u044c 2020 \u0433\u043e\u0434\u0430',
        '\u041a\u043e\u043f\u0438\u044f \u043c\u043e\u043d\u0435\u0442\u044b 5 \u0440\u0443\u0431\u043b\u0435\u0439 1900 \u0433\u043e\u0434\u0430',
    ]) {
        const product = { sourceItemKey: 'x', sourceUrl: 'https://coinsbolhov.ru/catalog/monety/x/', title, denomination: '1 \u0440\u0443\u0431\u043b\u044c', year: 2020 };
        assert.equal(isUsableCoinProduct(product, parseTitle(title)), false, title);
    }
});

test('coinsbolhov migration activates a catalog-only source with no price fields', () => {
    const sql = fs.readFileSync(path.join(root, 'migrations', 'sql', '202609050001_coinsbolhov_source.sql'), 'utf8');
    const ingester = fs.readFileSync(path.join(root, 'catalog', 'ingest-coinsbolhov.js'), 'utf8');
    assert.match(sql, /adapter_key='coinsbolhov-shop'/);
    assert.match(sql, /source_key='coinsbolhov\.ru'/);
    assert.match(sql, /all individual coin years and unavailable cards are in scope/);
    assert.doesNotMatch(sql, /winning_bid|asking_price|sale_price/i);
    assert.match(ingester, /--run-kind backfill --limit 0/);
    assert.doesNotMatch(ingester, /winning_bid|asking_price|sale_price/i);
});

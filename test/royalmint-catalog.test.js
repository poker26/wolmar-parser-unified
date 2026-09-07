'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { parseTitle } = require('../catalog/coin-matcher');
const {
    isUsableCoinProduct,
    parseCommerceSitemaps,
    parseRoyalMintProduct,
    parseSitemapIndex,
} = require('../catalog/royalmint-catalog');

const root = path.resolve(__dirname, '..');

function card({ title, url, sku = 'SV25', availability = 'No Longer Available', pictures = [], specifications = {} }) {
    const rows = Object.entries(specifications).map(([name, value]) => `<tr><th>${name}</th><td>${value}</td></tr>`).join('');
    const settings = {
        productName: title,
        sku,
        price: '795.00',
        currentPrice: '£795.00',
        productDefaultPicture: '/images/case.jpg',
        productPictures: pictures,
        stockSummary: { StatusMessage: availability },
        standardText: specifications.Quality || null,
    };
    return `
      <link rel="canonical" href="${url}">
      <script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: title, offers: { price: '795.00', priceCurrency: 'GBP' } })}</script>
      <div data-module="product" data-product-settings='${JSON.stringify(settings)}'></div>
      <div class="specification"><table>${rows}</table></div>`;
}

test('royalmint sitemap index and commerce maps retain unique likely coin pages', () => {
    const maps = parseSitemapIndex(`
      <loc>https://www.royalmint.com/sitemap.xml?bundle=commerce&amp;batch=0</loc>
      <loc>https://www.royalmint.com/sitemap.xml?bundle=pagetree&amp;batch=0</loc>`);
    assert.deepEqual(maps, ['https://www.royalmint.com/sitemap.xml?bundle=commerce&batch=0']);
    const items = parseCommerceSitemaps([`
      <loc>https://www.royalmint.com/sovereign/all/the-sovereign-2025-gold-proof-coin/</loc>
      <loc>https://www.royalmint.com/SOVEREIGN/all/the-sovereign-2025-gold-proof-coin/</loc>
      <loc>https://www.royalmint.com/shop/accessories/empty-box/</loc>
      <loc>https://example.com/coin/</loc>`]);
    assert.equal(items.length, 1);
    assert.equal(items[0].sourceItemKey, 'sovereign/all/the-sovereign-2025-gold-proof-coin');
});

test('royalmint parser keeps an unavailable modern coin and excludes prices', () => {
    const product = parseRoyalMintProduct(card({
        title: 'The Sovereign 2025 Gold Proof Coin',
        url: 'https://www.royalmint.com/sovereign/all/the-sovereign-2025-gold-proof-coin/',
        pictures: ['/images/the-sovereign-2025-reverse.jpg', '/images/the-sovereign-2025-obverse.jpg'],
        specifications: {
            Denomination: 'Sovereign', 'Maximum Coin Mintage': '7,035', Weight: '7.99 g',
            Diameter: '22.05mm', Quality: 'Proof', Year: '2025', 'Pure Metal Type': 'Gold', Price: '£795',
        },
    }));
    assert.equal(product.itemStatus, 'archive');
    assert.equal(product.country, 'United Kingdom');
    assert.equal(product.year, 2025);
    assert.equal(product.weightG, 7.99);
    assert.equal(product.diameterMm, 22.05);
    assert.equal(product.mintage, 7035);
    assert.equal(product.aversImageUrl, 'https://www.royalmint.com/images/the-sovereign-2025-obverse.jpg');
    assert.equal(product.reversImageUrl, 'https://www.royalmint.com/images/the-sovereign-2025-reverse.jpg');
    assert.equal(product.attributes.Price, undefined);
    assert.equal(Object.hasOwn(product, 'price'), false);
    assert.equal(isUsableCoinProduct(product, parseTitle(product.matchTitle)), true);
});

test('royalmint rejects sets, medals, bars and pages without exact coin identity', () => {
    for (const title of [
        'The 2025 United Kingdom Brilliant Uncirculated Annual Coin Set',
        'The Mary Anning Collection 2021 UK Gold Proof Three-Coin Series',
        'The Britannia 2021 UK Two-Coin Silver Proof Set',
        '10 Coin Britannia Collection Case + 1 Coin',
        'End of the Second World War Brilliant Uncirculated Coin Cover',
        'Waterloo 2025 Silver Medal',
        'Britannia 2025 1g Gold Minted Bar',
        'King Arthur 2023 UK £5 Silver Proof Coin Signed by the Artist',
        'Britannia 2025 UK One Ounce Silver Coin Ten Coin Tube',
        'The Lion and the Eagle 2024 UK £2 Coin and Print Set - Black Frame',
        'The 2022 Memorial Sovereign NGC PF70 First Releases',
        'The 2022 Memorial 5 Piece Sovereign',
        'The Full Sovereign & Half Sovereign 2019 Bundle',
        'The Coronation Quarter Sovereign 2023 Gold Bullion Coin in Blister',
        '2021 Wedding Silver Sixpence and Historic Sixpence',
    ]) {
        const product = parseRoyalMintProduct(card({
            title,
            url: `https://www.royalmint.com/shop/${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}/`,
            specifications: { Denomination: '£5', Year: '2025', Weight: '28.28 g' },
        }));
        assert.equal(isUsableCoinProduct(product, parseTitle(product.matchTitle)), false, title);
    }
    const noYear = parseRoyalMintProduct(card({
        title: 'The Sovereign Best Value Gold Bullion Coin',
        url: 'https://www.royalmint.com/invest/pre-owned-sovereign-coin/',
        specifications: { Denomination: 'Sovereign', Weight: '7.99 g' },
    }));
    assert.equal(isUsableCoinProduct(noYear, parseTitle(noYear.matchTitle)), false);
});

test('royalmint prefers an explicit face value in the title and rejects a metal conflict', () => {
    const corrected = parseRoyalMintProduct(card({
        title: 'The Snowman 2025 UK 50p Silver Proof Colour Coin',
        url: 'https://www.royalmint.com/collect/the-snowman-2025-uk-50p-silver-proof-colour-coin/',
        specifications: { Denomination: '£500', Year: '2025', Alloy: '.925 Sterling Silver', Weight: '8 g' },
    }));
    assert.equal(corrected.denomination, '50p');
    assert.match(corrected.matchTitle, /^50 пенсов 2025 /);
    assert.deepEqual(corrected.attributes._denomination_override, {
        structuredDenomination: '£500', titleDenomination: '50p',
    });
    assert.equal(isUsableCoinProduct(corrected, parseTitle(corrected.matchTitle)), true);

    const conflict = parseRoyalMintProduct(card({
        title: 'David Bowie 2020 UK 2oz Gold Proof Coin',
        url: 'https://www.royalmint.com/collect/david-bowie-2020-uk-2oz-gold-proof-coin/',
        specifications: { Denomination: '£200', Year: '2020', Alloy: '999.9 Fine Silver', Weight: '62.42 g' },
    }));
    assert.deepEqual(conflict.attributes._metal_conflict, { titleMetal: 'gold', structuredMetal: 'silver' });
    assert.equal(isUsableCoinProduct(conflict, parseTitle(conflict.matchTitle)), false);
});

test('royalmint ignores plating and theme words when checking metal and denomination', () => {
    const plated = parseRoyalMintProduct(card({
        title: 'The Silver Proof Piedfort Coin 2021',
        url: 'https://www.royalmint.com/collect/the-silver-proof-piedfort-coin-2021/',
        specifications: {
            Denomination: '£5', Year: '2021',
            Alloy: 'Inner: .925 sterling silver. Outer: .925 sterling silver plated with fine gold',
            Weight: '56.56 g',
        },
    }));
    assert.equal(plated.attributes._metal_conflict, undefined);
    assert.equal(isUsableCoinProduct(plated, parseTitle(plated.matchTitle)), true);

    const wedding = parseRoyalMintProduct(card({
        title: 'Platinum Wedding 2017 UK £5 Gold Proof Coin',
        url: 'https://www.royalmint.com/collect/archive/2017/platinum-wedding-2017-uk-5-gold-proof-coin/',
        specifications: { Denomination: '£5', Year: '2017', Alloy: '916.7 Yellow Gold', Weight: '39.94 g' },
    }));
    assert.equal(wedding.attributes._metal_conflict, undefined);
    assert.equal(isUsableCoinProduct(wedding, parseTitle(wedding.matchTitle)), true);

    const crownJewels = parseRoyalMintProduct(card({
        title: 'Crown Jewels 2019 UK Quarter-Ounce Gold Proof Coin',
        url: 'https://www.royalmint.com/collect/archive/2019/crown-jewels-quarter-ounce-gold-proof-coin/',
        specifications: { Denomination: '£25', Year: '2019', Alloy: '999.9 Fine Gold', Weight: '7.80 g' },
    }));
    assert.equal(crownJewels.denomination, '£25');
    assert.equal(crownJewels.attributes._denomination_override, undefined);
    assert.equal(isUsableCoinProduct(crownJewels, parseTitle(crownJewels.matchTitle)), true);

    const penny = parseRoyalMintProduct(card({
        title: "Baby's Silver Penny 2016",
        url: 'https://www.royalmint.com/collect/archive/2016/babys-silver-penny-2016/',
        specifications: { Denomination: '1p', Year: '2016', Alloy: '.925 Sterling Silver', Weight: '3.56 g' },
    }));
    assert.equal(penny.denomination, '1p');
    assert.equal(penny.attributes._denomination_override, undefined);
});

test('royalmint prefers a specific sovereign denomination in the product title', () => {
    const quarter = parseRoyalMintProduct(card({
        title: 'The Quarter Sovereign 2022 Gold Proof Coin',
        url: 'https://www.royalmint.com/sovereign/all/the-quarter-sovereign-2022-gold-proof-coin/',
        specifications: { Denomination: 'Sovereign', Year: '2022', Weight: '1.99 g' },
    }));
    assert.equal(quarter.denomination, 'Quarter Sovereign');
    assert.deepEqual(quarter.attributes._denomination_override, {
        structuredDenomination: 'Sovereign', titleDenomination: 'Quarter Sovereign',
    });
    assert.match(quarter.matchTitle, /^1\/4 соверена 2022 /);
    assert.equal(isUsableCoinProduct(quarter, parseTitle(quarter.matchTitle)), true);

    const five = parseRoyalMintProduct(card({
        title: 'The Five Sovereign Piece 2022 Gold Proof Coin',
        url: 'https://www.royalmint.com/sovereign/all/the-five-sovereign-piece-2022-gold-proof-coin/',
        specifications: { Denomination: 'Sovereign', Year: '2022', Weight: '39.94 g' },
    }));
    assert.equal(five.denomination, 'Five Sovereign Piece');
    assert.match(five.matchTitle, /^5 соверенов 2022 /);
    assert.equal(isUsableCoinProduct(five, parseTitle(five.matchTitle)), true);

    const historicalDouble = parseRoyalMintProduct(card({
        title: '1887 Victoria Double-Sovereign',
        url: 'https://www.royalmint.com/collect/archive/1887-victoria-double-sovereign/',
        specifications: { Denomination: '£2', Year: '1887', Weight: '15.97 g' },
    }));
    assert.equal(historicalDouble.denomination, '£2');
    assert.equal(historicalDouble.attributes._denomination_conflict, undefined);

    const historicalFive = parseRoyalMintProduct(card({
        title: '1893 Victoria Five-Pound Sovereign',
        url: 'https://www.royalmint.com/collect/archive/1893-victoria-five-pound-sovereign/',
        specifications: { Denomination: '£5', Year: '1893', Weight: '39.94 g' },
    }));
    assert.equal(historicalFive.denomination, '£5');
    assert.equal(historicalFive.attributes._denomination_conflict, undefined);
});

test('royalmint uses a title year only when the URL agrees and rejects source conflicts', () => {
    const archived = parseRoyalMintProduct(card({
        title: 'VE Day 2015 Alderney £5 Premium Proof Piedfort Coin',
        url: 'https://www.royalmint.com/collect/archive/2015/ve-day-alderney-5-pound-coin/',
        specifications: { Denomination: '£5', Weight: '28.28 g' },
    }));
    assert.equal(archived.year, 2015);
    assert.equal(isUsableCoinProduct(archived, parseTitle(archived.matchTitle)), true);

    const conflict = parseRoyalMintProduct(card({
        title: '1898 Victoria Veiled Head Sovereign',
        url: 'https://www.royalmint.com/sovereign/all/1898-victoria-veiled-head-sovereign/',
        specifications: { Denomination: 'Sovereign', Year: '1896', Weight: '7.98 g' },
    }));
    assert.equal(conflict.year, null);
    assert.deepEqual(conflict.attributes._year_conflict, { structuredYear: 1896, titleYear: 1898 });
    assert.equal(isUsableCoinProduct(conflict, parseTitle(conflict.matchTitle)), false);
});

test('royalmint infers a named denomination for an archived card without that specification', () => {
    const archived = parseRoyalMintProduct(card({
        title: 'The Half-Sovereign 2019',
        url: 'https://www.royalmint.com/sovereign/all/the-half-sovereign-2019-gold-proof-coin/',
        sku: 'SVH19',
        pictures: ['/images/the-half-sovereign-2019-reverse.jpg', '/images/the-half-sovereign-2019-obverse.jpg'],
        specifications: { Year: '2019', Weight: '3.99 g', Diameter: '19.30mm', Quality: 'Proof' },
    }));
    assert.equal(archived.denomination, 'Half Sovereign');
    assert.match(archived.matchTitle, /^1\/2 соверена 2019 /);
    assert.equal(isUsableCoinProduct(archived, parseTitle(archived.matchTitle)), true);
});

test('royalmint migration enables a catalog-only primary probe and records blocked sources', () => {
    const sourceSql = fs.readFileSync(path.join(root, 'migrations', 'sql', '202609050006_royalmint_source.sql'), 'utf8');
    const accessSql = fs.readFileSync(path.join(root, 'migrations', 'sql', '202609050005_source_access_reviews.sql'), 'utf8');
    const ingester = fs.readFileSync(path.join(root, 'catalog', 'ingest-royalmint.js'), 'utf8');
    const adapter = fs.readFileSync(path.join(root, 'catalog', 'royalmint-catalog.js'), 'utf8');
    assert.match(sourceSql, /adapter_key='royalmint-primary'/);
    assert.match(sourceSql, /price_role='none'/);
    assert.match(sourceSql, /status='probing'/);
    assert.match(accessSql, /source_key='en\.numista\.com'/);
    assert.match(accessSql, /HTTP 403/);
    assert.doesNotMatch(sourceSql, /asking_price|sale_price|winning_bid/i);
    assert.match(adapter, /bundle=commerce/);
    assert.match(ingester, /--run-kind backfill --limit 0/);
});

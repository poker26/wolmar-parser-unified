/** Catalog-only ingestion of old and modern coin cards from coinsmart.ru. */
'use strict';

const { createShopIngester, fetchText } = require('./shop-source-ingester');
const { ORIGIN, SOURCE_KEY, parseProduct, parseProductUrls, parseSitemapIndex, usable } = require('./coinsmart-catalog');

async function discoverProducts(fetchImpl = fetch) {
    const maps = parseSitemapIndex(await fetchText(`${ORIGIN}/sitemap.xml`, fetchImpl));
    if (maps.length < 5) throw new Error(`Coinsmart: найдено только ${maps.length} shop sitemap`);
    const items = new Map();
    for (const map of maps) for (const item of parseProductUrls(await fetchText(map, fetchImpl))) items.set(item.sourceItemKey, item);
    if (items.size < 40000) throw new Error(`Coinsmart: найдено только ${items.size} товарных карточек`);
    return { maps: maps.length, items: [...items.values()] };
}

const ingester = createShopIngester({ sourceKey: SOURCE_KEY, matchMethod: 'coinsmart-dealer', discoverProducts, parseProduct, isUsableProduct: usable });

if (require.main === module) {
    const args = process.argv.slice(2);
    const db = args.includes('--dry-run') ? null : require('./db').pool;
    ingester.run(args, db).catch((error) => { console.error('FATAL', error.message); process.exitCode = 1; })
        .finally(() => db && db.end());
}

module.exports = { ...ingester, discoverProducts };

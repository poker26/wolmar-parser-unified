/** Catalog-only ingestion of old and modern product cards from moneta1.ru. */
'use strict';

const { createShopIngester, fetchText } = require('./shop-source-ingester');
const { ORIGIN, SOURCE_KEY, parseProduct, parseProductUrls, parseSitemapIndex, usable } = require('./moneta1-catalog');

async function discoverProducts(fetchImpl = fetch) {
    const maps = parseSitemapIndex(await fetchText(`${ORIGIN}/sitemap.xml`, fetchImpl));
    if (maps.length < 3) throw new Error(`Moneta1: найдено только ${maps.length} shop sitemap`);
    const items = new Map();
    for (const map of maps) for (const item of parseProductUrls(await fetchText(map, fetchImpl))) items.set(item.sourceItemKey, item);
    if (items.size < 20000) throw new Error(`Moneta1: найдено только ${items.size} товарных карточек`);
    return { maps: maps.length, items: [...items.values()] };
}

const ingester = createShopIngester({ sourceKey: SOURCE_KEY, matchMethod: 'moneta1-dealer', discoverProducts, parseProduct, isUsableProduct: usable });

if (require.main === module) {
    const args = process.argv.slice(2);
    const db = args.includes('--dry-run') ? null : require('./db').pool;
    ingester.run(args, db).catch((error) => { console.error('FATAL', error.message); process.exitCode = 1; })
        .finally(() => db && db.end());
}

module.exports = { ...ingester, discoverProducts };

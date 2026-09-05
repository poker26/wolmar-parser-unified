/** Catalog-only ingestion of old and modern coin cards from rmoneta.ru. */
'use strict';

const { createShopIngester, fetchText } = require('./shop-source-ingester');
const { ORIGIN, SOURCE_KEY, parseProduct, parseProductUrls, parseSitemapIndex, usable } = require('./rmoneta-catalog');

async function discoverProducts(fetchImpl = fetch) {
    const maps = parseSitemapIndex(await fetchText(`${ORIGIN}/sitemap.xml`, fetchImpl));
    if (maps.length !== 1) throw new Error(`rmoneta: найдено ${maps.length} товарных sitemap вместо одной`);
    const items = new Map();
    for (const map of maps) for (const item of parseProductUrls(await fetchText(map, fetchImpl))) items.set(item.sourceItemKey, item);
    if (items.size < 5000) throw new Error(`rmoneta: найдено только ${items.size} товарных карточек`);
    return { maps: maps.length, items: [...items.values()] };
}

const ingester = createShopIngester({ sourceKey: SOURCE_KEY, matchMethod: 'rmoneta-dealer', discoverProducts, parseProduct, isUsableProduct: usable });

if (require.main === module) {
    const args = process.argv.slice(2);
    const db = args.includes('--dry-run') ? null : require('./db').pool;
    ingester.run(args, db).catch((error) => { console.error('FATAL', error.message); process.exitCode = 1; })
        .finally(() => db && db.end());
}

module.exports = { ...ingester, discoverProducts };

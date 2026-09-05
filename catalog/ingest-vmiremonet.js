/** Catalog-only ingestion of post-2018 coin cards from vmiremonet.ru. */
'use strict';

const { createShopIngester, fetchText } = require('./shop-source-ingester');
const {
    ORIGIN, SOURCE_KEY, parseModernCoinUrls, parseProduct, parseSitemapIndex, usable,
} = require('./vmiremonet-catalog');

async function discoverProducts(fetchImpl = fetch) {
    const index = await fetchText(`${ORIGIN}/sitemap.xml`, fetchImpl);
    const maps = parseSitemapIndex(index);
    if (maps.length < 7) throw new Error(`В мире монет: найдено только ${maps.length} shop sitemap`);
    const items = new Map();
    for (const map of maps) {
        for (const item of parseModernCoinUrls(await fetchText(map, fetchImpl))) items.set(item.sourceItemKey, item);
    }
    if (items.size < 3000) throw new Error(`В мире монет: найдено только ${items.size} современных карточек монет`);
    return { maps: maps.length, items: [...items.values()] };
}

const ingester = createShopIngester({
    sourceKey: SOURCE_KEY,
    matchMethod: 'vmiremonet-dealer',
    discoverProducts,
    parseProduct,
    isUsableProduct: usable,
});

if (require.main === module) {
    const args = process.argv.slice(2);
    const db = args.includes('--dry-run') ? null : require('./db').pool;
    ingester.run(args, db).catch((error) => { console.error('FATAL', error.message); process.exitCode = 1; })
        .finally(() => db && db.end());
}

module.exports = { ...ingester, discoverProducts };

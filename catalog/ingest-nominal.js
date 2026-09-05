/** Catalog-only ingestion of dated coin cards from nominal.club. */
'use strict';

const { createShopIngester, fetchText } = require('./shop-source-ingester');
const { ORIGIN, SOURCE_KEY, parseDatedCoinUrls, parseProduct, parseSitemapIndex, usable } = require('./nominal-catalog');

async function discoverProducts(fetchImpl = fetch) {
    const index = await fetchText(`${ORIGIN}/sitemap.xml`, fetchImpl);
    const maps = parseSitemapIndex(index);
    if (maps.length < 12) throw new Error(`Nominal.club: найдено только ${maps.length} shop sitemap`);
    const items = new Map();
    for (const map of maps) {
        for (const item of parseDatedCoinUrls(await fetchText(map, fetchImpl))) items.set(item.sourceItemKey, item);
    }
    if (items.size < 40000) throw new Error(`Nominal.club: найдено только ${items.size} датированных карточек монет`);
    return { maps: maps.length, items: [...items.values()] };
}

const ingester = createShopIngester({
    sourceKey: SOURCE_KEY,
    matchMethod: 'nominal-dealer',
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

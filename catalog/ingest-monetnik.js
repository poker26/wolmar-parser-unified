/** Catalog-only ingestion of the complete coin-card archive from Monetnik.ru. */
'use strict';

const { createShopIngester, fetchText } = require('./shop-source-ingester');
const {
    ORIGIN, SOURCE_KEY, isUsableCoinProduct, parseCoinUrls, parseMonetnikProduct, parseSitemapIndex,
} = require('./monetnik-catalog');

async function fetchMany(urls, concurrency, fetchImpl) {
    const values = new Array(urls.length);
    let cursor = 0;
    async function worker() {
        while (cursor < urls.length) {
            const index = cursor++;
            values[index] = await fetchText(urls[index], fetchImpl);
        }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));
    return values;
}

async function discoverProducts(fetchImpl = fetch) {
    const index = await fetchText(`${ORIGIN}/sitemap.xml`, fetchImpl);
    const maps = parseSitemapIndex(index);
    if (maps.length < 20) throw new Error(`Monetnik.ru: найдено только ${maps.length} sitemap-файлов`);
    const items = new Map();
    for (const xml of await fetchMany(maps, 6, fetchImpl)) {
        for (const item of parseCoinUrls(xml)) if (!items.has(item.sourceItemKey)) items.set(item.sourceItemKey, item);
    }
    if (items.size < 5000) throw new Error(`Monetnik.ru: найдено только ${items.size} карточек монет`);
    return { maps: maps.length, items: [...items.values()] };
}

const ingester = createShopIngester({
    sourceKey: SOURCE_KEY,
    matchMethod: 'monetnik-dealer',
    discoverProducts,
    parseProduct: parseMonetnikProduct,
    isUsableProduct: isUsableCoinProduct,
});

if (require.main === module) {
    const args = process.argv.slice(2);
    const db = args.includes('--dry-run') ? null : require('./db').pool;
    ingester.run(args, db).catch((error) => { console.error('FATAL', error.message); process.exitCode = 1; })
        .finally(() => db && db.end());
}

module.exports = { ...ingester, discoverProducts, fetchMany };

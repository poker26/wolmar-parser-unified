/** Catalog-only ingestion of old and modern product cards from collectionmarket.ru. */
'use strict';
const { createShopIngester, fetchText } = require('./shop-source-ingester');
const { ORIGIN, SOURCE_KEY, parseProduct, parseProductUrls, usable } = require('./collectionmarket-catalog');

async function discoverProducts(fetchImpl = fetch) {
    const items = parseProductUrls(await fetchText(`${ORIGIN}/sitemap.xml`, fetchImpl));
    if (items.length < 5000) throw new Error(`Collection Market: найдено только ${items.length} товарных URL`);
    return { maps: 1, items };
}

const ingester = createShopIngester({ sourceKey: SOURCE_KEY, matchMethod: 'collectionmarket-dealer', discoverProducts, parseProduct, isUsableProduct: usable });
if (require.main === module) {
    const args = process.argv.slice(2); const db = args.includes('--dry-run') ? null : require('./db').pool;
    ingester.run(args, db).catch((error) => { console.error('FATAL', error.message); process.exitCode = 1; }).finally(() => db && db.end());
}
module.exports = { ...ingester, discoverProducts };

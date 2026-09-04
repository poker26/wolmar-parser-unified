/**
 * Catalog-only ingestion from всемонеты.рф.
 *
 *   node catalog/ingest-vsemonety.js --dry-run --sample --limit 10
 *   node catalog/ingest-vsemonety.js --run-kind probe --sample --limit 20
 *   node catalog/ingest-vsemonety.js --run-kind backfill --limit 0
 */
'use strict';

const { createShopIngester, fetchText } = require('./shop-source-ingester');
const {
    ORIGIN,
    SOURCE_KEY,
    isUsableCoinProduct,
    parseProductSitemap,
    parseVsemonetyProduct,
} = require('./vsemonety-catalog');

async function discoverProducts(fetchImpl = fetch) {
    const sitemapUrl = `${ORIGIN}/sitemap.xml`;
    const xml = await fetchText(sitemapUrl, fetchImpl);
    const items = parseProductSitemap(xml);
    if (items.length < 100) throw new Error(`${sitemapUrl}: найдено ${items.length} URL`);
    return { maps: 1, items, sitemapUrl };
}

const ingester = createShopIngester({
    sourceKey: SOURCE_KEY,
    matchMethod: 'vsemonety-catalog',
    discoverProducts,
    parseProduct: parseVsemonetyProduct,
    isUsableProduct: isUsableCoinProduct,
});

if (require.main === module) {
    const args = process.argv.slice(2);
    const db = args.includes('--dry-run') ? null : require('./db').pool;
    ingester.run(args, db)
        .catch((error) => { console.error('FATAL', error.message); process.exitCode = 1; })
        .finally(() => db && db.end());
}

module.exports = { ...ingester, discoverProducts };

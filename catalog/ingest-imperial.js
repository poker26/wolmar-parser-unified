/**
 * Catalog-only imperial-mag.ru ingestion.
 *
 *   node catalog/ingest-imperial.js --dry-run --sample --limit 10
 *   node catalog/ingest-imperial.js --run-kind probe --sample --limit 20
 *   node catalog/ingest-imperial.js --run-kind backfill --limit 0
 */
'use strict';

const { createShopIngester, fetchText } = require('./shop-source-ingester');
const {
    ORIGIN,
    SOURCE_KEY,
    isUsableCoinProduct,
    parseImperialProduct,
    parseProductSitemap,
} = require('./imperial-shop');

async function discoverProducts(fetchImpl = fetch) {
    const candidates = [`${ORIGIN}/sitemap.xml`, `${ORIGIN}/xml/sitemap.xml`];
    let lastError = null;
    for (const sitemapUrl of candidates) {
        try {
            const xml = await fetchText(sitemapUrl, fetchImpl);
            const items = parseProductSitemap(xml);
            if (items.length >= 100) return { maps: 1, items, sitemapUrl };
            lastError = new Error(`${sitemapUrl}: \u0432 sitemap \u043d\u0430\u0439\u0434\u0435\u043d\u043e ${items.length} \u043c\u043e\u043d\u0435\u0442\u043d\u044b\u0445 URL`);
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError || new Error('\u043d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043f\u0440\u043e\u0447\u0438\u0442\u0430\u0442\u044c sitemap');
}

const ingester = createShopIngester({
    sourceKey: SOURCE_KEY,
    matchMethod: 'imperial-shop',
    discoverProducts,
    parseProduct: parseImperialProduct,
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

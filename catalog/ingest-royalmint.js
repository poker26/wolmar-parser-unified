/**
 * Catalog-only ingestion from public The Royal Mint product cards.
 *
 *   node catalog/ingest-royalmint.js --dry-run --sample --limit 10
 *   node catalog/ingest-royalmint.js --run-kind probe --sample --limit 20
 *   node catalog/ingest-royalmint.js --run-kind backfill --limit 0
 */
'use strict';

const { createShopIngester, fetchText } = require('./shop-source-ingester');
const {
    ORIGIN,
    SOURCE_KEY,
    isUsableCoinProduct,
    parseCommerceSitemaps,
    parseRoyalMintProduct,
    parseSitemapIndex,
} = require('./royalmint-catalog');

async function fetchSitemaps(urls, concurrency, fetchImpl) {
    const documents = new Array(urls.length);
    let cursor = 0;
    async function worker() {
        while (cursor < urls.length) {
            const index = cursor++;
            documents[index] = await fetchText(urls[index], fetchImpl);
        }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));
    return documents;
}

async function discoverProducts(fetchImpl = fetch) {
    const sitemapUrl = `${ORIGIN}/sitemap.xml`;
    const index = await fetchText(sitemapUrl, fetchImpl);
    const maps = parseSitemapIndex(index);
    if (maps.length < 10) throw new Error(`${sitemapUrl}: найдено ${maps.length} разделов commerce`);
    const items = parseCommerceSitemaps(await fetchSitemaps(maps, 8, fetchImpl));
    if (items.length < 100) throw new Error(`${sitemapUrl}: найдено ${items.length} вероятных карточек монет`);
    return { maps: maps.length, items, sitemapUrl };
}

const ingester = createShopIngester({
    sourceKey: SOURCE_KEY,
    matchMethod: 'royalmint-primary',
    discoverProducts,
    parseProduct: parseRoyalMintProduct,
    isUsableProduct: isUsableCoinProduct,
});

if (require.main === module) {
    const args = process.argv.slice(2);
    const db = args.includes('--dry-run') ? null : require('./db').pool;
    ingester.run(args, db)
        .catch((error) => { console.error('FATAL', error.message); process.exitCode = 1; })
        .finally(() => db && db.end());
}

module.exports = { ...ingester, discoverProducts, fetchSitemaps };

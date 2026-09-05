/** Catalog-only ingestion from UniCoin public sitemap news pages and product cards. */
'use strict';

const { createShopIngester, fetchText } = require('./shop-source-ingester');
const {
    ORIGIN, SOURCE_KEY, isUsableCoinProduct, parseNewsProducts, parseSitemapNewsUrls, parseUnicoinProduct,
} = require('./unicoin-catalog');

async function discoverProducts(fetchImpl = fetch, context = {}) {
    const sitemap = await fetchText(`${ORIGIN}/sitemap.xml`, fetchImpl);
    const allNewsUrls = parseSitemapNewsUrls(sitemap);
    if (allNewsUrls.length < 1000) throw new Error(`UniCoin: sitemap содержит только ${allNewsUrls.length} страниц поступлений`);
    const newsUrls = context.runKind === 'backfill' ? allNewsUrls : allNewsUrls.slice(0, context.dryRun ? 1 : 3);
    const items = new Map();
    let pagesFetched = 1;
    let errorsCount = 0;
    for (const url of newsUrls) {
        try {
            const html = await fetchText(url, fetchImpl);
            pagesFetched += 1;
            for (const item of parseNewsProducts(html)) if (!items.has(item.sourceItemKey)) items.set(item.sourceItemKey, item);
        } catch (error) {
            errorsCount += 1;
            console.error(`ERROR discovery ${url}: ${error.message}`);
        }
    }
    if (items.size < (context.runKind === 'backfill' ? 1000 : 20)) {
        throw new Error(`UniCoin: найдено только ${items.size} карточек`);
    }
    return { maps: pagesFetched - 1, items: [...items.values()], errorsCount };
}

const ingester = createShopIngester({
    sourceKey: SOURCE_KEY,
    matchMethod: 'unicoin-dealer',
    discoverProducts,
    parseProduct: parseUnicoinProduct,
    isUsableProduct: isUsableCoinProduct,
    requestIntervalMs: 5000,
});

if (require.main === module) {
    const args = process.argv.slice(2);
    const db = args.includes('--dry-run') ? null : require('./db').pool;
    ingester.run(args, db).catch((error) => { console.error('FATAL', error.message); process.exitCode = 1; })
        .finally(() => db && db.end());
}

module.exports = { ...ingester, discoverProducts };

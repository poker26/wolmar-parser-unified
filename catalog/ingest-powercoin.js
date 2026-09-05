/** Catalog-only ingestion from public Power Coin listing and product pages. */
'use strict';

const { createShopIngester, fetchText } = require('./shop-source-ingester');
const {
    ORIGIN, SOURCE_KEY, isUsableCoinProduct, parseCategoryPage, parsePowercoinProduct, parseRegionUrls,
} = require('./powercoin-catalog');

async function fetchMany(urls, concurrency, fetchImpl) {
    const results = new Array(urls.length);
    let cursor = 0;
    async function worker() {
        while (cursor < urls.length) {
            const index = cursor++;
            results[index] = await fetchText(urls[index], fetchImpl);
        }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));
    return results;
}

async function discoverProducts(fetchImpl = fetch, context = {}) {
    const backfill = context.runKind === 'backfill';
    let pagesFetched = 0;
    let baseUrls;
    if (backfill) {
        const sitemapHtml = await fetchText(`${ORIGIN}/en/sitemap`, fetchImpl);
        pagesFetched += 1;
        baseUrls = parseRegionUrls(sitemapHtml);
        if (baseUrls.length !== 5) throw new Error(`Power Coin: найдено ${baseUrls.length} региональных разделов вместо 5`);
    } else baseUrls = [`${ORIGIN}/en/new-products`];

    const firstPages = await fetchMany(baseUrls, 5, fetchImpl);
    pagesFetched += firstPages.length;
    const pageUrls = [];
    const items = [];
    for (let index = 0; index < baseUrls.length; index += 1) {
        const parsed = parseCategoryPage(firstPages[index]);
        items.push(...parsed.items);
        for (let page = 2; page <= parsed.lastPage; page += 1) pageUrls.push(`${baseUrls[index]}?page=${page}`);
    }
    for (const html of await fetchMany(pageUrls, 6, fetchImpl)) {
        pagesFetched += 1;
        items.push(...parseCategoryPage(html).items);
    }
    const unique = [...new Map(items.map((item) => [item.sourceItemKey, item])).values()];
    if (unique.length < (backfill ? 1000 : 50)) throw new Error(`Power Coin: найдено ${unique.length} карточек`);
    return { maps: Math.max(pagesFetched - 1, 0), items: unique };
}

const ingester = createShopIngester({
    sourceKey: SOURCE_KEY,
    matchMethod: 'powercoin-dealer',
    discoverProducts,
    parseProduct: parsePowercoinProduct,
    isUsableProduct: isUsableCoinProduct,
});

if (require.main === module) {
    const args = process.argv.slice(2);
    const db = args.includes('--dry-run') ? null : require('./db').pool;
    ingester.run(args, db).catch((error) => { console.error('FATAL', error.message); process.exitCode = 1; })
        .finally(() => db && db.end());
}

module.exports = { ...ingester, discoverProducts, fetchMany };

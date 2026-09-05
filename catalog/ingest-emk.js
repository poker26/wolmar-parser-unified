/** Catalog-only ingestion from EMK's public sitemap and product GraphQL API. */
'use strict';

const { createShopIngester, fetchText, option, USER_AGENT } = require('./shop-source-ingester');
const { finishSourceRun, startSourceRun } = require('./source-registry');
const { sampleItems, selectSourceItems } = require('./shop-source-items');
const {
    GRAPH_URL, ORIGIN, PRODUCT_QUERY, SOURCE_KEY,
    isUsableCoinProduct, parseEmkProduct, parseProductSitemap,
} = require('./emk-catalog');

const ingester = createShopIngester({
    sourceKey: SOURCE_KEY,
    matchMethod: 'emk-dealer',
    discoverProducts: async () => ({ maps: 0, items: [] }),
    parseProduct: (value) => value,
    isUsableProduct: isUsableCoinProduct,
});

async function discoverProducts(fetchImpl = fetch) {
    const sitemapUrl = `${ORIGIN}/en-us/sitemap_0.xml`;
    const xml = await fetchText(sitemapUrl, fetchImpl);
    const items = parseProductSitemap(xml);
    if (items.length < 1000) throw new Error(`${sitemapUrl}: найдено ${items.length} вероятных карточек монет`);
    return { maps: 1, items, sitemapUrl };
}

async function fetchProductBatch(items, fetchImpl = fetch) {
    const response = await fetchImpl(GRAPH_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': USER_AGENT, 'x-languageid': '1033' },
        body: JSON.stringify({ query: PRODUCT_QUERY, variables: {
            options: { ids: items.map((item) => item.queryId), page: { size: items.length }, ignoreGrouping: true },
        } }),
        signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`${GRAPH_URL}: HTTP ${response.status}`);
    const body = await response.json();
    if (body.errors?.length) throw new Error(body.errors.map((error) => error.message).join('; '));
    const products = body.data?.catalog?.products?.products;
    if (!Array.isArray(products)) throw new Error(`${GRAPH_URL}: ответ не содержит products`);
    const byId = new Map(products.map((product) => [String(product.id).toUpperCase(), product]));
    return items.map((item) => ({ item, raw: byId.get(item.queryId) || null }));
}

async function run(args = process.argv.slice(2), db = null, fetchImpl = fetch) {
    const dryRun = args.includes('--dry-run');
    const refresh = args.includes('--refresh');
    const sample = args.includes('--sample');
    const runKind = option(args, 'run-kind', 'probe');
    const rawLimit = Number(option(args, 'limit', dryRun ? 5 : 100));
    const limit = Number.isInteger(rawLimit) && rawLimit >= 0 ? rawLimit : 100;
    if (!dryRun && !db) throw new Error('для записи нужен DB pool');
    const stat = { pagesFetched: 0, itemsSeen: 0, observationsSaved: 0, candidatesStaged: 0, errorsCount: 0 };
    let sourceRun = null;
    if (!dryRun) sourceRun = await startSourceRun(db, SOURCE_KEY, runKind);
    try {
        const discovery = await discoverProducts(fetchImpl);
        stat.pagesFetched = 1;
        const pool = sample ? sampleItems(discovery.items, limit) : discovery.items;
        const selected = dryRun ? (limit ? pool.slice(0, limit) : pool)
            : await selectSourceItems(db, SOURCE_KEY, pool, { limit, refresh });
        console.log(`sitemap=1 карточек=${discovery.items.length} выбрано=${selected.length}`);
        for (let offset = 0; offset < selected.length; offset += 40) {
            const items = selected.slice(offset, offset + 40);
            let results;
            try {
                results = await fetchProductBatch(items, fetchImpl);
                stat.pagesFetched += 1;
            } catch (error) {
                stat.errorsCount += items.length;
                stat.itemsSeen += items.length;
                console.error(`ERROR batch ${offset}: ${error.message}`);
                continue;
            }
            for (const result of results) {
                stat.itemsSeen += 1;
                if (!result.raw) {
                    stat.errorsCount += 1;
                    console.error(`ERROR ${result.item.queryId}: карточка отсутствует в GraphQL`);
                    continue;
                }
                const product = parseEmkProduct(result.raw);
                const parsed = ingester.parsedProductTitle(product);
                if (dryRun) {
                    const usable = isUsableCoinProduct(product, parsed);
                    console.log(`${usable ? 'COIN' : 'SKIP'} ${product.sourceItemKey} ${product.year || '-'} номинал=${product.denomination || '-'} фото=${Number(Boolean(product.aversImageUrl)) + Number(Boolean(product.reversImageUrl))} | ${product.title}`);
                    continue;
                }
                try {
                    const outcome = await ingester.ingestProduct(db, product);
                    stat[outcome] = (stat[outcome] || 0) + 1;
                    if (!['set', 'noncoin'].includes(outcome)) stat.observationsSaved += 1;
                    if (outcome === 'candidate-new') stat.candidatesStaged += 1;
                } catch (error) {
                    stat.errorsCount += 1;
                    console.error(`ERROR ${product.sourceItemKey}: ${error.message}`);
                }
            }
            console.log(`обработано ${Math.min(offset + items.length, selected.length)}/${selected.length}`);
        }
        if (sourceRun) await finishSourceRun(db, sourceRun.id, stat.errorsCount ? 'partial' : 'succeeded', {
            ...stat,
            cursor: JSON.stringify({ lastSourceItemKey: selected.at(-1)?.sourceItemKey || null }),
            errorSummary: stat.errorsCount ? `${stat.errorsCount} карточек завершились ошибкой` : null,
        });
        console.log('итог:', JSON.stringify(stat));
        return stat;
    } catch (error) {
        if (sourceRun) await finishSourceRun(db, sourceRun.id, 'failed', { ...stat, errorSummary: error.message });
        throw error;
    }
}

if (require.main === module) {
    const args = process.argv.slice(2);
    const db = args.includes('--dry-run') ? null : require('./db').pool;
    run(args, db).catch((error) => { console.error('FATAL', error.message); process.exitCode = 1; })
        .finally(() => db && db.end());
}

module.exports = { discoverProducts, fetchProductBatch, run };

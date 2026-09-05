/**
 * Catalog-only ingestion of official ECB EUR 2 commemorative issues.
 *
 *   node catalog/ingest-ecb.js --dry-run --sample --limit 10
 *   node catalog/ingest-ecb.js --run-kind probe --sample --limit 20
 *   node catalog/ingest-ecb.js --run-kind backfill --limit 0
 */
'use strict';

const { parseTitle } = require('./coin-matcher');
const { createShopIngester, fetchText, option } = require('./shop-source-ingester');
const { sampleItems, selectSourceItems } = require('./shop-source-items');
const { finishSourceRun, startSourceRun } = require('./source-registry');
const {
    ORIGIN,
    SOURCE_KEY,
    isUsableCoinProduct,
    parseCommemorativeIndex,
    parseCommemorativePage,
} = require('./ecb-commemorative');

const CRAWL_DELAY_MS = 5000;
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const shared = createShopIngester({
    sourceKey: SOURCE_KEY,
    matchMethod: 'ecb-primary',
    discoverProducts: async () => ({ maps: 0, items: [] }),
    parseProduct: () => null,
    isUsableProduct: isUsableCoinProduct,
});

async function discoverPages(fetchImpl = fetch) {
    const indexUrl = `${ORIGIN}/euro/coins/comm/html/index.en.html`;
    const pages = parseCommemorativeIndex(await fetchText(indexUrl, fetchImpl));
    if (pages.length < 20) throw new Error(`${indexUrl}: найдено ${pages.length} годовых страниц`);
    return { indexUrl, pages };
}

async function run(args = process.argv.slice(2), db = null, fetchImpl = fetch, waitImpl = wait) {
    const dryRun = args.includes('--dry-run');
    const sample = args.includes('--sample');
    const refresh = args.includes('--refresh');
    const runKind = option(args, 'run-kind', 'probe');
    const rawLimit = Number(option(args, 'limit', dryRun ? 5 : 100));
    const limit = Number.isInteger(rawLimit) && rawLimit >= 0 ? rawLimit : 100;
    if (!dryRun && !db) throw new Error('для записи нужен DB pool');
    let sourceRun = null;
    const stat = { pagesFetched: 0, itemsSeen: 0, observationsSaved: 0, candidatesStaged: 0, errorsCount: 0 };
    if (!dryRun) sourceRun = await startSourceRun(db, SOURCE_KEY, runKind);
    try {
        const discovery = await discoverPages(fetchImpl);
        stat.pagesFetched = 1;
        const pageLimit = sample ? 1 : discovery.pages.length;
        const products = [];
        for (const pageUrl of discovery.pages.slice(0, pageLimit)) {
            await waitImpl(CRAWL_DELAY_MS);
            try {
                const parsed = parseCommemorativePage(await fetchText(pageUrl, fetchImpl), pageUrl);
                if (!parsed.length) throw new Error('на странице не найдены карточки монет');
                products.push(...parsed);
            } catch (error) {
                stat.errorsCount += 1;
                console.error(`ERROR ${pageUrl}: ${error.message}`);
            }
            stat.pagesFetched += 1;
        }
        const discovered = sample ? sampleItems(products, limit) : products;
        const selected = dryRun
            ? (limit ? discovered.slice(0, limit) : discovered)
            : await selectSourceItems(db, SOURCE_KEY, discovered, { limit, refresh });
        console.log(`страниц=${pageLimit} карточек=${products.length} выбрано=${selected.length}`);
        for (const product of selected) {
            stat.itemsSeen += 1;
            if (dryRun) {
                console.log(`${isUsableCoinProduct(product, parseTitle(product.matchTitle)) ? 'COIN' : 'SKIP'} ${product.sourceItemKey} ${product.year} тираж=${product.mintage || '-'} фото=2 | ${product.title}`);
                continue;
            }
            try {
                const outcome = await shared.ingestProduct(db, product);
                stat[outcome] = (stat[outcome] || 0) + 1;
                if (!['set', 'noncoin'].includes(outcome)) stat.observationsSaved += 1;
                if (outcome === 'candidate-new') stat.candidatesStaged += 1;
            } catch (error) {
                stat.errorsCount += 1;
                console.error(`ERROR ${product.sourceItemKey}: ${error.message}`);
            }
        }
        if (sourceRun) await finishSourceRun(db, sourceRun.id, stat.errorsCount ? 'partial' : 'succeeded', {
            ...stat,
            cursor: JSON.stringify({ newestPage: discovery.pages[0], oldestPage: discovery.pages[pageLimit - 1] }),
            errorSummary: stat.errorsCount ? `${stat.errorsCount} страниц или карточек завершились ошибкой` : null,
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

module.exports = { CRAWL_DELAY_MS, discoverPages, run };


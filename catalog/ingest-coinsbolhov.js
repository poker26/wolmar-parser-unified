/**
 * Catalog-only coinsbolhov.ru ingestion.
 *
 * Discovery: official sitemap. Scope: every individual coin, active or archived,
 * with no year cutoff. Asking prices are never read or stored.
 *
 *   node catalog/ingest-coinsbolhov.js --dry-run --sample --limit 10
 *   node catalog/ingest-coinsbolhov.js --run-kind probe --sample --limit 20
 *   node catalog/ingest-coinsbolhov.js --run-kind backfill --limit 0
 */
'use strict';

const { DIAG, matchType, parseTitle } = require('./coin-matcher');
const { stageCatalogCandidate } = require('./catalog-candidates');
const { finishSourceRun, startSourceRun } = require('./source-registry');
const { completeSourceItem, sampleItems, selectSourceItems, upsertSourceItem } = require('./shop-source-items');
const {
    ORIGIN,
    SOURCE_KEY,
    isUsableCoinProduct,
    parseCoinsBolhovProduct,
    parseProductSitemap,
    parseSitemapIndex,
} = require('./coinsbolhov-shop');

const USER_AGENT = 'WolmarCatalog/1.0 (catalog identity ingestion)';

function option(args, name, fallback = null) {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : fallback;
}

async function fetchText(url, fetchImpl = fetch) {
    const response = await fetchImpl(url, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return response.text();
}

async function discoverProducts(fetchImpl = fetch) {
    const indexXml = await fetchText(`${ORIGIN}/sitemap.xml`, fetchImpl);
    const maps = parseSitemapIndex(indexXml);
    if (!maps.length) throw new Error('\u043e\u0444\u0438\u0446\u0438\u0430\u043b\u044c\u043d\u044b\u0439 sitemap \u043d\u0435 \u0441\u043e\u0434\u0435\u0440\u0436\u0438\u0442 product maps');
    const products = new Map();
    for (const mapUrl of maps) {
        const xml = await fetchText(mapUrl, fetchImpl);
        for (const item of parseProductSitemap(xml)) products.set(item.sourceItemKey, item);
    }
    return { maps: maps.length, items: [...products.values()] };
}

function parsedProductTitle(product) {
    const matchTitle = product.country && !product.title.toLowerCase().includes(product.country.toLowerCase())
        ? `${product.title} ${product.country}`
        : product.title;
    return parseTitle(matchTitle);
}

async function ingestProduct(db, product) {
    const parsed = parsedProductTitle(product);
    if (!isUsableCoinProduct(product, parsed)) return parsed.isSet ? 'set' : 'noncoin';
    const row = await upsertSourceItem(db, product);
    if (!parsed.year || !parsed.denom) return completeSourceItem(db, row.id, 'stored-incomplete');

    DIAG.on = true;
    const match = await matchType(db, parsed);
    const matchReason = DIAG.reason;
    if (match) {
        await db.query(
            `INSERT INTO catalog_source_item_type_link
               (source_item_id,type_id,match_method,match_confidence)
             VALUES ($1,$2,'coinsbolhov-shop',$3)
             ON CONFLICT (source_item_id) DO UPDATE SET
               type_id=EXCLUDED.type_id,match_method=EXCLUDED.match_method,match_confidence=EXCLUDED.match_confidence`,
            [row.id, match.id, match.conf],
        );
        return completeSourceItem(db, row.id, row.inserted ? 'linked-new' : 'linked-refresh');
    }

    const staged = await stageCatalogCandidate(db, {
        parsed,
        matchReason,
        sourceItem: {
            id: row.id,
            sourceSite: SOURCE_KEY,
            sourceItemKey: product.sourceItemKey,
            sourceUrl: product.sourceUrl,
            itemStatus: product.itemStatus,
            title: product.title,
        },
    });
    if (staged.staged) {
        return completeSourceItem(db, row.id, staged.observationAdded ? 'candidate-new' : 'candidate-refresh');
    }
    return completeSourceItem(db, row.id, row.inserted ? 'unmatched-new' : 'unmatched-refresh');
}

async function fetchBatch(items, concurrency, fetchImpl = fetch) {
    const results = new Array(items.length);
    let cursor = 0;
    async function worker() {
        while (cursor < items.length) {
            const index = cursor++;
            const item = items[index];
            try {
                const html = await fetchText(item.sourceUrl, fetchImpl);
                results[index] = { item, product: parseCoinsBolhovProduct(html, item.sourceUrl) };
            } catch (error) {
                results[index] = { item, error };
            }
        }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
    return results;
}

async function run(args = process.argv.slice(2), db = null, fetchImpl = fetch) {
    const dryRun = args.includes('--dry-run');
    const refresh = args.includes('--refresh');
    const sample = args.includes('--sample');
    const runKind = option(args, 'run-kind', 'probe');
    const rawLimit = Number(option(args, 'limit', dryRun ? 5 : 100));
    const limit = Number.isInteger(rawLimit) && rawLimit >= 0 ? rawLimit : 100;
    const rawConcurrency = Number(option(args, 'concurrency', 4));
    const concurrency = Math.min(Math.max(Number.isInteger(rawConcurrency) ? rawConcurrency : 4, 1), 12);
    if (!dryRun && !db) throw new Error('\u0434\u043b\u044f \u0437\u0430\u043f\u0438\u0441\u0438 \u043d\u0443\u0436\u0435\u043d DB pool');
    let sourceRun = null;
    const stat = { pagesFetched: 0, itemsSeen: 0, observationsSaved: 0, candidatesStaged: 0, errorsCount: 0 };
    if (!dryRun) sourceRun = await startSourceRun(db, SOURCE_KEY, runKind);
    try {
        const discovery = await discoverProducts(fetchImpl);
        stat.pagesFetched = discovery.maps + 1;
        const discoveryItems = sample ? sampleItems(discovery.items, limit) : discovery.items;
        const selected = dryRun
            ? (limit ? discoveryItems.slice(0, limit) : discoveryItems)
            : await selectSourceItems(db, SOURCE_KEY, discoveryItems, { limit, refresh });
        console.log(`sitemap=${discovery.maps} \u043c\u043e\u043d\u0435\u0442\u043d\u044b\u0445 URL=${discovery.items.length} \u0432\u044b\u0431\u0440\u0430\u043d\u043e=${selected.length}`);
        for (let offset = 0; offset < selected.length; offset += 50) {
            const batch = await fetchBatch(selected.slice(offset, offset + 50), concurrency, fetchImpl);
            for (const result of batch) {
                stat.pagesFetched += 1;
                stat.itemsSeen += 1;
                if (result.error) {
                    stat.errorsCount += 1;
                    console.error(`ERROR ${result.item.sourceItemKey}: ${result.error.message}`);
                    continue;
                }
                const product = result.product;
                if (dryRun) {
                    const usable = isUsableCoinProduct(product, parsedProductTitle(product));
                    console.log(`${usable ? 'COIN' : 'SKIP'} ${product.sourceItemKey || result.item.sourceItemKey} ${product.itemStatus} ${product.year || '-'} \u0444\u043e\u0442\u043e=${Number(Boolean(product.aversImageUrl)) + Number(Boolean(product.reversImageUrl))} | ${product.title || '-'}`);
                    continue;
                }
                try {
                    const outcome = await ingestProduct(db, product);
                    stat[outcome] = (stat[outcome] || 0) + 1;
                    if (!['set', 'noncoin'].includes(outcome)) stat.observationsSaved += 1;
                    if (outcome === 'candidate-new') stat.candidatesStaged += 1;
                } catch (error) {
                    stat.errorsCount += 1;
                    console.error(`ERROR ${product.sourceItemKey || result.item.sourceItemKey}: ${error.message}`);
                }
            }
            console.log(`\u043e\u0431\u0440\u0430\u0431\u043e\u0442\u0430\u043d\u043e ${Math.min(offset + 50, selected.length)}/${selected.length}`);
        }
        if (sourceRun) await finishSourceRun(db, sourceRun.id, stat.errorsCount ? 'partial' : 'succeeded', {
            ...stat,
            cursor: JSON.stringify({ lastSourceItemKey: selected.at(-1)?.sourceItemKey || null }),
            errorSummary: stat.errorsCount ? `${stat.errorsCount} \u043a\u0430\u0440\u0442\u043e\u0447\u0435\u043a \u0437\u0430\u0432\u0435\u0440\u0448\u0438\u043b\u0438\u0441\u044c \u043e\u0448\u0438\u0431\u043a\u043e\u0439` : null,
        });
        console.log('\u0438\u0442\u043e\u0433:', JSON.stringify(stat));
        return stat;
    } catch (error) {
        if (sourceRun) await finishSourceRun(db, sourceRun.id, 'failed', { ...stat, errorSummary: error.message });
        throw error;
    }
}

if (require.main === module) {
    const args = process.argv.slice(2);
    const db = args.includes('--dry-run') ? null : require('./db').pool;
    run(args, db)
        .catch((error) => { console.error('FATAL', error.message); process.exitCode = 1; })
        .finally(() => db && db.end());
}

module.exports = { discoverProducts, fetchBatch, fetchText, ingestProduct, parsedProductTitle, run };

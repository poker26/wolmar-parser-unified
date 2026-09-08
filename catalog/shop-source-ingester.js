/** Shared runner for catalog-only shop/reference adapters. */
'use strict';

const { DIAG, matchType, parseTitle } = require('./coin-matcher');
const { stageCatalogCandidate } = require('./catalog-candidates');
const { finishSourceRun, startSourceRun } = require('./source-registry');
const { completeSourceItem, sampleItems, selectSourceItems, upsertSourceItem } = require('./shop-source-items');

const USER_AGENT = 'WolmarCatalog/1.0 (catalog identity ingestion)';

function option(args, name, fallback = null) {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : fallback;
}

async function fetchText(url, fetchImpl = fetch, options = {}) {
    const retries = Number.isInteger(options.retries) ? Math.max(0, options.retries) : 2;
    const sleep = options.sleep || ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
            const response = await fetchImpl(url, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(30000) });
            if (!response.ok) {
                const retriable = [408, 425, 429].includes(response.status) || response.status >= 500;
                const error = new Error(`${url}: HTTP ${response.status}`);
                if (!retriable || attempt === retries) throw error;
                await response.body?.cancel?.().catch?.(() => {});
                lastError = error;
            } else {
                const contentType = response.headers?.get?.('content-type') || '';
                const charset = contentType.match(/charset\s*=\s*["']?([^;\s"']+)/i)?.[1];
                if (charset && !/^utf-?8$/i.test(charset) && typeof response.arrayBuffer === 'function') {
                    return new TextDecoder(charset).decode(await response.arrayBuffer());
                }
                return response.text();
            }
        } catch (error) {
            lastError = error;
            if (attempt === retries || /HTTP (?:4\d\d)/.test(error.message) && !/HTTP (?:408|425|429)/.test(error.message)) throw error;
        }
        await sleep(attempt === 0 ? 500 : 1500);
    }
    throw lastError;
}

function intervalFetch(fetchImpl, intervalMs) {
    if (!intervalMs) return fetchImpl;
    let nextStart = 0;
    let queue = Promise.resolve();
    return async (...args) => {
        let release;
        const previous = queue;
        queue = new Promise((resolve) => { release = resolve; });
        await previous;
        const waitMs = Math.max(0, nextStart - Date.now());
        if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
        nextStart = Date.now() + intervalMs;
        release();
        return fetchImpl(...args);
    };
}

function createShopIngester({
    sourceKey,
    matchMethod,
    discoverProducts,
    parseProduct,
    isUsableProduct,
    acceptMatch = null,
    candidateIdentity = null,
    matchProduct = matchType,
    normalizeParsed = null,
    requestIntervalMs = 0,
}) {
    if (![sourceKey, matchMethod, discoverProducts, parseProduct, isUsableProduct].every(Boolean)) {
        throw new Error('\u0430\u0434\u0430\u043f\u0442\u0435\u0440 \u043c\u0430\u0433\u0430\u0437\u0438\u043d\u0430 \u0437\u0430\u0434\u0430\u043d \u043d\u0435 \u043f\u043e\u043b\u043d\u043e\u0441\u0442\u044c\u044e');
    }

    function parsedProductTitle(product) {
        const sourceTitle = product.matchTitle || product.title;
        const matchTitle = product.country && !sourceTitle.toLowerCase().includes(product.country.toLowerCase())
            ? `${sourceTitle} ${product.country}`
            : sourceTitle;
        const parsed = parseTitle(matchTitle);
        return normalizeParsed ? normalizeParsed(parsed, product) : parsed;
    }

    async function ingestProduct(db, product) {
        const parsed = parsedProductTitle(product);
        if (!isUsableProduct(product, parsed)) return parsed.isSet ? 'set' : 'noncoin';
        const row = await upsertSourceItem(db, product);
        const existingLink = (await db.query(
            `SELECT type_id,match_method
               FROM catalog_source_item_type_link
              WHERE source_item_id=$1`,
            [row.id],
        )).rows[0] || null;
        if (existingLink?.match_method === 'catalog_candidate_review') {
            return completeSourceItem(db, row.id, 'linked-reviewed-refresh');
        }
        if (!parsed.year || !parsed.denom) return completeSourceItem(db, row.id, 'stored-incomplete');

        DIAG.on = true;
        const match = await matchProduct(db, parsed);
        let matchReason = DIAG.reason;
        let acceptedMatch = Boolean(match);
        if (match && acceptMatch) {
            const decision = await acceptMatch(db, { product, parsed, match, sourceItem: row });
            acceptedMatch = decision && typeof decision === 'object' ? decision.accepted !== false : Boolean(decision);
            if (!acceptedMatch) {
                const reason = decision && typeof decision === 'object' ? decision.reason : null;
                matchReason = `нет типа: проверка официального источника отклонила совпадение${reason ? ` (${reason})` : ''}`;
                await db.query(
                    `DELETE FROM catalog_source_item_type_link
                      WHERE source_item_id=$1 AND match_method=$2`,
                    [row.id, matchMethod],
                );
            }
        }
        if (match && acceptedMatch) {
            await db.query(
                `INSERT INTO catalog_source_item_type_link
                   (source_item_id,type_id,match_method,match_confidence)
                 VALUES ($1,$2,$3,$4)
                 ON CONFLICT (source_item_id) DO UPDATE SET
                   type_id=EXCLUDED.type_id,match_method=EXCLUDED.match_method,match_confidence=EXCLUDED.match_confidence`,
                [row.id, match.id, matchMethod, match.conf],
            );
            return completeSourceItem(db, row.id, row.inserted ? 'linked-new' : 'linked-refresh');
        }

        const staged = await stageCatalogCandidate(db, {
            parsed,
            matchReason,
            identityQualifier: candidateIdentity ? candidateIdentity(product, parsed) : null,
            sourceItem: {
                id: row.id,
                sourceSite: sourceKey,
                sourceItemKey: product.sourceItemKey,
                sourceUrl: product.sourceUrl,
                itemStatus: product.itemStatus,
                title: product.title,
                metal: product.metal,
                weightG: product.weightG,
                diameterMm: product.diameterMm,
                condition: product.condition,
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
                    if (item.product) results[index] = { item, product: item.product, fetched: false };
                    else {
                        const html = await fetchText(item.sourceUrl, fetchImpl);
                        results[index] = { item, product: parseProduct(html, item.sourceUrl), fetched: true };
                    }
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
        const sourceFetch = intervalFetch(fetchImpl, requestIntervalMs);
        if (!dryRun) sourceRun = await startSourceRun(db, sourceKey, runKind);
        try {
            const discovery = await discoverProducts(sourceFetch, { dryRun, refresh, sample, runKind, limit });
            stat.pagesFetched = discovery.maps + 1;
            stat.errorsCount += discovery.errorsCount || 0;
            const discoveryItems = sample ? sampleItems(discovery.items, limit) : discovery.items;
            const selected = dryRun
                ? (limit ? discoveryItems.slice(0, limit) : discoveryItems)
                : await selectSourceItems(db, sourceKey, discoveryItems, { limit, refresh });
            console.log(`sitemap=${discovery.maps} \u043a\u0430\u0440\u0442\u043e\u0447\u0435\u043a=${discovery.items.length} \u0432\u044b\u0431\u0440\u0430\u043d\u043e=${selected.length}`);
            for (let offset = 0; offset < selected.length; offset += 50) {
                const batch = await fetchBatch(selected.slice(offset, offset + 50), concurrency, sourceFetch);
                for (const result of batch) {
                    if (result.fetched) stat.pagesFetched += 1;
                    stat.itemsSeen += 1;
                    if (result.error) {
                        stat.errorsCount += 1;
                        console.error(`ERROR ${result.item.sourceItemKey}: ${result.error.message}`);
                        continue;
                    }
                    const product = result.product;
                    if (dryRun) {
                        const usable = isUsableProduct(product, parsedProductTitle(product));
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

    return { fetchBatch, ingestProduct, parsedProductTitle, run };
}

module.exports = { USER_AGENT, createShopIngester, fetchText, intervalFetch, option };

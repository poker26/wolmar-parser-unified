/**
 * Catalog-only numizm.at ingestion.
 *
 * Discovery: official sitemap. Scope: every individual coin, active or archived,
 * with no year cutoff. Asking prices are never read or stored.
 *
 *   node catalog/ingest-numizmat.js --dry-run --limit 5
 *   node catalog/ingest-numizmat.js --run-kind probe --limit 20
 *   node catalog/ingest-numizmat.js --run-kind backfill --limit 500
 *   node catalog/ingest-numizmat.js --run-kind backfill --limit 0   # all unseen cards
 */
'use strict';

const { DIAG, matchType, parseTitle } = require('./coin-matcher');
const { stageCatalogCandidate } = require('./catalog-candidates');
const { finishSourceRun, startSourceRun } = require('./source-registry');
const {
    ORIGIN,
    SOURCE_KEY,
    isUsableCoinProduct,
    parseNumizmatProduct,
    parseProductSitemap,
    parseSitemapIndex,
} = require('./numizmat-shop');

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
    if (!maps.length) throw new Error('официальный sitemap не содержит catalog product maps');
    const products = new Map();
    for (const mapUrl of maps) {
        const xml = await fetchText(mapUrl, fetchImpl);
        for (const item of parseProductSitemap(xml)) products.set(item.sourceItemKey, item);
    }
    return { maps: maps.length, items: [...products.values()] };
}

async function selectItems(db, items, { limit, refresh }) {
    if (refresh) return limit ? items.slice(0, limit) : items;
    const selected = [];
    for (let offset = 0; offset < items.length && (!limit || selected.length < limit); offset += 500) {
        const chunk = items.slice(offset, offset + 500);
        const existing = new Set((await db.query(
            `SELECT source_item_key FROM catalog_source_item
              WHERE source_key=$1 AND source_item_key=ANY($2)
                AND attributes ? '_ingest_outcome'`,
            [SOURCE_KEY, chunk.map((item) => item.sourceItemKey)],
        )).rows.map((row) => row.source_item_key));
        for (const item of chunk) {
            if (!existing.has(item.sourceItemKey)) selected.push(item);
            if (limit && selected.length >= limit) break;
        }
    }
    return selected;
}

function sampleItems(items, limit) {
    if (!limit || items.length <= limit) return items;
    if (limit === 1) return [items[0]];
    return Array.from({ length: limit }, (_, index) => items[Math.round(index * (items.length - 1) / (limit - 1))]);
}

async function upsertSourceItem(db, product) {
    return (await db.query(
        `INSERT INTO catalog_source_item
           (source_key,source_item_key,source_url,item_status,title,country,denomination,year,
            metal,weight_g,diameter_mm,mintage,condition,themes,avers_image_url,revers_image_url,attributes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         ON CONFLICT (source_key,source_item_key) DO UPDATE SET
           source_url=EXCLUDED.source_url,item_status=EXCLUDED.item_status,title=EXCLUDED.title,
           country=EXCLUDED.country,denomination=EXCLUDED.denomination,year=EXCLUDED.year,
           metal=EXCLUDED.metal,weight_g=EXCLUDED.weight_g,diameter_mm=EXCLUDED.diameter_mm,
           mintage=EXCLUDED.mintage,condition=EXCLUDED.condition,themes=EXCLUDED.themes,
           avers_image_url=COALESCE(EXCLUDED.avers_image_url,catalog_source_item.avers_image_url),
           revers_image_url=COALESCE(EXCLUDED.revers_image_url,catalog_source_item.revers_image_url),
           attributes=EXCLUDED.attributes,last_seen_at=now(),updated_at=now()
         RETURNING id,(xmax=0) AS inserted`,
        [
            product.sourceKey, product.sourceItemKey, product.sourceUrl, product.itemStatus,
            product.title, product.country, product.denomination, product.year, product.metal,
            product.weightG, product.diameterMm, product.mintage, product.condition, product.themes,
            product.aversImageUrl, product.reversImageUrl, product.attributes,
        ],
    )).rows[0];
}

async function completeSourceItem(db, sourceItemId, outcome) {
    await db.query(
        `UPDATE catalog_source_item
            SET attributes=attributes || jsonb_build_object('_ingest_outcome',$2::text),
                updated_at=now()
          WHERE id=$1`,
        [sourceItemId, outcome],
    );
    return outcome;
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
             VALUES ($1,$2,'numizmat-shop',$3)
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
                results[index] = { item, product: parseNumizmatProduct(html, item.sourceUrl) };
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
    if (!dryRun && !db) throw new Error('для записи нужен DB pool');
    let sourceRun = null;
    const stat = { pagesFetched: 0, itemsSeen: 0, observationsSaved: 0, candidatesStaged: 0, errorsCount: 0 };
    if (!dryRun) sourceRun = await startSourceRun(db, SOURCE_KEY, runKind);
    try {
        const discovery = await discoverProducts(fetchImpl);
        stat.pagesFetched = discovery.maps + 1;
        const discoveryItems = sample ? sampleItems(discovery.items, limit) : discovery.items;
        const selected = dryRun
            ? (limit ? discoveryItems.slice(0, limit) : discoveryItems)
            : await selectItems(db, discoveryItems, { limit, refresh });
        console.log(`sitemap=${discovery.maps} монетных карточек=${discovery.items.length} выбрано=${selected.length}`);
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
                    console.log(`${usable ? 'COIN' : 'SKIP'} ${product.sourceItemKey} ${product.itemStatus} ${product.year || '-'} фото=${Number(Boolean(product.aversImageUrl)) + Number(Boolean(product.reversImageUrl))} | ${product.title}`);
                    continue;
                }
                try {
                    const outcome = await ingestProduct(db, product);
                    stat[outcome] = (stat[outcome] || 0) + 1;
                    if (!['set', 'noncoin'].includes(outcome)) stat.observationsSaved += 1;
                    if (outcome === 'candidate-new') stat.candidatesStaged += 1;
                } catch (error) {
                    stat.errorsCount += 1;
                    console.error(`ERROR ${product.sourceItemKey}: ${error.message}`);
                }
            }
            console.log(`обработано ${Math.min(offset + 50, selected.length)}/${selected.length}`);
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
    run(args, db)
        .catch((error) => { console.error('FATAL', error.message); process.exitCode = 1; })
        .finally(() => db && db.end());
}

module.exports = {
    completeSourceItem,
    discoverProducts,
    fetchBatch,
    fetchText,
    ingestProduct,
    parsedProductTitle,
    run,
    sampleItems,
    selectItems,
    upsertSourceItem,
};

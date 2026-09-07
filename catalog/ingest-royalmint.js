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
    metalFamily,
} = require('./royalmint-catalog');

function normalizedIdentityTitle(value) {
    return String(value || '')
        .normalize('NFKC')
        .replace(/[\u2010-\u2015\u2212]/g, '-')
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function numericConflict(sourceValue, catalogValue, absoluteTolerance, relativeTolerance = 0.005) {
    if (sourceValue == null || catalogValue == null) return false;
    const source = Number(sourceValue);
    const catalog = Number(catalogValue);
    if (!Number.isFinite(source) || !Number.isFinite(catalog)) return false;
    return Math.abs(source - catalog) > Math.max(absoluteTolerance, Math.abs(source) * relativeTolerance);
}

function royalMintMatchDecision(product, type) {
    const officialTitle = normalizedIdentityTitle(product.title);
    const exactTitle = [type.canonical_name, type.name_full]
        .some((value) => normalizedIdentityTitle(value) === officialTitle);
    if (!officialTitle || !exactTitle) return { accepted: false, reason: 'official_title_mismatch' };

    const sourceMetal = metalFamily(product.metal);
    const catalogMetal = metalFamily(type.metal);
    if (sourceMetal && catalogMetal && sourceMetal !== catalogMetal) {
        return { accepted: false, reason: 'metal_conflict' };
    }
    if (numericConflict(product.weightG, type.mass, 0.05)) {
        return { accepted: false, reason: 'mass_conflict' };
    }
    if (numericConflict(product.diameterMm, type.diameter, 0.05)) {
        return { accepted: false, reason: 'diameter_conflict' };
    }
    return { accepted: true, reason: 'exact_official_title' };
}

async function acceptRoyalMintMatch(db, { product, match }) {
    const type = (await db.query(
        `SELECT id,name_full,canonical_name,metal,mass,diameter,quality
           FROM coin_type
          WHERE id=$1`,
        [match.id],
    )).rows[0];
    return type ? royalMintMatchDecision(product, type) : { accepted: false, reason: 'missing_type' };
}

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
    acceptMatch: acceptRoyalMintMatch,
    candidateIdentity: (product) => normalizedIdentityTitle(product.title),
});

if (require.main === module) {
    const args = process.argv.slice(2);
    const db = args.includes('--dry-run') ? null : require('./db').pool;
    ingester.run(args, db)
        .catch((error) => { console.error('FATAL', error.message); process.exitCode = 1; })
        .finally(() => db && db.end());
}

module.exports = {
    ...ingester,
    acceptRoyalMintMatch,
    discoverProducts,
    fetchSitemaps,
    normalizedIdentityTitle,
    royalMintMatchDecision,
};

/**
 * Pure parser and discovery helpers for numizm.at.
 * Product discovery uses the official sitemap instead of crawling heavy catalog pagination.
 * Asking prices are intentionally ignored: this adapter supplies catalog identity evidence only.
 */
'use strict';

const cheerio = require('cheerio');

const ORIGIN = 'https://numizm.at';
const SOURCE_KEY = 'numizm.at';
const COIN_SKU = /(?:^|_)((?:m[12]|t11|k(?:[1-8]|1[0-2]|27))_\d+)(?:_|$)/i;

function absoluteUrl(value, base = ORIGIN) {
    if (!value) return null;
    try { return new URL(value, base).href; } catch (_) { return null; }
}

function parseSitemapIndex(xml) {
    return [...String(xml || '').matchAll(/<loc>([^<]+)<\/loc>/g)]
        .map((match) => match[1].replaceAll('&amp;', '&'))
        .filter((url) => /^https:\/\/numizm\.at\/sitemap-iblock-2(?:\.part\d+)?\.xml$/i.test(url));
}

function sourceItemKeyFromUrl(value) {
    let slug;
    try { slug = new URL(value, ORIGIN).pathname.split('/').filter(Boolean).pop() || ''; } catch (_) { return null; }
    const match = slug.match(COIN_SKU);
    return match ? match[1].toUpperCase() : null;
}

function normalizeSourceItemKey(value) {
    const match = String(value || '').toUpperCase().match(/^((?:M[12]|T11|K(?:[1-8]|1[0-2]|27)))[-_](\d+)$/);
    return match ? `${match[1]}_${match[2]}` : null;
}

function parseProductSitemap(xml) {
    const seen = new Set();
    const items = [];
    for (const match of String(xml || '').matchAll(/<loc>(https:\/\/numizm\.at\/catalog\/products\/[^<]+)<\/loc>/gi)) {
        const sourceUrl = match[1].replaceAll('&amp;', '&');
        const sourceItemKey = sourceItemKeyFromUrl(sourceUrl);
        if (!sourceItemKey || seen.has(sourceItemKey)) continue;
        seen.add(sourceItemKey);
        items.push({ sourceItemKey, sourceUrl });
    }
    return items;
}

function numberValue(value) {
    const match = String(value || '').replace(/\s+/g, '').replace(',', '.').match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
}

function integerValue(value) {
    const digits = String(value || '').replace(/\D/g, '');
    return digits ? Number(digits) : null;
}

function cleanTitle(value) {
    return String(value || '')
        .replace(/\s*[\[(]Артикул\s*:[^\])]+[\])]\s*$/i, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function parseNumizmatProduct(html, requestedUrl = ORIGIN) {
    const $ = cheerio.load(String(html || ''));
    const attributes = {};
    $('[itemprop="additionalProperty"]').each((_, element) => {
        const name = $(element).find('[itemprop="name"]').attr('content') || $(element).find('[itemprop="name"]').text();
        const value = $(element).find('[itemprop="value"]').attr('content') || $(element).find('[itemprop="value"]').text();
        if (name && value) attributes[name.trim()] = value.trim();
    });

    const canonical = absoluteUrl($('link[rel="canonical"]').attr('href'), requestedUrl) || absoluteUrl(requestedUrl);
    const title = cleanTitle($('.product-title[itemprop="name"]').first().text() || $('h1').first().text());
    const skuText = $('.product-sku').first().text();
    const sourceItemKey = normalizeSourceItemKey((skuText.match(/Арт\.\s*([A-ZА-Я0-9-]+)/i) || [])[1])
        || sourceItemKeyFromUrl(canonical);
    const availability = $('[itemprop="availability"]').attr('href') || '';
    const stockText = $('.product-in-stock').first().text();
    let itemStatus = 'unknown';
    if (/InStock/i.test(availability) || /В наличии/i.test(stockText)) itemStatus = 'active';
    else if (/OutOfStock|SoldOut|Discontinued/i.test(availability) || /нет в наличии|архив/i.test(stockText)) itemStatus = 'archive';

    const avers = absoluteUrl($('.link-avers').first().attr('href') || $('[itemprop="image"]').first().attr('src'), canonical);
    const revers = absoluteUrl($('.link-revers').first().attr('href') || $('img.back').first().attr('src'), canonical);
    const themes = String(attributes['Тематика'] || '').split(',').map((value) => value.trim()).filter(Boolean);
    const yearMatch = String(attributes['Год'] || attributes['Период'] || '').match(/(?:1\d{3}|20\d{2})/);
    const year = yearMatch ? Number(yearMatch[0]) : null;

    return {
        sourceKey: SOURCE_KEY,
        sourceItemKey,
        sourceUrl: canonical,
        itemStatus,
        title,
        country: attributes['Страна'] || null,
        denomination: attributes['Номинал'] || null,
        year: year && year >= 1000 && year <= 2100 ? year : null,
        metal: attributes['Металл'] || null,
        weightG: numberValue(attributes['Вес']),
        diameterMm: numberValue(attributes['Диаметр']),
        mintage: integerValue(attributes['Тираж']),
        condition: attributes['Состояние'] || null,
        themes,
        aversImageUrl: avers,
        reversImageUrl: revers,
        attributes,
    };
}

function isUsableCoinProduct(product, parsedTitle) {
    return Boolean(
        product && product.sourceItemKey && product.sourceUrl && product.title
        && parsedTitle && !parsedTitle.isNonCoin && !parsedTitle.isSet
        && (product.denomination || parsedTitle.denom)
        && (product.year || parsedTitle.year)
        && !/(?:подделк|реплик|муляж|сувенир|монетовидн\w*\s+жетон|копи[яи]\s+монет)/i.test(product.title),
    );
}

module.exports = {
    COIN_SKU,
    ORIGIN,
    SOURCE_KEY,
    absoluteUrl,
    cleanTitle,
    isUsableCoinProduct,
    parseNumizmatProduct,
    parseProductSitemap,
    parseSitemapIndex,
    normalizeSourceItemKey,
    sourceItemKeyFromUrl,
};

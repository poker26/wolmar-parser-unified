/** Pure sitemap and product-card parsing for Monetnik.ru modern coins. */
'use strict';

const cheerio = require('cheerio');

const ORIGIN = 'https://www.monetnik.ru';
const SOURCE_KEY = 'monetnik.ru';

function cleanText(value) {
    return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function absoluteUrl(value, base = ORIGIN) {
    if (!value) return null;
    try {
        const url = new URL(value, base);
        if (!/(?:^|\.)monetnik\.ru$/i.test(url.hostname) && !/^cdn\.monetnik\.ru$/i.test(url.hostname)) return null;
        url.protocol = 'https:';
        url.hash = '';
        return url.href;
    } catch (_) {
        return null;
    }
}

function parseSitemapIndex(xml) {
    const urls = [];
    for (const match of String(xml || '').matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)) {
        const url = absoluteUrl(match[1]);
        if (url && /\/sitemap\.xml\/www\.monetnik\.ru_\d+\.xml$/.test(new URL(url).pathname)) urls.push(url);
    }
    return [...new Set(urls)];
}

function sourceItemKeyFromUrl(value) {
    const url = absoluteUrl(value);
    return url ? new URL(url).pathname.match(/-(\d+)\/$/)?.[1] || null : null;
}

function parseModernCoinUrls(xml) {
    const items = new Map();
    for (const match of String(xml || '').matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)) {
        const sourceUrl = absoluteUrl(match[1]);
        if (!sourceUrl) continue;
        const path = new URL(sourceUrl).pathname;
        const year = Number(path.match(/-(20\d{2})(?:-|\/)/)?.[1]);
        const sourceItemKey = sourceItemKeyFromUrl(sourceUrl);
        if (!path.startsWith('/monety/') || !sourceItemKey || !Number.isInteger(year) || year < 2019 || year > 2100) continue;
        items.set(sourceItemKey, { sourceItemKey, sourceUrl });
    }
    return [...items.values()];
}

function propertyMap($) {
    const values = {};
    $('[itemprop="additionalProperty"]').each((_, element) => {
        const key = cleanText($(element).find('[itemprop="name"]').first().text()).replace(/:$/, '');
        const value = cleanText($(element).find('[itemprop="value"]').first().text());
        if (key && value && !/(?:цен|стоимост)/i.test(key)) values[key] = value;
    });
    return values;
}

function numberValue(value) {
    const match = cleanText(value).replace(',', '.').match(/\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
}

function integerValue(value) {
    const digits = cleanText(value).match(/\d[\d\s]*/)?.[0].replace(/\s/g, '');
    return digits ? Number(digits) : null;
}

function productImages($) {
    const images = [];
    const seen = new Set();
    $('.product-hero__imglist a[data-zoom-image]').each((_, element) => {
        const url = absoluteUrl($(element).attr('data-zoom-image'));
        if (url && !seen.has(url)) { seen.add(url); images.push(url); }
    });
    return { avers: images[0] || null, revers: images[1] || null, all: images };
}

function parseMonetnikProduct(html, requestedUrl = ORIGIN) {
    const $ = cheerio.load(String(html || ''));
    const sourceUrl = absoluteUrl($('link[rel="canonical"]').attr('href') || requestedUrl);
    const sourceItemKey = cleanText($('meta[itemprop="sku"]').attr('content')) || sourceItemKeyFromUrl(sourceUrl);
    const title = cleanText($('h1.view__title').first().text());
    const attributes = propertyMap($);
    const year = Number((attributes['Год'] || '').match(/\b(\d{4})\b/)?.[1]) || null;
    const denomination = attributes['Номинал'] || null;
    const country = title.match(/^(.+?)\s+\d+(?:[\s/.,]|$)/)?.[1] || null;
    const images = productImages($);
    const availability = $('link[itemprop="availability"]').attr('href') || '';
    return {
        sourceKey: SOURCE_KEY,
        sourceItemKey,
        sourceUrl,
        itemStatus: /InStock/i.test(availability) ? 'active' : (/OutOfStock|Discontinued/i.test(availability) ? 'archive' : 'unknown'),
        title,
        matchTitle: title,
        country,
        denomination,
        year,
        metal: attributes['Материал'] || null,
        weightG: numberValue(attributes['Вес предмета (г)']),
        diameterMm: numberValue(attributes['Диаметр (мм)']),
        mintage: integerValue(attributes['Тираж (шт)']),
        condition: attributes['Сохранность'] || null,
        themes: [],
        aversImageUrl: images.avers,
        reversImageUrl: images.revers,
        attributes: { ...attributes, media_urls: images.all },
    };
}

function isUsableCoinProduct(product, parsedTitle) {
    return Boolean(product?.sourceItemKey && product?.sourceUrl && product?.title
        && product?.year >= 2019 && product?.denomination
        && product?.aversImageUrl && product?.reversImageUrl
        && !parsedTitle.isSet && !parsedTitle.isNonCoin);
}

module.exports = {
    ORIGIN, SOURCE_KEY, isUsableCoinProduct, parseModernCoinUrls, parseMonetnikProduct,
    parseSitemapIndex, productImages, sourceItemKeyFromUrl,
};

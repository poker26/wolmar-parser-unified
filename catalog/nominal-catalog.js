/** Pure sitemap and product-card parsing for dated coins from nominal.club. */
'use strict';

const cheerio = require('cheerio');

const ORIGIN = 'https://nominal.club';
const SOURCE_KEY = 'nominal.club';

const clean = (value) => String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

function absoluteUrl(value, base = ORIGIN) {
    if (!value) return null;
    try {
        const url = new URL(value, base);
        if (url.hostname !== 'nominal.club') return null;
        url.protocol = 'https:';
        url.hash = '';
        return url.href;
    } catch (_) {
        return null;
    }
}

function parseSitemapIndex(xml) {
    const maps = [];
    for (const match of String(xml || '').matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)) {
        const url = absoluteUrl(match[1]);
        if (url && /\/sitemap-shop-\d+\.xml$/.test(new URL(url).pathname)) maps.push(url);
    }
    return [...new Set(maps)];
}

function sourceItemKeyFromUrl(value) {
    const url = absoluteUrl(value);
    if (!url) return null;
    const path = new URL(url).pathname.replace(/^\/+|\/+$/g, '');
    return path || null;
}

function parseDatedCoinUrls(xml) {
    const items = new Map();
    for (const match of String(xml || '').matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)) {
        const sourceUrl = absoluteUrl(match[1]);
        if (!sourceUrl) continue;
        const path = new URL(sourceUrl).pathname;
        const sourceItemKey = sourceItemKeyFromUrl(sourceUrl);
        const dated = /(?:^|\D)((?:1[5-9]|20)\d{2})-(?:god|goda|g|gg)(?:-|\/)/i.test(path);
        if (!path.startsWith('/category/monety/') || !dated || !sourceItemKey) continue;
        items.set(sourceItemKey, { sourceItemKey, sourceUrl });
    }
    return [...items.values()];
}

function featureMap($) {
    const values = {};
    $('.c-product-feature_product-card').each((_, element) => {
        const name = $(element).find('.c-product-feature__name').first().clone();
        name.children().remove();
        const key = clean(name.text()).replace(/:$/, '');
        const value = clean($(element).find('.c-product-feature__value').first().text());
        if (key && value && !/(?:цен|стоимост)/i.test(key)) values[key] = value;
    });
    return values;
}

function numberValue(value) {
    const match = clean(value).replace(',', '.').match(/\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
}

function integerValue(value) {
    const digits = clean(value).match(/\d[\d.,\s]*/)?.[0].replace(/[^0-9]/g, '');
    return digits ? Number(digits) : null;
}

function productImages($) {
    const images = [];
    const seen = new Set();
    $('.c-product-images__images .c-product-images__image > a[href]').each((_, element) => {
        const url = absoluteUrl($(element).attr('href'));
        if (url && /\/wa-data\/public\/shop\/products\//.test(new URL(url).pathname) && !seen.has(url)) {
            seen.add(url);
            images.push(url);
        }
    });
    return { avers: images[0] || null, revers: images[1] || null, all: images };
}

function parseProduct(html, requestedUrl = ORIGIN) {
    const $ = cheerio.load(String(html || ''));
    const sourceUrl = absoluteUrl($('link[rel="canonical"]').first().attr('href') || requestedUrl);
    const title = clean($('h1').first().text());
    const attributes = featureMap($);
    const year = Number((attributes['Год'] || '').match(/\b(\d{4})\b/)?.[1]) || null;
    const images = productImages($);
    const availability = $('[itemprop="availability"]').first().attr('href') || '';
    return {
        sourceKey: SOURCE_KEY,
        sourceItemKey: sourceItemKeyFromUrl(sourceUrl),
        sourceUrl,
        itemStatus: /InStock/i.test(availability) ? 'active' : (/OutOfStock|Discontinued/i.test(availability) ? 'archive' : 'unknown'),
        title,
        matchTitle: title,
        country: attributes['Страна'] || null,
        denomination: attributes['Номинал'] || null,
        year,
        metal: attributes['Состав'] || null,
        weightG: numberValue(attributes['Вес']),
        diameterMm: numberValue(attributes['Диаметр']),
        mintage: integerValue(attributes['Тираж']),
        condition: attributes['Качество'] || null,
        themes: [],
        aversImageUrl: images.avers,
        reversImageUrl: images.revers,
        attributes: { ...attributes, media_urls: images.all },
    };
}

function usable(product, parsedTitle) {
    return Boolean(product?.sourceItemKey && product?.sourceUrl && product?.title
        && product?.country && product?.year >= 1500 && product?.year <= 2100
        && product?.denomination && product?.aversImageUrl && product?.reversImageUrl
        && !parsedTitle.isSet && !parsedTitle.isNonCoin);
}

module.exports = {
    ORIGIN, SOURCE_KEY, absoluteUrl, featureMap, parseDatedCoinUrls, parseProduct,
    parseSitemapIndex, productImages, sourceItemKeyFromUrl, usable,
};

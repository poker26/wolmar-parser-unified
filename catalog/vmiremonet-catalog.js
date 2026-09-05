/** Pure sitemap and product-card parsing for post-2018 coins from vmiremonet.ru. */
'use strict';

const cheerio = require('cheerio');

const ORIGIN = 'https://vmiremonet.ru';
const SOURCE_KEY = 'vmiremonet.ru';

function cleanText(value) {
    return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function absoluteUrl(value, base = ORIGIN) {
    if (!value) return null;
    try {
        const url = new URL(value, base);
        if (url.hostname !== 'vmiremonet.ru') return null;
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
    return url ? new URL(url).pathname.match(/^\/([^/]+)\/$/)?.[1] || null : null;
}

function parseModernCoinUrls(xml) {
    const items = new Map();
    for (const match of String(xml || '').matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)) {
        const sourceUrl = absoluteUrl(match[1]);
        if (!sourceUrl) continue;
        const path = new URL(sourceUrl).pathname;
        const sourceItemKey = sourceItemKeyFromUrl(sourceUrl);
        const years = [...path.matchAll(/(?:^|\D)(20(?:19|2[0-6]))(?:\D|$)/g)].map((item) => Number(item[1]));
        if (!path.startsWith('/moneta-') || !sourceItemKey || !years.length) continue;
        items.set(sourceItemKey, { sourceItemKey, sourceUrl });
    }
    return [...items.values()];
}

function featureMap($) {
    const values = {};
    $('table.features tr').each((_, row) => {
        const key = cleanText($(row).find('td.name').first().text());
        const value = cleanText($(row).find('td.value').first().text());
        if (key && value && !/(?:цен|стоимост)/i.test(key)) values[key] = value;
    });
    return values;
}

function numberValue(value) {
    const match = cleanText(value).replace(',', '.').match(/\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
}

function integerValue(value) {
    const digits = cleanText(value).match(/\d[\d.,\s]*/)?.[0].replace(/[^0-9]/g, '');
    return digits ? Number(digits) : null;
}

function productImages($) {
    const images = [];
    const seen = new Set();
    $('.product-gallery-wrap a[href]').each((_, element) => {
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
    const sourceUrl = absoluteUrl(requestedUrl);
    const title = cleanText($('h1.product-name, h1 [itemprop="name"]').first().text());
    const attributes = featureMap($);
    const denominationNumber = attributes['Номинал цифра'] || '';
    const denominationName = attributes['Номинал название'] || '';
    const denomination = cleanText(`${denominationNumber} ${denominationName}`) || null;
    const year = Number((attributes['Год выпуска'] || '').match(/\b(\d{4})\b/)?.[1]) || null;
    const images = productImages($);
    const availability = $('[itemprop="availability"]').attr('href') || '';
    return {
        sourceKey: SOURCE_KEY,
        sourceItemKey: sourceItemKeyFromUrl(sourceUrl),
        sourceUrl,
        itemStatus: /InStock/i.test(availability) ? 'active' : (/OutOfStock|Discontinued/i.test(availability) ? 'archive' : 'unknown'),
        title,
        matchTitle: title,
        country: attributes['Страна эмитент'] || null,
        denomination,
        year,
        metal: attributes['Материал'] || null,
        weightG: numberValue(attributes['Вес']),
        diameterMm: numberValue(attributes['Диаметр']),
        mintage: integerValue(attributes['Тираж']),
        condition: attributes['Состояние'] || null,
        themes: attributes['Тематика'] ? [attributes['Тематика']] : [],
        aversImageUrl: images.avers,
        reversImageUrl: images.revers,
        attributes: { ...attributes, media_urls: images.all },
    };
}

function usable(product, parsedTitle) {
    return Boolean(product?.sourceItemKey && product?.sourceUrl && product?.title
        && product?.country && product?.year >= 2019 && product?.denomination
        && product?.aversImageUrl && product?.reversImageUrl
        && !parsedTitle.isSet && !parsedTitle.isNonCoin);
}

module.exports = {
    ORIGIN, SOURCE_KEY, absoluteUrl, featureMap, parseModernCoinUrls, parseProduct,
    parseSitemapIndex, productImages, sourceItemKeyFromUrl, usable,
};

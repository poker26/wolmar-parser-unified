/** Pure sitemap and product-card parsing for moneta1.ru. */
'use strict';

const cheerio = require('cheerio');
const ORIGIN = 'https://moneta1.ru';
const SOURCE_KEY = 'moneta1.ru';
const clean = (value) => String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

function absoluteUrl(value, base = ORIGIN) {
    if (!value) return null;
    try {
        const url = new URL(value, base);
        if (url.hostname !== 'moneta1.ru') return null;
        url.protocol = 'https:';
        url.hash = '';
        return url.href;
    } catch (_) { return null; }
}

function parseSitemapIndex(xml) {
    return [...new Set([...String(xml || '').matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)]
        .map((match) => absoluteUrl(match[1]))
        .filter((url) => url && /\/sitemap-shop-\d+\.xml$/.test(new URL(url).pathname)))];
}

function sourceItemKeyFromUrl(value) {
    const url = absoluteUrl(value);
    return url ? new URL(url).pathname.match(/^\/product\/([^/]+)\/$/)?.[1] || null : null;
}

function parseProductUrls(xml) {
    const items = new Map();
    for (const match of String(xml || '').matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)) {
        const sourceUrl = absoluteUrl(match[1]);
        const sourceItemKey = sourceItemKeyFromUrl(sourceUrl);
        if (sourceItemKey) items.set(sourceItemKey, { sourceItemKey, sourceUrl });
    }
    return [...items.values()];
}

function featureMap($) {
    const values = {};
    $('.features-two-val__block').each((_, element) => {
        const key = clean($(element).find('.features-two-val__name').first().text()).replace(/:$/, '');
        const value = clean($(element).find('.features-two-val__value').first().text());
        if (key && value && !/(?:цен|стоимост)/i.test(key)) values[key] = value;
    });
    return values;
}

const numberValue = (value) => { const m = clean(value).replace(',', '.').match(/\d+(?:\.\d+)?/); return m ? Number(m[0]) : null; };
const integerValue = (value) => { const m = clean(value).match(/\d[\d.,\s]*/)?.[0].replace(/[^0-9]/g, ''); return m ? Number(m) : null; };

function productImages($) {
    const images = [];
    const seen = new Set();
    $('.p-images__slider-item[href]').each((_, element) => {
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
    const title = clean($('h1').first().text());
    const attributes = featureMap($);
    const denominationKey = Object.keys(attributes).find((key) => /^Номинал(?:\s|$)/i.test(key));
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
        denomination: denominationKey ? attributes[denominationKey] : null,
        year,
        metal: attributes['Металл'] || null,
        weightG: numberValue(attributes['Вес']),
        diameterMm: numberValue(attributes['Диаметр монеты']),
        mintage: integerValue(attributes['Тираж']),
        condition: attributes['Состояние'] || null,
        themes: [],
        aversImageUrl: images.avers,
        reversImageUrl: images.revers,
        attributes: { ...attributes, media_urls: images.all },
    };
}

function usable(product, parsedTitle) {
    return Boolean(product?.sourceItemKey && product?.title && product?.country && product?.year
        && product?.denomination && product?.aversImageUrl && product?.reversImageUrl
        && !parsedTitle.isSet && !parsedTitle.isNonCoin);
}

module.exports = { ORIGIN, SOURCE_KEY, absoluteUrl, parseProduct, parseProductUrls, parseSitemapIndex, sourceItemKeyFromUrl, usable };

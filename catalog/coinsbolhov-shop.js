/**
 * Pure parser and discovery helpers for coinsbolhov.ru.
 * The adapter uses only official sitemap/card data and never reads asking prices.
 */
'use strict';

const cheerio = require('cheerio');

const ORIGIN = 'https://coinsbolhov.ru';
const SOURCE_KEY = 'coinsbolhov.ru';
const COIN_PATH = '/catalog/monety/';

function absoluteUrl(value, base = ORIGIN) {
    if (!value) return null;
    try {
        const url = new URL(value, base);
        if (url.hostname === 'coinsbolhov.ru') url.protocol = 'https:';
        return url.href;
    } catch (_) {
        return null;
    }
}

function parseSitemapIndex(xml) {
    return [...String(xml || '').matchAll(/<loc>([^<]+)<\/loc>/g)]
        .map((match) => absoluteUrl(match[1].replaceAll('&amp;', '&')))
        .filter((url) => /^https:\/\/coinsbolhov\.ru\/sitemap-iblock-2(?:\.part\d+)?\.xml$/i.test(url));
}

function sourceItemKeyFromUrl(value) {
    try {
        const url = new URL(value, ORIGIN);
        if (url.hostname !== 'coinsbolhov.ru' || !url.pathname.startsWith(COIN_PATH)) return null;
        const key = url.pathname.slice(COIN_PATH.length).replace(/^\/+|\/+$/g, '');
        return key || null;
    } catch (_) {
        return null;
    }
}

function parseProductSitemap(xml) {
    const seen = new Set();
    const items = [];
    for (const match of String(xml || '').matchAll(/<loc>([^<]+)<\/loc>/gi)) {
        const sourceUrl = absoluteUrl(match[1].replaceAll('&amp;', '&'));
        const sourceItemKey = sourceItemKeyFromUrl(sourceUrl);
        if (!sourceItemKey || seen.has(sourceItemKey) || /\/filter\//i.test(sourceUrl)) continue;
        seen.add(sourceItemKey);
        items.push({ sourceItemKey, sourceUrl });
    }
    return items;
}

function flattenJsonLd(value) {
    if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
    if (!value || typeof value !== 'object') return [];
    return [value, ...flattenJsonLd(value['@graph'])];
}

function readProductJsonLd($) {
    for (const element of $('script[type="application/ld+json"]').toArray()) {
        try {
            const candidates = flattenJsonLd(JSON.parse($(element).text()));
            const product = candidates.find((entry) => {
                const types = Array.isArray(entry['@type']) ? entry['@type'] : [entry['@type']];
                return types.some((type) => String(type).toLowerCase() === 'product');
            });
            if (product) return product;
        } catch (_) {
            // A malformed unrelated JSON-LD block must not hide a later Product block.
        }
    }
    return null;
}

function numberValue(value) {
    const match = String(value || '').replace(/\s+/g, '').replace(',', '.').match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
}

function integerValue(value) {
    const digits = String(value || '').replace(/\D/g, '');
    return digits ? Number(digits) : null;
}

function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function parseCoinsBolhovProduct(html, requestedUrl = ORIGIN) {
    const $ = cheerio.load(String(html || ''));
    const jsonLd = readProductJsonLd($);
    const canonical = absoluteUrl($('link[rel="canonical"]').attr('href') || jsonLd?.url, requestedUrl)
        || absoluteUrl(requestedUrl);
    const attributes = {};
    for (const property of Array.isArray(jsonLd?.additionalProperty) ? jsonLd.additionalProperty : []) {
        const name = cleanText(property?.name);
        const value = cleanText(property?.value);
        const unit = cleanText(property?.unitText);
        if (name && value) attributes[name] = unit ? `${value} ${unit}` : value;
    }
    $('.product__param').each((_, element) => {
        const name = cleanText($(element).find('.product__param-key').first().text());
        const value = cleanText($(element).find('.product__param-value').first().text());
        if (name && value && !attributes[name]) attributes[name] = value;
    });
    const article = cleanText($('.product__article').first().text()).replace(/^\s*\u0410\u0440\u0442\.\s*/i, '');
    if (article) attributes['\u0410\u0440\u0442\u0438\u043a\u0443\u043b'] = article;

    const title = cleanText($('.product__title').first().text() || jsonLd?.name);
    const tradingText = cleanText($('.product__trading').first().text());
    let itemStatus = 'unknown';
    if ($('.product__trading-buy').length || /\u0432 \u043d\u0430\u043b\u0438\u0447\u0438\u0438/i.test(tradingText)) itemStatus = 'active';
    else if ($('.product__trading .notifyme, .product__trading #btn-subscribe').length
        || /\u0443\u0432\u0435\u0434\u043e\u043c\u0438\u0442\u044c \u043e \u043f\u043e\u0441\u0442\u0443\u043f\u043b\u0435\u043d\u0438\u0438/i.test(tradingText)) itemStatus = 'archive';

    const images = [];
    $('a.product__images-item.fancybox[href]').each((_, element) => {
        const image = absoluteUrl($(element).attr('href'), canonical);
        if (image && !images.includes(image)) images.push(image);
    });
    if (!images.length && jsonLd?.image) {
        const fallbacks = Array.isArray(jsonLd.image) ? jsonLd.image : [jsonLd.image];
        for (const value of fallbacks) {
            const image = absoluteUrl(typeof value === 'string' ? value : value?.url, canonical);
            if (image && !images.includes(image)) images.push(image);
        }
    }

    const yearMatch = String(attributes['\u0413\u043e\u0434'] || '').match(/(?:1\d{3}|20\d{2})/);
    const year = yearMatch ? Number(yearMatch[0]) : null;
    return {
        sourceKey: SOURCE_KEY,
        sourceItemKey: sourceItemKeyFromUrl(canonical),
        sourceUrl: canonical,
        itemStatus,
        title,
        country: attributes['\u0421\u0442\u0440\u0430\u043d\u0430'] || null,
        denomination: attributes['\u041d\u043e\u043c\u0438\u043d\u0430\u043b'] || null,
        year: year && year >= 1000 && year <= 2100 ? year : null,
        metal: attributes['\u041c\u0435\u0442\u0430\u043b\u043b'] || null,
        weightG: numberValue(attributes['\u0412\u0435\u0441']),
        diameterMm: numberValue(attributes['\u0414\u0438\u0430\u043c\u0435\u0442\u0440']),
        mintage: integerValue(attributes['\u0422\u0438\u0440\u0430\u0436']),
        condition: attributes['\u0421\u043e\u0441\u0442\u043e\u044f\u043d\u0438\u0435'] || null,
        themes: [],
        aversImageUrl: images[0] || null,
        reversImageUrl: images[1] || null,
        attributes,
    };
}

function isUsableCoinProduct(product, parsedTitle) {
    return Boolean(
        product && product.sourceItemKey && product.sourceUrl && product.title
        && parsedTitle && !parsedTitle.isNonCoin && !parsedTitle.isSet
        && (product.denomination || parsedTitle.denom)
        && (product.year || parsedTitle.year)
        && !/(?:\u043d\u0430\u0431\u043e\u0440\s+\u043c\u043e\u043d\u0435\u0442|\u043f\u043e\u0434\u0434\u0435\u043b\u043a|\u0440\u0435\u043f\u043b\u0438\u043a|\u043c\u0443\u043b\u044f\u0436|\u0441\u0443\u0432\u0435\u043d\u0438\u0440|\u043a\u043e\u043f\u0438[\u044f\u0438]\s+\u043c\u043e\u043d\u0435\u0442|\u043c\u043e\u043d\u0435\u0442\u043e\u0432\u0438\u0434\u043d\w*\s+(?:\u0436\u0435\u0442\u043e\u043d|\u0441\u043b\u0438\u0442\u043e\u043a)|\u0437\u0430\u0433\u043e\u0442\u043e\u0432\u043a\w*\s+(?:\u0434\u043b\u044f\s+)?\u043c\u043e\u043d\u0435\u0442)/i.test(product.title),
    );
}

module.exports = {
    COIN_PATH,
    ORIGIN,
    SOURCE_KEY,
    absoluteUrl,
    isUsableCoinProduct,
    parseCoinsBolhovProduct,
    parseProductSitemap,
    parseSitemapIndex,
    sourceItemKeyFromUrl,
};

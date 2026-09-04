/**
 * Pure parser and discovery helpers for the public catalog at всемонеты.рф.
 * Valuation figures are deliberately excluded from catalog identity evidence.
 */
'use strict';

const cheerio = require('cheerio');

const ORIGIN = 'https://xn--b1aga1affsn5f.xn--p1ai';
const SOURCE_KEY = 'xn--b1aga1affsn5f.xn--p1ai';

function absoluteUrl(value, base = ORIGIN) {
    if (!value) return null;
    try {
        const url = new URL(value, base);
        if (url.hostname !== new URL(ORIGIN).hostname) return null;
        url.protocol = 'https:';
        url.search = '';
        url.hash = '';
        return url.href;
    } catch (_) {
        return null;
    }
}

function sourceItemKeyFromUrl(value) {
    const sourceUrl = absoluteUrl(value);
    if (!sourceUrl) return null;
    const key = new URL(sourceUrl).pathname.replace(/^\/+|\/+$/g, '');
    return key || null;
}

function parseProductSitemap(xml) {
    const seen = new Set();
    const items = [];
    for (const match of String(xml || '').matchAll(/<loc>([^<]+)<\/loc>/gi)) {
        const sourceUrl = absoluteUrl(match[1].replaceAll('&amp;', '&'));
        const sourceItemKey = sourceItemKeyFromUrl(sourceUrl);
        if (!sourceItemKey || seen.has(sourceItemKey)) continue;
        seen.add(sourceItemKey);
        items.push({ sourceItemKey, sourceUrl });
    }
    return items;
}

function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function numberValue(value) {
    const match = cleanText(value).replace(',', '.').match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
}

function singleTitleYear(title) {
    const years = [...String(title || '').matchAll(/(?<!\d)(?:1\d{3}|20\d{2})(?!\d)/g)].map((match) => Number(match[0]));
    const unique = [...new Set(years)];
    return unique.length === 1 && unique[0] >= 1000 && unique[0] <= 2100 ? unique[0] : null;
}

function exactYear(value) {
    const match = cleanText(value).match(/^(?:1\d{3}|20\d{2})$/);
    return match ? Number(match[0]) : null;
}

function integerValue(value) {
    const cleaned = cleanText(value).replace(/\u0448\u0442\.?/gi, '').replace(/[\s.\u00a0]/g, '');
    return /^\d+$/.test(cleaned) ? Number(cleaned) : null;
}

function hasPrimaryYearRange(title) {
    return /^[^,()]{0,100}(?<!\d)(?:1\d{3}|20\d{2})\s*[-\u2013\u2014]\s*(?:1\d{3}|20\d{2})(?!\d)\s*(?:\u0433\u043e\u0434|\u0433\u0433\.?)/i.test(cleanText(title));
}

function parseVsemonetyProduct(html, requestedUrl = ORIGIN) {
    const $ = cheerio.load(String(html || ''));
    const canonical = absoluteUrl($('link[rel="canonical"]').attr('href'), requestedUrl) || absoluteUrl(requestedUrl);
    const title = cleanText($('h1').first().text());
    const attributes = {};
    $('.ty-product-feature').each((_, element) => {
        const name = cleanText($(element).find('.ty-product-feature__label').first().text()).replace(/:\s*$/, '');
        const value = cleanText($(element).find('.ty-product-feature__value').first().text());
        if (name && value && !attributes[name] && !/^\u0446\u0435\u043d\u0430(?:\s|$)/i.test(name)) attributes[name] = value;
    });

    const productRoot = $('[itemscope][itemtype*="schema.org/Product"]').first();
    const productId = productRoot.length ? ($('input[name$="[product_id]"]').first().attr('value') || null) : null;
    if (productId) attributes['product_id'] = productId;

    const images = [];
    $('[id^="product_images_"] a.cm-image-previewer[href]').first().each((_, element) => {
        const image = absoluteUrl($(element).attr('href'), canonical);
        if (image && !images.includes(image)) images.push(image);
    });

    return {
        sourceKey: SOURCE_KEY,
        sourceItemKey: sourceItemKeyFromUrl(canonical),
        sourceUrl: canonical,
        itemStatus: 'unknown',
        title,
        country: attributes['\u0421\u0442\u0440\u0430\u043d\u0430'] || null,
        denomination: attributes['\u041d\u043e\u043c\u0438\u043d\u0430\u043b'] || null,
        year: exactYear(attributes['\u0413\u043e\u0434']) || singleTitleYear(title),
        metal: attributes['\u041c\u0435\u0442\u0430\u043b\u043b'] || null,
        weightG: numberValue(attributes['\u041c\u0430\u0441\u0441\u0430 \u043c\u043e\u043d\u0435\u0442\u044b, \u0433\u0440']),
        diameterMm: numberValue(attributes['\u0414\u0438\u0430\u043c\u0435\u0442\u0440, \u043c\u043c']),
        mintage: integerValue(attributes['\u0422\u0438\u0440\u0430\u0436, \u0448\u0442']),
        condition: attributes['\u041a\u0430\u0447\u0435\u0441\u0442\u0432\u043e'] || null,
        themes: [],
        aversImageUrl: images[0] || null,
        reversImageUrl: images[1] || null,
        attributes,
    };
}

function isUsableCoinProduct(product, parsedTitle) {
    const featureCount = Object.keys(product?.attributes || {}).filter((name) => name !== 'product_id').length;
    return Boolean(
        product && product.attributes && product.attributes.product_id
        && product.sourceItemKey && product.sourceUrl && product.title
        && featureCount >= 2 && product.year && parsedTitle && parsedTitle.denom
        && !parsedTitle.isNonCoin && !parsedTitle.isSet
        && !hasPrimaryYearRange(product.title)
        && !/(?:\u043d\u0430\u0431\u043e\u0440|\u043a\u043e\u043c\u043f\u043b\u0435\u043a\u0442|\u043a\u043e\u043b\u043b\u0435\u043a\u0446\u0438[\u0430-\u044f\u0451]*|\u0431\u0430\u043d\u043a\u043d\u043e\u0442|\u0431\u043e\u043d\u0430|\u043c\u0435\u0434\u0430\u043b|\u0436\u0435\u0442\u043e\u043d|\u0437\u043d\u0430\u0447\u043e\u043a|\u043a\u043e\u043f\u0438[\u044f\u0438]|\u0440\u0435\u043f\u043b\u0438\u043a|\u043c\u0443\u043b\u044f\u0436|\u0441\u0443\u0432\u0435\u043d\u0438\u0440|\u0433\u043e\u0441\u0443\u0434\u0430\u0440\u0441\u0442\u0432\u0435\u043d[\u0430-\u044f\u0451]*\s+\u0437\u0430\u0439\u043c|\u043e\u0431\u043b\u0438\u0433\u0430\u0446|\u043a\u0440\u0435\u0434\u0438\u0442\u043d[\u0430-\u044f\u0451]*\s+\u0431\u0438\u043b\u0435\u0442|\u043a\u0430\u0437\u043d\u0430\u0447\u0435\u0439\u0441\u043a[\u0430-\u044f\u0451]*\s+\u0431\u0438\u043b\u0435\u0442|\u0434\u0435\u043d\u0435\u0436\u043d[\u0430-\u044f\u0451]*\s+\u0437\u043d\u0430\u043a)/i.test(product.title),
    );
}

module.exports = {
    ORIGIN,
    SOURCE_KEY,
    absoluteUrl,
    hasPrimaryYearRange,
    isUsableCoinProduct,
    parseProductSitemap,
    parseVsemonetyProduct,
    singleTitleYear,
    sourceItemKeyFromUrl,
};

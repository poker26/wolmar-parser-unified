/**
 * Pure parser and discovery helpers for imperial-mag.ru.
 * Asking prices and metal-value calculations are outside catalog ingestion.
 */
'use strict';

const cheerio = require('cheerio');

const ORIGIN = 'https://imperial-mag.ru';
const SOURCE_KEY = 'imperial-mag.ru';
const COIN_PATH = '/monety/';

function absoluteUrl(value, base = ORIGIN) {
    if (!value) return null;
    try {
        const url = new URL(value, base);
        if (url.hostname === 'imperial-mag.ru') url.protocol = 'https:';
        return url.href;
    } catch (_) {
        return null;
    }
}

function sourceItemKeyFromUrl(value) {
    try {
        const url = new URL(value, ORIGIN);
        if (url.hostname !== 'imperial-mag.ru' || !url.pathname.startsWith(COIN_PATH)) return null;
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
    const cleaned = String(value || '').replace(/\u0448\u0442\.?/gi, '').replace(/[\s.\u00a0]/g, '');
    return /^\d+$/.test(cleaned) ? Number(cleaned) : null;
}

function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function parseImperialProduct(html, requestedUrl = ORIGIN) {
    const $ = cheerio.load(String(html || ''));
    const canonical = absoluteUrl($('link[rel="canonical"]').attr('href'), requestedUrl) || absoluteUrl(requestedUrl);
    const attributes = {};
    $('.product-property-list__row').each((_, element) => {
        const cells = $(element).find('.product-property-list__column');
        const name = cleanText(cells.eq(0).text());
        const value = cleanText(cells.eq(1).text());
        if (name && value && !attributes[name] && !/^\u0446\u0435\u043d\u0430(?:\s|$)/i.test(name)) attributes[name] = value;
    });
    const infoText = cleanText($('.product-info-price-sticky__info').first().text());
    const article = (infoText.match(/\u0410\u0440\u0442\u0438\u043a\u0443\u043b:\s*([^\s]+)/i) || [])[1] || null;
    if (article) attributes['\u0410\u0440\u0442\u0438\u043a\u0443\u043b'] = article;

    const title = cleanText($('h1').first().text());
    const pageText = cleanText($('.product-info-price-sticky').first().text());
    let itemStatus = 'unknown';
    if (/\u0442\u043e\u0432\u0430\u0440 \u0432 \u043d\u0430\u043b\u0438\u0447\u0438\u0438/i.test(pageText)) itemStatus = 'active';
    else if (/\u043d\u0435\u0442 \u0432 \u043d\u0430\u043b\u0438\u0447\u0438\u0438/i.test(pageText)
        || $('.product-info-price-sticky__button-disabled').length) itemStatus = 'archive';

    const images = [];
    $('a.product-gallery__thumb-link[href*="/original/"]').each((_, element) => {
        const image = absoluteUrl($(element).attr('href'), canonical);
        if (image && !images.includes(image)) images.push(image);
    });
    const structuredYearMatch = String(attributes['\u0413\u043e\u0434'] || '').match(/(?<!\d)(?:1\d{3}|20\d{2})(?!\d)/);
    const titleYearMatch = title.match(/(?<!\d)(?:1\d{3}|20\d{2})(?!\d)/);
    const structuredYear = structuredYearMatch ? Number(structuredYearMatch[0]) : null;
    const titleYear = titleYearMatch ? Number(titleYearMatch[0]) : null;
    if (structuredYear && titleYear && structuredYear !== titleYear) {
        attributes._year_conflict = { structuredYear, titleYear };
    }
    const year = titleYear || structuredYear;
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
        weightG: numberValue(attributes['\u0412\u0435\u0441, \u0433']),
        diameterMm: numberValue(attributes['\u0414\u0438\u0430\u043c\u0435\u0442\u0440, \u043c\u043c']),
        mintage: integerValue(attributes['\u0422\u0438\u0440\u0430\u0436, \u0448\u0442']),
        condition: attributes['\u0421\u043e\u0445\u0440\u0430\u043d\u043d\u043e\u0441\u0442\u044c'] || null,
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
        && !/(?:\u043d\u0430\u0431\u043e\u0440|\u043a\u043e\u043c\u043f\u043b\u0435\u043a\u0442|\u043a\u043e\u043b\u043b\u0435\u043a\u0446\u0438\w*|\u043f\u043e\u0434\u0434\u0435\u043b\u043a|\u0440\u0435\u043f\u043b\u0438\u043a|\u043c\u0443\u043b\u044f\u0436|\u0441\u0443\u0432\u0435\u043d\u0438\u0440|\u043a\u043e\u043f\u0438[\u044f\u0438]\s+\u043c\u043e\u043d\u0435\u0442|\u0436\u0435\u0442\u043e\u043d|\u043c\u043e\u043d\u0435\u0442\u043e\u0432\u0438\u0434\u043d|\u0437\u0430\u0433\u043e\u0442\u043e\u0432\u043a)/i.test(product.title),
    );
}

module.exports = {
    COIN_PATH,
    ORIGIN,
    SOURCE_KEY,
    absoluteUrl,
    isUsableCoinProduct,
    parseImperialProduct,
    parseProductSitemap,
    sourceItemKeyFromUrl,
};

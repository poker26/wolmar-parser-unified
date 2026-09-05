/** Pure sitemap and product-card parsing for collectionmarket.ru. */
'use strict';
const cheerio = require('cheerio');
const ORIGIN = 'https://collectionmarket.ru';
const SOURCE_KEY = 'collectionmarket.ru';
const clean = (value) => String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

function absoluteUrl(value, base = ORIGIN) {
    if (!value) return null;
    try { const u = new URL(value, base); if (u.hostname !== 'collectionmarket.ru') return null; u.protocol = 'https:'; u.hash = ''; return u.href; } catch (_) { return null; }
}

function sourceItemKeyFromUrl(value) {
    const url = absoluteUrl(value); return url ? new URL(url).pathname.replace(/^\/+|\/+$/g, '') || null : null;
}

function parseProductUrls(xml) {
    const items = new Map();
    for (const match of String(xml || '').matchAll(/<url>\s*([\s\S]*?)\s*<\/url>/gi)) {
        const sourceUrl = absoluteUrl(match[1].match(/<loc>\s*([^<]+)\s*<\/loc>/i)?.[1]);
        const priority = Number(match[1].match(/<priority>\s*([0-9.]+)\s*<\/priority>/i)?.[1]);
        const sourceItemKey = sourceItemKeyFromUrl(sourceUrl);
        if (sourceItemKey && priority > 0 && priority < 1) items.set(sourceItemKey, { sourceItemKey, sourceUrl });
    }
    return [...items.values()];
}

function featureMap($) {
    const values = {};
    $('.product-page__char .prop-item').each((_, element) => {
        const key = clean($(element).find('.prop-name__inner').first().text()).replace(/:$/, '');
        const value = clean($(element).find('.prop-spec__inner').first().text());
        if (key && value && !/(?:цен|стоимост)/i.test(key)) values[key] = value;
    });
    return values;
}

const numberValue = (value) => { const m = clean(value).replace(',', '.').match(/\d+(?:\.\d+)?/); return m ? Number(m[0]) : null; };
const integerValue = (value) => { const m = clean(value).match(/\d[\d.,\s]*/)?.[0].replace(/[^0-9]/g, ''); return m ? Number(m) : null; };

function productImages($) {
    const images = []; const seen = new Set();
    $('.mg-product-slides [data-url]').each((_, element) => {
        const url = absoluteUrl($(element).attr('data-url'));
        if (url && /\/uploads\//.test(new URL(url).pathname) && !seen.has(url)) { seen.add(url); images.push(url); }
    });
    return { avers: images[0] || null, revers: images[1] || null, all: images };
}

function parseProduct(html, requestedUrl = ORIGIN) {
    const $ = cheerio.load(String(html || ''));
    const sourceUrl = absoluteUrl($('link[rel="canonical"]').first().attr('href') || requestedUrl);
    const title = clean($('.product-page__title h1, h1').first().text());
    const attributes = featureMap($); const images = productImages($);
    const year = Number((attributes['Год'] || '').match(/\b(\d{4})\b/)?.[1]) || null;
    const stock = clean($('.product-page__info .available').first().text());
    return {
        sourceKey: SOURCE_KEY, sourceItemKey: sourceItemKeyFromUrl(sourceUrl), sourceUrl,
        itemStatus: /в наличии/i.test(stock) ? 'active' : (/нет в наличии|продан/i.test(stock) ? 'archive' : 'unknown'),
        title, matchTitle: title, country: attributes['Страна'] || null, denomination: attributes['Номинал'] || null,
        year, metal: attributes['Материал'] || null, weightG: numberValue(attributes['Вес']), diameterMm: numberValue(attributes['Диаметр']),
        mintage: integerValue(attributes['Тираж']), condition: clean($('.label_monet_status').first().text()) || null, themes: [],
        aversImageUrl: images.avers, reversImageUrl: images.revers, attributes: { ...attributes, media_urls: images.all },
    };
}

function usable(product, parsedTitle) {
    const type = product?.attributes?.['Тип'];
    return Boolean(product?.sourceItemKey && product?.title && product?.country && product?.year && product?.denomination
        && product?.aversImageUrl && product?.reversImageUrl && (!type || /монета/i.test(type))
        && !parsedTitle.isSet && !parsedTitle.isNonCoin);
}

module.exports = { ORIGIN, SOURCE_KEY, absoluteUrl, parseProduct, parseProductUrls, sourceItemKeyFromUrl, usable };

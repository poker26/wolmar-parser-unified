/** Pure sitemap and product-card parsing for rmoneta.ru. */
'use strict';

const cheerio = require('cheerio');
const { parseTitle } = require('./coin-matcher');
const ORIGIN = 'https://www.rmoneta.ru';
const SOURCE_KEY = 'rmoneta.ru';
const clean = (value) => String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

function absoluteUrl(value, base = ORIGIN) {
    if (!value) return null;
    try {
        const url = new URL(value, base);
        if (url.hostname !== 'rmoneta.ru' && url.hostname !== 'www.rmoneta.ru') return null;
        url.protocol = 'https:';
        url.hostname = 'www.rmoneta.ru';
        url.port = '';
        url.hash = '';
        return url.href;
    } catch (_) { return null; }
}

function parseSitemapIndex(xml) {
    return [...new Set([...String(xml || '').matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)]
        .map((match) => absoluteUrl(match[1]))
        .filter((url) => url && /\/sitemap_iblock_7\.xml$/.test(new URL(url).pathname)))];
}

function sourceItemKeyFromUrl(value) {
    const url = absoluteUrl(value);
    if (!url) return null;
    return new URL(url).pathname.match(/^\/catalog\/(?:[^/]+\/)+([0-9]+)\/$/)?.[1] || null;
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
    $('.haraktAll tr').each((_, element) => {
        const key = clean($(element).find('td.name').first().text()).replace(/\s*:$/, '');
        const value = clean($(element).find('td').not('.name').first().text());
        if (key && value && !/(?:цен|стоимост)/i.test(key)) values[key] = value;
    });
    return values;
}

const numberValue = (value) => { const match = clean(value).replace(',', '.').match(/\d+(?:\.\d+)?/); return match ? Number(match[0]) : null; };
const integerValue = (value) => { const match = clean(value).match(/\d[\d.,\s]*/)?.[0].replace(/[^0-9]/g, ''); return match ? Number(match) : null; };

function denominationText(parsed) {
    if (!parsed?.denom) return null;
    if (parsed.denom.named) return parsed.denom.unit;
    const amount = parsed.denom.raw || parsed.denom.num;
    return `${amount} ${parsed.denom.unit}`;
}

function countryFromBreadcrumbs($, sourceUrl) {
    const values = $('.breadcrumb-navigation a').map((_, element) => clean($(element).text())).get();
    const countries = values.map((value) => value.match(/^Монеты\s+(.+)$/i)?.[1] || null)
        .filter((value) => value && !/^(?:других стран|российской|иностранные)/i.test(value));
    if (countries.length) return countries.at(-1);
    const path = new URL(sourceUrl).pathname;
    if (/monety_sssr/i.test(path)) return 'СССР';
    if (/monety_rossiyskoy|monety_rossii/i.test(path)) return 'Россия';
    return null;
}

function parseProduct(html, requestedUrl = ORIGIN) {
    const $ = cheerio.load(String(html || ''));
    const sourceUrl = absoluteUrl(requestedUrl);
    const productRoot = $('[itemtype="http://schema.org/Product"]').first();
    const title = clean(productRoot.find('h1[itemprop="name"]').first().text());
    const parsed = parseTitle(title);
    const attributes = featureMap($);
    const productId = sourceItemKeyFromUrl(sourceUrl);
    if (productId) attributes.product_id = productId;
    const image = absoluteUrl(productRoot.find('a.galerytovar[href*="/upload/iblock/"]').first().attr('href'));
    const country = sourceUrl ? countryFromBreadcrumbs($, sourceUrl) : null;
    const availability = clean(productRoot.find('.avalible').first().text());
    const path = sourceUrl ? new URL(sourceUrl).pathname : '';
    const conditionKey = Object.keys(attributes).find((key) => /состоян/i.test(key));
    return {
        sourceKey: SOURCE_KEY,
        sourceItemKey: productId,
        sourceUrl,
        itemStatus: /в наличии/i.test(availability) ? 'active' : (/arhive|под заказ|нет в наличии/i.test(`${path} ${availability}`) ? 'archive' : 'unknown'),
        title,
        matchTitle: [title, country].filter(Boolean).join(' '),
        country,
        denomination: denominationText(parsed),
        year: parsed.year || null,
        metal: attributes['Материал'] || null,
        weightG: numberValue(attributes['Вес (г)']),
        diameterMm: numberValue(attributes['Диаметр (мм)']),
        mintage: integerValue(attributes['Тираж']),
        condition: conditionKey ? attributes[conditionKey] : null,
        themes: [],
        aversImageUrl: image,
        reversImageUrl: null,
        attributes: { ...attributes, media_urls: image ? [image] : [], composite_sides_image: Boolean(image) },
    };
}

function usable(product, parsedTitle) {
    return Boolean(product?.sourceItemKey && product?.title && product?.year && product?.denomination
        && product?.aversImageUrl && product?.attributes?.composite_sides_image
        && !parsedTitle.isSet && !parsedTitle.isNonCoin);
}

module.exports = { ORIGIN, SOURCE_KEY, absoluteUrl, parseProduct, parseProductUrls, parseSitemapIndex, sourceItemKeyFromUrl, usable };

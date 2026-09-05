/** Pure sitemap/news discovery and product-card parsing for UniCoin. */
'use strict';

const cheerio = require('cheerio');
const { parseTitle } = require('./coin-matcher');

const ORIGIN = 'https://www.unicoin.ru';
const SOURCE_KEY = 'unicoin.ru';

function cleanText(value) {
    return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function absoluteUrl(value, base = ORIGIN) {
    if (!value) return null;
    try {
        const url = new URL(value, base);
        if (!/(?:^|\.)unicoin\.ru$/i.test(url.hostname)) return null;
        url.protocol = 'https:';
        url.hostname = 'www.unicoin.ru';
        url.hash = '';
        return url.href;
    } catch (_) {
        return null;
    }
}

function sourceItemKeyFromUrl(value) {
    const sourceUrl = absoluteUrl(value);
    return sourceUrl ? new URL(sourceUrl).pathname.match(/^\/cat\/id\/(\d+)(?:\/archive)?\/?$/)?.[1] || null : null;
}

function parseSitemapNewsUrls(xml) {
    const urls = [];
    const seen = new Set();
    for (const match of String(xml || '').matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)) {
        const url = absoluteUrl(match[1].replace(/&amp;/g, '&'));
        if (!url || !/^\/news\/id\/\d+\/$/.test(new URL(url).pathname) || seen.has(url)) continue;
        seen.add(url);
        urls.push(url);
    }
    return urls;
}

function parseNewsProducts(html) {
    const $ = cheerio.load(String(html || ''));
    const items = new Map();
    $('a[href*="/cat/id/"]').each((_, element) => {
        const sourceUrl = absoluteUrl($(element).attr('href'));
        const sourceItemKey = sourceItemKeyFromUrl(sourceUrl);
        if (!sourceItemKey) return;
        if (!items.has(sourceItemKey)) items.set(sourceItemKey, { sourceItemKey, sourceUrl, title: '', images: [] });
        const item = items.get(sourceItemKey);
        const title = cleanText($(element).text() || $(element).find('img').attr('alt'));
        if (title.length > item.title.length) item.title = title;
        const image = originalImageUrl($(element).find('img').attr('src'));
        if (image && !item.images.includes(image)) item.images.push(image);
    });
    return [...items.values()].map((item) => {
        const parsed = parseTitle(item.title);
        const denomination = parsed.denom
            ? `${parsed.denom.raw || parsed.denom.num || ''} ${parsed.denom.unit || ''}`.trim() : null;
        return {
            sourceItemKey: item.sourceItemKey,
            sourceUrl: item.sourceUrl,
            product: {
                sourceKey: SOURCE_KEY,
                sourceItemKey: item.sourceItemKey,
                sourceUrl: item.sourceUrl,
                itemStatus: /\/archive\/?$/.test(new URL(item.sourceUrl).pathname) ? 'archive' : 'unknown',
                title: item.title,
                matchTitle: item.title,
                country: null,
                denomination,
                year: parsed.year,
                metal: null,
                weightG: null,
                diameterMm: null,
                mintage: null,
                condition: null,
                themes: [],
                aversImageUrl: item.images[0] || null,
                reversImageUrl: item.images[1] || null,
                attributes: { discovery: 'official-news-sitemap', media_urls: item.images },
            },
        };
    }).filter((item) => item.product.title);
}

function originalImageUrl(value) {
    const url = absoluteUrl(value);
    if (!url || !/\/files\/goods\//.test(new URL(url).pathname)) return null;
    const parsed = new URL(url);
    parsed.pathname = parsed.pathname.replace('/small/', '/').replace(/s\d+x\d+(?=\.[^.]+$)/i, '');
    return parsed.href;
}

function attributeMap($) {
    const attributes = {};
    $('table.dsc tr').each((_, row) => {
        const cells = $(row).children('td');
        if (cells.length < 2) return;
        const key = cleanText(cells.eq(0).text()).replace(/:$/, '');
        const value = cleanText(cells.eq(1).text());
        if (key && value) attributes[key] = value;
    });
    return attributes;
}

function numberValue(value) {
    const match = cleanText(value).replace(',', '.').match(/\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
}

function integerValue(value) {
    const digits = cleanText(value).match(/\d[\d\s]*/)?.[0].replace(/\s/g, '');
    return digits ? Number(digits) : null;
}

function coinImages($) {
    const images = [];
    const seen = new Set();
    $('table.coin a[href*="/files/goods/"]').each((_, element) => {
        const url = absoluteUrl($(element).attr('href'));
        if (url && !seen.has(url)) {
            seen.add(url);
            images.push(url);
        }
    });
    return { avers: images[0] || null, revers: images[1] || null, all: images };
}

function parseUnicoinProduct(html, requestedUrl = ORIGIN) {
    const $ = cheerio.load(String(html || ''));
    const sourceUrl = absoluteUrl(requestedUrl);
    const sourceItemKey = sourceItemKeyFromUrl(sourceUrl);
    const title = cleanText($('#in > h1').first().text() || $('h1').last().text());
    const attributes = attributeMap($);
    const country = attributes['Страна'] || null;
    const denomination = attributes['Номинал'] && attributes['Валюта']
        ? `${attributes['Номинал']} ${attributes['Валюта']}` : attributes['Номинал'] || null;
    const year = /^\d{4}$/.test(attributes['Год'] || '') ? Number(attributes['Год']) : null;
    const images = coinImages($);
    const archived = /\/archive\/?$/.test(new URL(sourceUrl || ORIGIN).pathname)
        || $('td.price-gray, a.wlist').length > 0;
    const matchTitle = [country, denomination, year, title].filter(Boolean).join(' ');
    return {
        sourceKey: SOURCE_KEY,
        sourceItemKey,
        sourceUrl,
        itemStatus: archived ? 'archive' : ($('a.add[href*="/basket/"]').length ? 'active' : 'unknown'),
        title,
        matchTitle,
        country,
        denomination,
        year,
        metal: attributes['Материал'] || null,
        weightG: numberValue(attributes['Вес']),
        diameterMm: numberValue(attributes['Диаметр']),
        mintage: integerValue(attributes['Тираж']),
        condition: attributes['Состояние'] || attributes['Способ чеканки'] || null,
        themes: [],
        aversImageUrl: images.avers,
        reversImageUrl: images.revers,
        attributes: { ...attributes, media_urls: images.all },
    };
}

function isUsableCoinProduct(product, parsedTitle) {
    const title = product?.title || '';
    const hasCoinAttributes = Boolean(product?.country || product?.denomination || product?.year
        || product?.attributes?.['KM#'] || parsedTitle?.denom || parsedTitle?.year);
    return Boolean(product?.sourceItemKey && product?.sourceUrl && title && hasCoinAttributes
        && product?.aversImageUrl && product?.reversImageUrl
        && !parsedTitle.isSet && !parsedTitle.isNonCoin
        && !/(?:^|\s)(?:набор|комплект|жетон|медал|слиток|альбом|капсул|банкнот|бона|сувенир)(?:\s|$)/i.test(title));
}

module.exports = {
    ORIGIN,
    SOURCE_KEY,
    absoluteUrl,
    isUsableCoinProduct,
    parseNewsProducts,
    parseSitemapNewsUrls,
    parseUnicoinProduct,
    originalImageUrl,
    sourceItemKeyFromUrl,
};

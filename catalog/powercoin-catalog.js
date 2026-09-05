/** Pure discovery and product-card parsing for Power Coin. */
'use strict';

const cheerio = require('cheerio');
const { COUNTRY_RU } = require('./emk-catalog');

const ORIGIN = 'https://www.powercoin.it';
const SOURCE_KEY = 'powercoin.it';

function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function absoluteUrl(value, base = ORIGIN) {
    if (!value) return null;
    try {
        const url = new URL(value, base);
        if (!/(?:^|\.)powercoin\.it$/i.test(url.hostname)) return null;
        url.protocol = 'https:';
        url.hostname = 'www.powercoin.it';
        url.hash = '';
        return url.href;
    } catch (_) {
        return null;
    }
}

function sourceItemKeyFromUrl(value) {
    const sourceUrl = absoluteUrl(value);
    if (!sourceUrl) return null;
    return new URL(sourceUrl).pathname.match(/\/(\d+)-[^/]+\.html$/i)?.[1] || null;
}

function parseRegionUrls(html) {
    const $ = cheerio.load(String(html || ''));
    return $('#category-page-149').closest('li').children('ul').children('li').children('a[href]')
        .map((_, element) => absoluteUrl($(element).attr('href'))).get().filter(Boolean);
}

function parseCategoryPage(html) {
    const $ = cheerio.load(String(html || ''));
    const seen = new Set();
    const items = [];
    $('article.product-miniature a[href], [data-id-product] a[href]').each((_, element) => {
        const sourceUrl = absoluteUrl($(element).attr('href'));
        const sourceItemKey = sourceItemKeyFromUrl(sourceUrl);
        if (!sourceItemKey || seen.has(sourceItemKey)) return;
        seen.add(sourceItemKey);
        items.push({ sourceItemKey, sourceUrl });
    });
    let lastPage = 1;
    $('a[href*="page="]').each((_, element) => {
        try {
            const page = Number(new URL($(element).attr('href'), ORIGIN).searchParams.get('page'));
            if (Number.isInteger(page) && page > lastPage) lastPage = page;
        } catch (_) {
            // Ignore malformed navigation links.
        }
    });
    return { items, lastPage };
}

function productSchema($) {
    for (const element of $('script[type="application/ld+json"]').toArray()) {
        try {
            const value = JSON.parse($(element).text());
            if (value?.['@type'] === 'Product') return value;
        } catch (_) {
            // Ignore unrelated JSON-LD blocks.
        }
    }
    return null;
}

function propertyMap(schema) {
    return Object.fromEntries((schema?.additionalProperty || [])
        .filter((item) => item?.name && item.value != null && !/(?:price|cost|offer)/i.test(item.name))
        .map((item) => [cleanText(item.name), cleanText(item.value)]));
}

function numberValue(value) {
    const match = cleanText(value).replace(',', '.').match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
}

function integerValue(value) {
    const text = cleanText(value);
    if (!text || /unlimit|unknown|n\/a/i.test(text)) return null;
    const digits = text.replace(/[^0-9]/g, '');
    return digits ? Number(digits) : null;
}

const UNIT_RU = new Map([
    ['dollar', 'долларов'], ['dollars', 'долларов'], ['cent', 'центов'], ['cents', 'центов'],
    ['euro', 'евро'], ['euros', 'евро'], ['pound', 'фунтов'], ['pounds', 'фунтов'],
    ['pence', 'пенсов'], ['penny', 'пенни'], ['shilling', 'шиллингов'], ['shillings', 'шиллингов'],
    ['franc', 'франков'], ['francs', 'франков'], ['peso', 'песо'], ['pesos', 'песо'],
    ['cedi', 'седи'], ['cedis', 'седи'], ['yuan', 'юаней'], ['rand', 'рандов'],
    ['dinar', 'динаров'], ['dinars', 'динаров'], ['dirham', 'дирхамов'], ['dirhams', 'дирхамов'],
    ['crown', 'крон'], ['crowns', 'крон'], ['koruna', 'крон'], ['kroner', 'крон'], ['krona', 'крон'],
    ['rouble', 'рублей'], ['roubles', 'рублей'], ['ruble', 'рублей'], ['rubles', 'рублей'],
    ['rupee', 'рупий'], ['rupees', 'рупий'], ['zloty', 'злотых'], ['won', 'вон'], ['yen', 'иен'],
    ['forint', 'форинтов'], ['forints', 'форинтов'], ['lira', 'лир'], ['lire', 'лир'],
    ['tala', 'тала'], ['vatu', 'вату'], ['kwacha', 'квач'], ['lari', 'лари'], ['tenge', 'тенге'],
]);

function matcherDenomination(value) {
    const text = cleanText(value);
    if (!text || /\s[-–]\s|\bor\b/i.test(text)) return null;
    const symbol = text.match(/^(\d+(?:[.,]\d+)?)\s*([$€£])$/);
    if (symbol) {
        const unit = symbol[2] === '$' ? 'долларов' : symbol[2] === '£' ? 'фунтов' : 'евро';
        return `${symbol[1].replace(',', '.')} ${unit}`;
    }
    const named = text.match(/^(\d+\s*\/\s*\d+|\d+(?:[.,]\d+)?)\s+([A-Za-z]+)$/);
    if (!named) return null;
    const unit = UNIT_RU.get(named[2].toLowerCase());
    return unit ? `${named[1].replace(/\s/g, '').replace(',', '.')} ${unit}` : null;
}

function coinImages($) {
    const seen = new Set();
    const images = [];
    $('a.pro_popup_trigger[href*="superlarge_default"]').each((_, element) => {
        const url = absoluteUrl($(element).attr('href'));
        if (url && !seen.has(url)) {
            seen.add(url);
            images.push(url);
        }
    });
    return { avers: images[0] || null, revers: images[1] || null, all: images };
}

function parsePowercoinProduct(html, requestedUrl = ORIGIN) {
    const $ = cheerio.load(String(html || ''));
    const schema = productSchema($);
    const attributes = propertyMap(schema);
    const sourceUrl = absoluteUrl(schema?.url || $('link[rel="canonical"]').attr('href'), requestedUrl);
    const sourceItemKey = String(schema?.productID || sourceItemKeyFromUrl(sourceUrl) || '');
    const title = cleanText(schema?.name || $('h1').first().text());
    const country = attributes.Country || null;
    const countryRu = COUNTRY_RU.get(country) || null;
    const denomination = attributes['Face Value'] || null;
    const matchDenomination = matcherDenomination(denomination);
    const structuredYear = /^\d{4}$/.test(attributes.Year || '') ? Number(attributes.Year) : null;
    const titleYear = Number(title.match(/((?:19|20)\d{2})\s*$/)?.[1]) || null;
    const year = structuredYear || titleYear;
    const images = coinImages($);
    const availability = String(schema?.offers?.availability || '');
    let itemStatus = 'unknown';
    if (/OutOfStock|Discontinued/i.test(availability)) itemStatus = 'archive';
    else if (/InStock|PreOrder|OnlineOnly/i.test(availability)) itemStatus = 'active';
    if (structuredYear && titleYear && structuredYear !== titleYear) attributes._year_conflict = { structuredYear, titleYear };
    return {
        sourceKey: SOURCE_KEY,
        sourceItemKey,
        sourceUrl,
        itemStatus,
        title,
        matchTitle: matchDenomination && countryRu && year ? `${matchDenomination} ${year} ${title} ${countryRu}` : title,
        country,
        denomination,
        year: attributes._year_conflict ? null : year,
        metal: attributes.Metal || null,
        weightG: numberValue(attributes['Weight (g)']),
        diameterMm: numberValue(attributes['Diameter (mm)']),
        mintage: integerValue(attributes['Mintage (pcs)']),
        condition: attributes.Quality || null,
        themes: [],
        aversImageUrl: images.avers,
        reversImageUrl: images.revers,
        attributes: { ...attributes, media_urls: images.all },
    };
}

function isUsableCoinProduct(product, parsedTitle) {
    const title = product?.title || '';
    return Boolean(product?.sourceItemKey && product?.sourceUrl && product?.title
        && product?.aversImageUrl && product?.reversImageUrl
        && !product.attributes?._year_conflict
        && /\bcoin\b/i.test(title) && !parsedTitle.isSet && !parsedTitle.isNonCoin
        && !/\b(?:set|medal|medallion|banknote|note|bar|foil|blind box|random)\b/i.test(title)
        && !/\s[-–]\s|\bor\b/i.test(product.denomination || ''));
}

module.exports = {
    ORIGIN,
    SOURCE_KEY,
    absoluteUrl,
    coinImages,
    isUsableCoinProduct,
    matcherDenomination,
    parseCategoryPage,
    parsePowercoinProduct,
    parseRegionUrls,
    sourceItemKeyFromUrl,
};

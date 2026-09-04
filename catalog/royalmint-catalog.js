/** Pure parser and sitemap helpers for public The Royal Mint product cards. */
'use strict';

const cheerio = require('cheerio');

const ORIGIN = 'https://www.royalmint.com';
const SOURCE_KEY = 'royalmint.com';
const COIN_PATH_WORD = /(?:coin|sovereign|guinea|shilling|penny|pence|florin|crown|britannia)/i;

function absoluteUrl(value, base = ORIGIN) {
    if (!value) return null;
    try {
        const url = new URL(value, base);
        if (url.hostname !== 'www.royalmint.com' && url.hostname !== 'royalmint.com') return null;
        url.protocol = 'https:';
        url.hostname = 'www.royalmint.com';
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
    return new URL(sourceUrl).pathname.replace(/^\/+|\/+$/g, '').toLowerCase() || null;
}

function sitemapLocations(xml) {
    return [...String(xml || '').matchAll(/<loc>([^<]+)<\/loc>/gi)]
        .map((match) => match[1].replaceAll('&amp;', '&').trim());
}

function parseSitemapIndex(xml) {
    return [...new Set(sitemapLocations(xml).filter((url) => /[?&]bundle=commerce(?:&|$)/i.test(url)))];
}

function parseCommerceSitemaps(xmlDocuments) {
    const seen = new Set();
    const items = [];
    for (const xml of xmlDocuments) {
        for (const value of sitemapLocations(xml)) {
            const sourceUrl = absoluteUrl(value);
            const sourceItemKey = sourceItemKeyFromUrl(sourceUrl);
            if (!sourceItemKey || !COIN_PATH_WORD.test(sourceItemKey) || seen.has(sourceItemKey)) continue;
            seen.add(sourceItemKey);
            items.push({ sourceItemKey, sourceUrl });
        }
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

function integerValue(value) {
    const cleaned = cleanText(value).replace(/[,\s.\u00a0]/g, '');
    return /^\d+$/.test(cleaned) ? Number(cleaned) : null;
}

function exactYear(value) {
    const match = cleanText(value).match(/^(?:1\d{3}|20\d{2})$/);
    const year = match ? Number(match[0]) : null;
    return year && year <= 2100 ? year : null;
}

function matcherDenomination(value) {
    const denomination = cleanText(value);
    const pounds = denomination.match(/^£\s*(\d+(?:\.\d+)?)$/);
    if (pounds) return `${pounds[1]} фунтов`;
    const pence = denomination.match(/^(\d+(?:\.\d+)?)\s*p$/i);
    if (pence) return `${pence[1]} пенсов`;
    const named = new Map([
        ['sovereign', '1 соверен'],
        ['half sovereign', '1/2 соверена'],
        ['quarter sovereign', '1/4 соверена'],
        ['double sovereign', '2 соверена'],
        ['five sovereign piece', '5 соверенов'],
        ['penny', '1 пенни'],
        ['sixpence', '6 пенсов'],
        ['shilling', '1 шиллинг'],
        ['florin', '1 флорин'],
        ['crown', '1 крона'],
        ['guinea', '1 гинея'],
    ]);
    return named.get(denomination.toLowerCase()) || null;
}

function productJson($) {
    const raw = $('[data-module="product"][data-product-settings]').first().attr('data-product-settings');
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch (_) {
        return null;
    }
}

function productSchema($) {
    for (const element of $('script[type="application/ld+json"]').toArray()) {
        try {
            const value = JSON.parse($(element).text());
            if (value && value['@type'] === 'Product') return value;
        } catch (_) {
            // Ignore unrelated or malformed JSON-LD blocks.
        }
    }
    return null;
}

function safeSpecification($) {
    const attributes = {};
    $('.specification table tr').each((_, element) => {
        const name = cleanText($(element).find('th').first().text());
        const value = cleanText($(element).find('td').first().text());
        if (name && value && !attributes[name] && !/(?:price|value|cost)/i.test(name)) attributes[name] = value;
    });
    return attributes;
}

function coinImages(settings, canonical) {
    const values = [settings?.productDefaultPicture, ...(settings?.productPictures || [])]
        .map((value) => absoluteUrl(value, canonical)).filter(Boolean);
    const obverse = values.find((value) => /obverse/i.test(value));
    const reverse = values.find((value) => /reverse/i.test(value));
    return { obverse: obverse || values[0] || null, reverse: reverse || values[1] || null };
}

function parseRoyalMintProduct(html, requestedUrl = ORIGIN) {
    const $ = cheerio.load(String(html || ''));
    const canonical = absoluteUrl($('link[rel="canonical"]').attr('href'), requestedUrl) || absoluteUrl(requestedUrl);
    const schema = productSchema($);
    const settings = productJson($);
    const attributes = safeSpecification($);
    const title = cleanText(schema?.name || settings?.productName || $('h1').first().text());
    const images = coinImages(settings, canonical);
    const status = cleanText(settings?.stockSummary?.StatusMessage || schema?.offers?.availability || '').toLowerCase();
    let itemStatus = 'unknown';
    if (/(?:no longer available|outofstock|out of stock|sold out)/i.test(status)) itemStatus = 'archive';
    else if (/(?:in stock|instock|pre.?order|available)/i.test(status)) itemStatus = 'active';
    if (settings?.sku) attributes['Product code'] = cleanText(settings.sku);

    const denomination = attributes.Denomination || null;
    const year = exactYear(attributes.Year);
    const matchDenomination = matcherDenomination(denomination);
    return {
        sourceKey: SOURCE_KEY,
        sourceItemKey: sourceItemKeyFromUrl(canonical),
        sourceUrl: canonical,
        itemStatus,
        title,
        matchTitle: matchDenomination && year ? `${matchDenomination} ${year} ${title} Великобритания` : title,
        country: 'United Kingdom',
        denomination,
        year,
        metal: attributes.Alloy || attributes['Pure Metal Type'] || null,
        weightG: numberValue(attributes.Weight),
        diameterMm: numberValue(attributes.Diameter),
        mintage: integerValue(attributes['Maximum Coin Mintage']),
        condition: attributes.Quality || settings?.standardText || null,
        themes: [],
        aversImageUrl: images.obverse,
        reversImageUrl: images.reverse,
        attributes,
    };
}

function isUsableCoinProduct(product, parsedTitle) {
    const title = product?.title || '';
    const explicitSet = /(?:annual|proof|definitive|commemorative|first and last)\s+coin\s+set|(?:two|three|four|five|six|seven|eight|nine|ten|\d+)[ -]coin\s+(?:set|collection)|\bcoin\s+set\b/i.test(title);
    return Boolean(
        product && product.sourceItemKey && product.sourceUrl && product.title
        && product.denomination && product.year && product.attributes['Product code']
        && parsedTitle && parsedTitle.denom && parsedTitle.year
        && !parsedTitle.isNonCoin && !parsedTitle.isSet && !explicitSet
        && !/(?:medal|medallion|banknote|note|bullion bar|minted bar|coin holder|coin album|empty box|presentation box)/i.test(title),
    );
}

module.exports = {
    ORIGIN,
    SOURCE_KEY,
    absoluteUrl,
    coinImages,
    isUsableCoinProduct,
    matcherDenomination,
    parseCommerceSitemaps,
    parseRoyalMintProduct,
    parseSitemapIndex,
    sourceItemKeyFromUrl,
};

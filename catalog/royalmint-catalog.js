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

function yearCandidates(value) {
    return [...String(value || '').matchAll(/(?<!\d)(?:1\d{3}|20\d{2})(?!\d)/g)]
        .map((match) => Number(match[0]));
}

function resolvedYear(attributes, title, canonical) {
    const structured = exactYear(attributes.Year);
    const titleYears = [...new Set(yearCandidates(title))];
    const urlYears = [...new Set(yearCandidates(new URL(canonical).pathname))];
    const titleYear = titleYears.length === 1 ? titleYears[0] : null;
    if (structured && titleYear && structured !== titleYear) {
        attributes._year_conflict = { structuredYear: structured, titleYear };
        return null;
    }
    if (structured) return structured;
    return titleYear && urlYears.includes(titleYear) ? titleYear : null;
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
    return named.get(denomination.toLowerCase().replaceAll('-', ' ')) || null;
}

function titleDenomination(value) {
    const title = cleanText(value);
    const pounds = title.match(/£\s*(\d+(?:\.\d+)?)/);
    if (pounds) return `£${pounds[1]}`;
    const pence = title.match(/(?<![\d/])(\d+(?:\.\d+)?)\s*p\b/i);
    if (pence) return `${pence[1]}p`;
    const named = [
        [/\bfive[-\s]sovereign piece\b/i, 'Five Sovereign Piece'],
        [/\bdouble[-\s]sovereign\b/i, 'Double Sovereign'],
        [/\bhalf[-\s]sovereign\b/i, 'Half Sovereign'],
        [/\bquarter[-\s]sovereign\b/i, 'Quarter Sovereign'],
        [/\bsovereign\b/i, 'Sovereign'],
        [/\bsixpence\b/i, 'Sixpence'],
        [/\bshilling\b/i, 'Shilling'],
        [/\bflorin\b/i, 'Florin'],
        [/\bpenny\b/i, 'Penny'],
        [/\bcrown\b/i, 'Crown'],
        [/\bguinea\b/i, 'Guinea'],
    ];
    return named.find(([pattern]) => pattern.test(title))?.[1] || null;
}

function resolvedDenomination(attributes, title) {
    const structured = cleanText(attributes.Denomination);
    const titled = titleDenomination(title);
    if (!structured) return titled;
    if (!titled) return structured;
    const structuredMatch = matcherDenomination(structured);
    const titledMatch = matcherDenomination(titled);
    const structuredKey = structured.toLowerCase().replaceAll('-', ' ');
    if (titledMatch && structuredMatch && titledMatch !== structuredMatch
        || structuredKey === 'sovereign' && titled !== 'Sovereign') {
        attributes._denomination_override = { structuredDenomination: structured, titleDenomination: titled };
        return titled;
    }
    return structured;
}

function isPackagingOrGradedVariant(value) {
    const title = cleanText(value);
    const packaged = /\bsigned by (?:the )?artist\b|\bcoin and print set\b|\b(?:coin )?tube\b|\bcoin roll\b|\bbundle\b|\bcoin in (?:a )?blister\b|\b(?:and|with) (?:an? )?historic (?:coin|sixpence|sovereign|crown|shilling|penny)\b|\b(?:black|white|oak|wooden|display) frame\b|\bwith (?:a )?(?:display|presentation )?(?:box|case|frame)\b/i.test(title);
    const multiPieceSovereign = /\b(?:[2-9]|10|two|three|four|five|six|seven|eight|nine|ten)[ -]piece sovereign\b/i.test(title);
    const graded = /\b(?:NGC|PCGS)\b|\b(?:PF|PR|MS|SP)\s*-?\s*\d{2}\b|\b(?:first|early) releases?\b/i.test(title);
    return packaged || multiPieceSovereign || graded;
}

function metalFamily(value) {
    const normalized = cleanText(value).toLowerCase();
    return ['gold', 'silver', 'platinum', 'palladium'].find((metal) => normalized.includes(metal)) || null;
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

    const denomination = resolvedDenomination(attributes, title);
    const metal = attributes.Alloy || attributes['Pure Metal Type'] || null;
    const titleMetal = metalFamily(title);
    const structuredMetal = metalFamily(metal);
    if (titleMetal && structuredMetal && titleMetal !== structuredMetal) {
        attributes._metal_conflict = { titleMetal, structuredMetal };
    }
    const year = resolvedYear(attributes, title, canonical);
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
        metal,
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
    const explicitSet = /(?:annual|proof|definitive|commemorative|first and last)\s+coin\s+set|(?:two|three|four|five|six|seven|eight|nine|ten|\d+)[ -]coin(?:\s+[a-z]+){0,4}\s+(?:set|collection|series)|\bcoin\s+set\b|collection\s+case/i.test(title);
    return Boolean(
        product && product.sourceItemKey && product.sourceUrl && product.title
        && product.denomination && product.year && product.attributes['Product code']
        && !product.attributes._year_conflict
        && !product.attributes._metal_conflict
        && parsedTitle && parsedTitle.denom && parsedTitle.year
        && !parsedTitle.isNonCoin && !parsedTitle.isSet && !explicitSet
        && !isPackagingOrGradedVariant(title)
        && !/(?:medal|medallion|banknote|note|bullion bar|minted bar|coin holder|coin album|coin cover|empty box|presentation box)/i.test(title),
    );
}

module.exports = {
    ORIGIN,
    SOURCE_KEY,
    absoluteUrl,
    coinImages,
    isUsableCoinProduct,
    isPackagingOrGradedVariant,
    matcherDenomination,
    metalFamily,
    parseCommerceSitemaps,
    parseRoyalMintProduct,
    parseSitemapIndex,
    resolvedYear,
    resolvedDenomination,
    sourceItemKeyFromUrl,
    titleDenomination,
};

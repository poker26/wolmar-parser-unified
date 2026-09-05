/** Pure parser for official ECB EUR 2 commemorative-coin pages. */
'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const cheerio = require('cheerio');

const ORIGIN = 'https://www.ecb.europa.eu';
const SOURCE_KEY = 'ecb.europa.eu';
const OLD_COMMON_SIDE = `${ORIGIN}/euro/coins/common/shared/img/common_2euro_800.jpg`;
const NEW_COMMON_SIDE = `${ORIGIN}/euro/coins/common/shared/img/newcommon_2euro_800.jpg`;
const COUNTRY_RU = new Map(Object.entries({
    Andorra: 'Андорра', Austria: 'Австрия', Belgium: 'Бельгия', Croatia: 'Хорватия',
    Cyprus: 'Кипр', Estonia: 'Эстония', Finland: 'Финляндия', France: 'Франция',
    Germany: 'Германия', Greece: 'Греция', Ireland: 'Ирландия', Italy: 'Италия',
    Latvia: 'Латвия', Lithuania: 'Литва', Luxembourg: 'Люксембург', Malta: 'Мальта',
    Monaco: 'Монако', Netherlands: 'Нидерланды', Portugal: 'Португалия',
    'San Marino': 'Сан-Марино', Slovakia: 'Словакия', Slovenia: 'Словения', Spain: 'Испания',
    Vatican: 'Ватикан', 'Vatican City': 'Ватикан',
}));

function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function absoluteUrl(value, base = ORIGIN) {
    if (!value) return null;
    try {
        const url = new URL(value, base);
        if (url.hostname !== 'www.ecb.europa.eu' && url.hostname !== 'ecb.europa.eu') return null;
        url.protocol = 'https:';
        url.hostname = 'www.ecb.europa.eu';
        return url.href;
    } catch (_) {
        return null;
    }
}

function parseCommemorativeIndex(html) {
    const $ = cheerio.load(String(html || ''));
    const urls = new Set();
    $('a[href]').each((_, element) => {
        const url = absoluteUrl($(element).attr('href'));
        if (/\/euro\/coins\/comm\/html\/comm_(?:20\d{2}|19\d{2})\.en\.html$/i.test(url || '')) urls.add(url);
    });
    return [...urls].sort((a, b) => b.localeCompare(a));
}

function pageYear($, pageUrl) {
    const pathMatch = new URL(pageUrl).pathname.match(/comm_((?:19|20)\d{2})\.en\.html$/i);
    const headingYears = [...new Set(cleanText($('main h1').first().text()).match(/(?:19|20)\d{2}/g) || [])];
    if (!pathMatch || headingYears.length !== 1 || pathMatch[1] !== headingYears[0]) return null;
    return Number(pathMatch[1]);
}

function labelledFields($, box) {
    const fields = {};
    $(box).find('.content-box p').each((_, paragraph) => {
        const strong = $(paragraph).find('strong').first();
        const label = cleanText(strong.text()).replace(/:\s*$/, '');
        if (!label) return;
        const copy = $(paragraph).clone();
        copy.find('strong').first().remove();
        const value = cleanText(copy.text()).replace(/^[:\s]+/, '');
        if (value && !fields[label]) fields[label] = value;
    });
    return fields;
}

function mintageValue(value) {
    const text = cleanText(value).toLowerCase();
    if (!text || /(?:not available|not known|n\/a)/i.test(text)) return null;
    const match = text.match(/\d[\d\s.,]*/);
    if (!match) return null;
    if (/million/.test(text)) {
        const number = Number(match[0].replace(/\s/g, '').replace(',', '.'));
        return Number.isFinite(number) ? Math.round(number * 1_000_000) : null;
    }
    const digits = match[0].replace(/\D/g, '');
    return digits ? Number(digits) : null;
}

function commonSide(year, country) {
    const lateCountries = new Set(['Austria', 'Italy', 'Portugal', 'San Marino', 'Vatican City', 'Vatican']);
    const modern = year >= (lateCountries.has(country) ? 2008 : 2007);
    return modern ? NEW_COMMON_SIDE : OLD_COMMON_SIDE;
}

function sourceItemKey(year, imageUrl, country, feature) {
    const countrySlug = country.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const identityHash = crypto.createHash('sha256').update(`${country}\n${feature}`).digest('hex').slice(0, 16);
    const imageName = path.posix.basename(new URL(imageUrl).pathname).toLowerCase();
    return `comm/${year}/${countrySlug}-${identityHash}-${imageName}`;
}

function parseCommemorativePage(html, requestedUrl) {
    const $ = cheerio.load(String(html || ''));
    const canonical = absoluteUrl($('link[rel="canonical"]').attr('href'), requestedUrl) || absoluteUrl(requestedUrl);
    const year = canonical ? pageYear($, canonical) : null;
    if (!year) return [];
    const products = [];
    $('main .boxes.-grey > .box').each((_, box) => {
        const country = cleanText($(box).find('.content-box h3').first().text()).replace(/:$/, '');
        const fields = labelledFields($, box);
        const feature = fields.Feature || null;
        const imageUrl = absoluteUrl($(box).find('picture img').first().attr('src'), canonical);
        if (!country || !feature || !imageUrl) return;
        const itemKey = sourceItemKey(year, imageUrl, country, feature);
        const sourceUrl = `${canonical}#${encodeURIComponent(itemKey)}`;
        const title = `2 euro ${year}. ${country}. ${feature}`;
        const matchCountry = COUNTRY_RU.get(country) || country;
        products.push({
            sourceKey: SOURCE_KEY,
            sourceItemKey: itemKey,
            sourceUrl,
            itemStatus: 'unknown',
            title,
            matchTitle: `2 евро ${year} ${matchCountry} ${feature}`,
            country,
            denomination: '2 euro',
            year,
            metal: null,
            weightG: 8.5,
            diameterMm: 25.75,
            mintage: mintageValue(fields['Issuing volume']),
            condition: null,
            themes: [feature],
            aversImageUrl: imageUrl,
            reversImageUrl: commonSide(year, country),
            attributes: {
                Feature: feature,
                Description: fields.Description || null,
                'Issuing volume': fields['Issuing volume'] || null,
                'Issuing date': fields['Issuing date'] || null,
                'Source page': canonical,
            },
        });
    });
    return products;
}

function isUsableCoinProduct(product, parsedTitle) {
    return Boolean(product?.sourceItemKey && product.sourceUrl && product.country && product.year
        && product.title && product.themes?.[0] && product.aversImageUrl && product.reversImageUrl
        && parsedTitle?.year === product.year && parsedTitle?.denom?.unit === 'евро'
        && parsedTitle.denom.value === 2 && !parsedTitle.isSet && !parsedTitle.isNonCoin);
}

module.exports = {
    NEW_COMMON_SIDE,
    OLD_COMMON_SIDE,
    ORIGIN,
    SOURCE_KEY,
    absoluteUrl,
    commonSide,
    isUsableCoinProduct,
    mintageValue,
    parseCommemorativeIndex,
    parseCommemorativePage,
    sourceItemKey,
};


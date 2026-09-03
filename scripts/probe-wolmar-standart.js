#!/usr/bin/env node
'use strict';

const https = require('https');
const cheerio = require('cheerio');
const {
    categorySlug,
    localAuctionNumber,
    selectStandartCoinCategories,
} = require('../temporal/wolmar-auction-series');

function option(name, fallback) {
    const prefix = `--${name}=`;
    const arg = process.argv.slice(2).find((value) => value.startsWith(prefix));
    return arg ? arg.slice(prefix.length) : fallback;
}

function fetchText(url, redirects = 3) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (wolmar-parser standart pilot)' } }, (response) => {
            if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location && redirects > 0) {
                response.resume();
                return fetchText(new URL(response.headers.location, url).toString(), redirects - 1).then(resolve, reject);
            }
            if (response.statusCode !== 200) {
                response.resume();
                return reject(new Error(`GET ${url} returned HTTP ${response.statusCode}`));
            }
            let body = '';
            response.setEncoding('utf8');
            response.on('data', (chunk) => { body += chunk; });
            response.on('end', () => resolve(body));
        }).on('error', reject);
    });
}

function compactText(root, selector) {
    return root(selector).first().text().replace(/\s+/g, ' ').trim();
}

function parseLot(html, sourceUrl) {
    const root = cheerio.load(html);
    const heading = compactText(root, 'h5');
    const description = compactText(root, '.description');
    const values = root('.values').map((_, node) => root(node).text().replace(/\s+/g, ' ').trim()).get();
    const properties = values[0] || '';
    const bidding = values[1] || '';
    const lotNumber = heading.match(/Лот\s*№\s*(\d+)/i)?.[1] || null;
    const title = heading.replace(/Лот\s*№\s*\d+\.\s*/i, '').trim();
    const bid = bidding.match(/Ставка:\s*(\d+(?:\s?\d+)*(?:[.,]\d+)?)\s*руб/i)?.[1]
        ?.replace(/\s/g, '').replace(',', '.') || null;
    return {
        lotNumber,
        title,
        description: description || null,
        year: properties.match(/Год:\s*(\d+)/i)?.[1] || null,
        metal: properties.match(/Металл:\s*([^\s]+)/i)?.[1] || null,
        condition: properties.match(/Сохранность:\s*([^\s]+)/i)?.[1] || null,
        bidRub: bid == null ? null : Number(bid),
        status: bidding.includes('Лот закрыт') ? 'closed' : 'active',
        sourceUrl,
    };
}

async function main() {
    const wolmarId = option('wolmar-id', '2147');
    const displayNumber = option('number', '800');
    const slug = option('category', 'monety-rsfsr-sssr-rossii');
    const limit = Math.max(1, Number(option('limit', '20')) || 20);
    const probeLots = Math.min(limit, Math.max(1, Number(option('probe-lots', '5')) || 5));
    const auctionUrl = `https://www.wolmar.ru/auction/${wolmarId}`;
    const auctionHtml = await fetchText(auctionUrl);
    const root = cheerio.load(auctionHtml);
    const heading = compactText(root, 'h1');
    if (!heading.includes(`Аукцион Standart №${displayNumber}`)) {
        throw new Error(`Expected Standart №${displayNumber}, got: ${heading}`);
    }
    if (!/\(Закрыт\s/i.test(heading)) throw new Error(`Pilot requires a closed auction: ${heading}`);

    const discovered = [];
    root('a').each((_, node) => {
        const href = root(node).attr('href') || '';
        if (!categorySlug(href, wolmarId)) return;
        discovered.push({ name: root(node).text().replace(/\s+/g, ' ').trim(), href });
    });
    const categories = selectStandartCoinCategories(discovered, wolmarId);
    const category = categories.find((item) => item.slug === slug);
    if (!category) throw new Error(`Coin category not found: ${slug}`);

    const categoryHtml = await fetchText(category.url);
    const categoryRoot = cheerio.load(categoryHtml);
    const totalLotsText = categoryRoot('body').text().match(/Всего\s+(\d+)\s+лот/i)?.[1] || null;
    const lotUrls = [];
    categoryRoot('a.title.lot').each((_, node) => {
        if (lotUrls.length >= limit) return;
        const href = categoryRoot(node).attr('href');
        if (href) lotUrls.push(new URL(href, 'https://www.wolmar.ru').toString());
    });

    const lots = [];
    for (const url of lotUrls.slice(0, probeLots)) lots.push(parseLot(await fetchText(url), url));
    const result = {
        mode: 'read-only',
        series: 'standart',
        displayNumber,
        auctionNumber: localAuctionNumber('standart', displayNumber),
        wolmarId,
        heading,
        coinCategories: categories,
        selectedCategory: category,
        categoryLots: totalLotsText == null ? null : Number(totalLotsText),
        collectedFromFirstPage: lotUrls.length,
        lots,
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
});

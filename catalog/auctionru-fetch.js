/** Fast Auction.ru card loading with a browser fallback for protection pages. */
'use strict';

const { fetchHtml } = require('./browser-fetch');
const { isAuctionRuCardPage, parseAuctionRuPage } = require('./marketplace-observation');
const { fetchText } = require('./shop-source-ingester');

function validAuctionRuHtml(html) {
    if (!html || html.length < 1500) return false;
    const page = parseAuctionRuPage(html);
    return isAuctionRuCardPage(html, page);
}

async function fetchAuctionRuHtml(url, {
    fetchImpl = fetch,
    browserFetch = fetchHtml,
    validate = validAuctionRuHtml,
} = {}) {
    try {
        const direct = await fetchText(url, fetchImpl, { retries: 0 });
        if (validate(direct)) return direct;
    } catch (_) { /* защитная страница или временная HTTP-ошибка: пробуем браузер */ }
    return browserFetch(url);
}

module.exports = { fetchAuctionRuHtml, validAuctionRuHtml };

// Активити харвеста numismat (curl+cheerio+pg). Side-effect здесь; workflow детерминированный.
// Идемпотентно (upsert по lot_number+auction_number+source_site) → ретрай безопасен.
'use strict';

const { Context } = require('@temporalio/activity');
const { ingestNumismatPage, listAuctions, curlGet } = require('../catalog/numismat-core');

// Дискавери всех номеров аукционов с auction.shtml
async function discoverAuctions() {
    const html = await curlGet('https://numismat.ru/auction.shtml');
    return listAuctions(html);
}

// Ингест одной страницы аукциона
async function harvestNumismatPage({ au, page }) {
    Context.current().heartbeat({ au, page });
    return await ingestNumismatPage({ au, page });
}

module.exports = { discoverAuctions, harvestNumismatPage };

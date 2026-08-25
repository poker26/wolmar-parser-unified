// Воркфлоу харвеста numismat. Детерминированный — НЕТ curl/pg здесь.
// Идёт по списку аукционов, каждый пагинирует (page 0,1,2…) до пустой страницы или maxPages.
// Resume из истории Temporal; continueAsNew каждые N страниц. Может молотить часами/днями.
'use strict';

const { proxyActivities, defineQuery, setHandler, continueAsNew, workflowInfo } = require('@temporalio/workflow');

const DEFAULT_PAGES_BEFORE_CONTINUE = 40;

const { discoverAuctions, harvestNumismatPage } = proxyActivities({
    startToCloseTimeout: '6 minutes',     // 1 страница: curl + парс + ингест ~50 лотов с матчингом
    heartbeatTimeout: '3 minutes',
    retry: { maximumAttempts: 4, initialInterval: '10s', backoffCoefficient: 2 },
});

const progressQuery = defineQuery('progress');
const ACC = ['lots', 'ok', 'linked', 'err'];

async function numismatHarvestWorkflow(input = {}) {
    const pagesBeforeContinue = input.pagesBeforeContinue || DEFAULT_PAGES_BEFORE_CONTINUE;
    const maxPages = input.maxPages || 200;
    const startedAt = input.startedAt || workflowInfo().startTime.toISOString();

    // Список аукционов резолвим один раз (детерминизм) и переносим через continueAsNew.
    let auctions = input.auctions || null;
    if (!auctions) auctions = await discoverAuctions();

    let ai = input.auctionIdx || 0;
    let page = input.page || 0;
    const totals = input.totals || { pages: 0, auctionsDone: 0 };
    const perAuction = input.perAuction || {};

    setHandler(progressQuery, () => ({
        startedAt, auctionIdx: ai, totalAuctions: auctions.length,
        currentAuction: auctions[ai], page, totals,
        recent: Object.fromEntries(Object.entries(perAuction).slice(-6)),
        done: ai >= auctions.length,
    }));

    let pagesThisRun = 0;
    while (ai < auctions.length) {
        const au = auctions[ai];
        const pa = perAuction[au] || (perAuction[au] = { pages: 0 });

        const r = await harvestNumismatPage({ au, page });
        totals.pages++; pagesThisRun++; pa.pages++;
        for (const k of ACC) { totals[k] = (totals[k] || 0) + (r[k] || 0); pa[k] = (pa[k] || 0) + (r[k] || 0); }

        const exhausted = (r.lots || 0) === 0 || page >= maxPages;
        if (exhausted) { ai++; page = 0; totals.auctionsDone++; } else { page++; }

        if (pagesThisRun >= pagesBeforeContinue && ai < auctions.length) {
            await continueAsNew({ auctions, pagesBeforeContinue, maxPages, startedAt, auctionIdx: ai, page, totals, perAuction });
        }
    }
    return { totals };
}

module.exports = { numismatHarvestWorkflow };

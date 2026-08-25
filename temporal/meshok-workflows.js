// Воркфлоу харвеста meshok. Детерминированная песочница — НЕТ pg/Scrapfly/env здесь.
// Идёт по списку целей (категория × opt), пагинирует каждую до пустой страницы или maxPages.
// Resume из истории Temporal: упал воркер посреди категории — переиграется последняя страница
// (idempotent upsert). continueAsNew каждые N страниц ограничивает бар истории — может молотить днями.
'use strict';

const { proxyActivities, defineQuery, setHandler, continueAsNew, workflowInfo } = require('@temporalio/workflow');

const DEFAULT_PAGES_BEFORE_CONTINUE = 30;

const { harvestMeshokPage } = proxyActivities({
    startToCloseTimeout: '8 minutes',     // 1 страница: до 3 Scrapfly-попыток (~90с) + ингест лотов
    heartbeatTimeout: '4 minutes',
    retry: { maximumAttempts: 4, initialInterval: '10s', backoffCoefficient: 2 },  // идемпотентно
});

const progressQuery = defineQuery('progress');
const ACC = ['lots', 'new', 'dup', 'unsold', 'set', 'nomatch', 'nodenom', 'noprice', 'noyear', 'cost'];

async function meshokHarvestWorkflow(input = {}) {
    const targets = input.targets || [];
    const pagesBeforeContinue = input.pagesBeforeContinue || DEFAULT_PAGES_BEFORE_CONTINUE;
    const startedAt = input.startedAt || workflowInfo().startTime.toISOString();
    let ti = input.targetIdx || 0;
    let page = input.page || 1;
    const totals = input.totals || { pages: 0 };
    const perTarget = input.perTarget || {};

    setHandler(progressQuery, () => ({
        startedAt, targetIdx: ti, totalTargets: targets.length,
        current: targets[ti] ? (targets[ti].label || `${targets[ti].cat}/opt${targets[ti].opt}`) : null,
        page, totals, perTarget, done: ti >= targets.length,
    }));

    let pagesThisRun = 0;
    while (ti < targets.length) {
        const t = targets[ti];
        const maxPages = t.maxPages || 80;     // cap-бэкстоп (meshok за концом отдаёт ТЕ ЖЕ лоты, не пустую страницу!)
        const label = t.label || `${t.cat}/opt${t.opt}`;
        const pt = perTarget[label] || (perTarget[label] = { pages: 0 });

        const r = await harvestMeshokPage({ cat: t.cat, page, opt: String(t.opt) });
        totals.pages = (totals.pages || 0) + 1; pagesThisRun++; pt.pages = (pt.pages || 0) + 1;
        for (const k of ACC) { totals[k] = (totals[k] || 0) + (r[k] || 0); pt[k] = (pt[k] || 0) + (r[k] || 0); }

        // ГЛАВНОЕ: терминация по «0 НОВЫХ лотов» (r.new) — meshok-пагинация не отдаёт пустую страницу,
        // за концом повторяет лоты → ловим зацикливание. Плюс пустая страница и cap как бэкстопы.
        const exhausted = (r.lots || 0) === 0 || (r.new || 0) === 0 || page >= maxPages;
        if (exhausted) { ti++; page = 1; } else { page++; }

        if (pagesThisRun >= pagesBeforeContinue && ti < targets.length) {
            await continueAsNew({ targets, pagesBeforeContinue, startedAt, targetIdx: ti, page, totals, perTarget });
        }
    }
    return { totals, perTarget };
}

module.exports = { meshokHarvestWorkflow };

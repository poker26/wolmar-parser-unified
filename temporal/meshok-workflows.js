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
const ACC = ['lots', 'new', 'dup', 'new-unmatched', 'dup-unmatched', 'unsold', 'running', 'set', 'nomatch', 'nodenom', 'noprice', 'noyear', 'cost'];

async function meshokHarvestWorkflow(input = {}) {
    const targets = input.targets || [];
    const pagesBeforeContinue = input.pagesBeforeContinue || DEFAULT_PAGES_BEFORE_CONTINUE;
    const startedAt = input.startedAt || workflowInfo().startTime.toISOString();
    let ti = input.targetIdx || 0;
    let page = input.page || 1;
    let lastSig = input.lastSig || null;      // подпись предыдущей страницы текущей цели
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

        const r = await harvestMeshokPage({ cat: t.cat, page, mode: t.mode, opt: t.opt != null ? String(t.opt) : undefined });
        totals.pages = (totals.pages || 0) + 1; pagesThisRun++; pt.pages = (pt.pages || 0) + 1;
        for (const k of ACC) { totals[k] = (totals[k] || 0) + (r[k] || 0); pt[k] = (pt[k] || 0) + (r[k] || 0); }

        // ГЛАВНОЕ: конец пагинации ловим по ПОВТОРУ страницы (meshok за концом отдаёт те же лоты,
        // а не пустую страницу). По «0 новых» терминировать нельзя: в sold-режиме страница целиком
        // из лотов без ставок — это не сделки, новых строк ноль, а пагинация ещё продолжается.
        // Неполная страница = конец выдачи (страница берёт pp=200 лотов); повтор подписи —
        // страховка на случай, если сайт снова начнёт зацикливать выдачу за концом.
        const repeated = r.sig != null && r.sig === lastSig;
        const shortPage = (r.lots || 0) > 0 && (r.lots || 0) < (t.pageSize || 200);
        const exhausted = (r.lots || 0) === 0 || repeated || shortPage || page >= maxPages;
        if (exhausted) { ti++; page = 1; lastSig = null; } else { page++; lastSig = r.sig || null; }

        if (pagesThisRun >= pagesBeforeContinue && ti < targets.length) {
            await continueAsNew({ targets, pagesBeforeContinue, startedAt, targetIdx: ti, page, lastSig, totals, perTarget });
        }
    }
    return { totals, perTarget };
}

module.exports = { meshokHarvestWorkflow };

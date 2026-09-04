// Активити харвеста meshok. Оборачивает catalog/ingest-meshok.ingestMeshokPage (Scrapfly+pg).
// Весь side-effect здесь; workflow остаётся детерминированным. Идемпотентно (upsert) → ретрай безопасен.
'use strict';

const { Context } = require('@temporalio/activity');
const { ingestMeshokPage, ensureMeshokIndex } = require('../catalog/ingest-meshok');
const { finishSourceRun, startSourceRun } = require('../catalog/source-registry');
const { pool } = require('../catalog/db');

let indexed = false;

// Фетч ОДНОЙ страницы категории + ингест лотов. Возвращает stat {lots,cost,ok,unsold,set,nomatch,...}.
async function harvestMeshokPage({ cat, page, mode, opt }) {
    if (!indexed) { await ensureMeshokIndex(); indexed = true; }
    Context.current().heartbeat({ phase: 'start', cat, page, mode: mode || opt });
    const stat = await ingestMeshokPage({
        cat, page, mode, opt,
        onHeartbeat: (h) => { try { Context.current().heartbeat(h); } catch (_) {} },
    });
    return stat;
}

async function startMeshokSourceRun({ runKind }) {
    const run = await startSourceRun(pool, 'meshok.net', runKind || 'incremental');
    return run.id;
}

async function finishMeshokSourceRun({ runId, status, totals = {}, errorSummary = null }) {
    const skipped = ['noncoin', 'set', 'nodenom', 'noyear'].reduce((sum, key) => sum + (totals[key] || 0), 0);
    const candidates = totals['new-candidate'] || 0;
    return finishSourceRun(pool, runId, status, {
        pagesFetched: totals.pages || 0,
        itemsSeen: totals.lots || 0,
        observationsSaved: Math.max(0, (totals.lots || 0) - skipped),
        candidatesStaged: candidates,
        errorsCount: status === 'failed' ? 1 : 0,
        externalCost: totals.cost == null ? null : totals.cost,
        errorSummary,
    });
}

module.exports = { finishMeshokSourceRun, harvestMeshokPage, startMeshokSourceRun };

// Активити харвеста meshok. Оборачивает catalog/ingest-meshok.ingestMeshokPage (Scrapfly+pg).
// Весь side-effect здесь; workflow остаётся детерминированным. Идемпотентно (upsert) → ретрай безопасен.
'use strict';

const { Context } = require('@temporalio/activity');
const { ingestMeshokPage, ensureMeshokIndex } = require('../catalog/ingest-meshok');

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

module.exports = { harvestMeshokPage };

// Workflow форкаст-пересчёта. Детерминированный код: НИКАКИХ pg/puppeteer/Date.now здесь.
// Resume берётся бесплатно из event history — поэтому файлов прогресса/saveProgress нет.
'use strict';

const { proxyActivities, defineQuery, setHandler, continueAsNew, workflowInfo } =
    require('@temporalio/workflow');

// ВНИМАНИЕ: workflow исполняется в детерминированной песочнице — здесь НЕТ process/env.
// Поэтому размеры чанков приходят через input (клиент берёт их из env), с литеральными
// дефолтами. Никаких require('./shared') — shared.js читает process.env и сломает бандл.
const DEFAULT_CHUNK_SIZE = 50;
const DEFAULT_CHUNKS_BEFORE_CONTINUE = 200;

const { resolveAuction, countLots, predictChunk } = proxyActivities({
    startToCloseTimeout: '5 minutes',
    heartbeatTimeout: '60 seconds',
    retry: { maximumAttempts: 5 },
});

// Запрос прогресса — админка дёргает его через client.query('progress').
const progressQuery = defineQuery('progress');

async function recomputeForecastsWorkflow(input = {}) {
    // continueAsNew сохраняет уже накопленное состояние через input.
    let auctionNumber = input.auctionNumber || null;
    let total = input.total || 0;
    let processed = input.processed || 0;
    let errors = input.errors || 0;
    let offset = input.offset || 0;
    const startedAt = input.startedAt || workflowInfo().startTime.toISOString();
    const chunkSize = input.chunkSize || DEFAULT_CHUNK_SIZE;
    const chunksBeforeContinue = input.chunksBeforeContinue || DEFAULT_CHUNKS_BEFORE_CONTINUE;

    setHandler(progressQuery, () => ({
        auctionNumber,
        total,
        processed,
        errors,
        offset,
        percent: total > 0 ? Math.round((offset / total) * 100) : 0,
        startedAt,
        done: total > 0 && offset >= total,
    }));

    // Резолв и подсчёт лотов — только на самом первом запуске цепочки continueAsNew.
    if (!auctionNumber) auctionNumber = await resolveAuction(input.inputNumber);
    if (!total) total = await countLots(auctionNumber);

    let chunksThisRun = 0;
    while (offset < total) {
        const limit = Math.min(chunkSize, total - offset);
        const r = await predictChunk(auctionNumber, offset, limit);
        processed += r.processed;
        errors += r.errors;
        offset += limit;
        chunksThisRun++;

        if (chunksThisRun >= chunksBeforeContinue && offset < total) {
            await continueAsNew({
                auctionNumber, total, processed, errors, offset, startedAt,
                chunkSize, chunksBeforeContinue,
            });
        }
    }

    return { auctionNumber, total, processed, errors };
}

module.exports = { recomputeForecastsWorkflow };

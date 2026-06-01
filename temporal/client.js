// Тонкий клиент Temporal для server.js (админ-роуты start/stop/status).
// Singleton connection — переиспользуем одно gRPC-соединение на весь процесс приложения.
'use strict';

const { Connection, Client } = require('@temporalio/client');
const {
    TASK_QUEUE, PARSER_TASK_QUEUE, ADDRESS, NAMESPACE,
    CHUNK_SIZE, CHUNKS_BEFORE_CONTINUE, PARSER_CHUNK_SIZE, PARSER_CHUNKS_BEFORE_CONTINUE,
    forecastWorkflowId, auctionParseWorkflowId,
} = require('./shared');
const { recomputeForecastsWorkflow } = require('./workflows');
const { parseAuctionWorkflow } = require('./parser-workflows');

let clientPromise = null;
async function getClient() {
    if (!clientPromise) {
        clientPromise = (async () => {
            const connection = await Connection.connect({ address: ADDRESS });
            return new Client({ connection, namespace: NAMESPACE });
        })();
    }
    return clientPromise;
}

// Запустить (или присоединиться к уже идущему) форкаст-пересчёт.
// workflowIdReusePolicy по умолчанию не даёт дублировать активный workflow с тем же id.
async function startForecast(inputNumber) {
    const client = await getClient();
    const workflowId = forecastWorkflowId(inputNumber || 'auto');
    const handle = await client.workflow.start(recomputeForecastsWorkflow, {
        taskQueue: TASK_QUEUE,
        workflowId,
        args: [{
            inputNumber: inputNumber || null,
            chunkSize: CHUNK_SIZE,
            chunksBeforeContinue: CHUNKS_BEFORE_CONTINUE,
        }],
    });
    return { workflowId: handle.workflowId, runId: handle.firstExecutionRunId };
}

async function getForecastProgress(inputNumber) {
    const client = await getClient();
    const workflowId = forecastWorkflowId(inputNumber || 'auto');
    const handle = client.workflow.getHandle(workflowId);
    const desc = await handle.describe();
    let progress = null;
    if (desc.status.name === 'RUNNING') {
        progress = await handle.query('progress');
    }
    return { workflowId, status: desc.status.name, progress };
}

async function stopForecast(inputNumber) {
    const client = await getClient();
    const workflowId = forecastWorkflowId(inputNumber || 'auto');
    const handle = client.workflow.getHandle(workflowId);
    await handle.cancel();
    return { workflowId, cancelled: true };
}

// --- Парсер аукциона (очередь wolmar-parser) ---
async function startAuctionParse(auctionNumber, options = {}) {
    const client = await getClient();
    const workflowId = auctionParseWorkflowId(auctionNumber);
    const handle = await client.workflow.start(parseAuctionWorkflow, {
        taskQueue: PARSER_TASK_QUEUE,
        workflowId,
        args: [{
            auctionNumber: String(auctionNumber),
            options: {
                updateCategories: !!options.updateCategories,
                updateBids: !!options.updateBids,
                delayBetweenLots: options.delayBetweenLots || 800,
            },
            chunkSize: PARSER_CHUNK_SIZE,
            chunksBeforeContinue: PARSER_CHUNKS_BEFORE_CONTINUE,
        }],
    });
    return { workflowId: handle.workflowId, runId: handle.firstExecutionRunId };
}

async function getAuctionParseProgress(auctionNumber) {
    const client = await getClient();
    const workflowId = auctionParseWorkflowId(auctionNumber);
    const handle = client.workflow.getHandle(workflowId);
    const desc = await handle.describe();
    let progress = null;
    if (desc.status.name === 'RUNNING') {
        try { progress = await handle.query('progress'); } catch (_) { progress = null; }
    }
    return { workflowId, status: desc.status.name, progress };
}

async function stopAuctionParse(auctionNumber) {
    const client = await getClient();
    const workflowId = auctionParseWorkflowId(auctionNumber);
    const handle = client.workflow.getHandle(workflowId);
    await handle.cancel();
    return { workflowId, cancelled: true };
}

module.exports = {
    getClient,
    startForecast, getForecastProgress, stopForecast,
    startAuctionParse, getAuctionParseProgress, stopAuctionParse,
};

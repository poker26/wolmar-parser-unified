// Тонкий клиент Temporal для server.js (админ-роуты start/stop/status).
// Singleton connection — переиспользуем одно gRPC-соединение на весь процесс приложения.
'use strict';

const { Connection, Client } = require('@temporalio/client');
const {
    TASK_QUEUE, PARSER_TASK_QUEUE, ADDRESS, NAMESPACE,
    CHUNK_SIZE, CHUNKS_BEFORE_CONTINUE, PARSER_CHUNK_SIZE, PARSER_CHUNKS_BEFORE_CONTINUE,
    forecastWorkflowId, auctionParseWorkflowId, categoryParseWorkflowId,
} = require('./shared');
const { recomputeForecastsWorkflow } = require('./workflows');
const { parseAuctionWorkflow, bidRefreshBatchWorkflow, auctionRolloverWorkflow } = require('./parser-workflows');
const { collectionPhotoWorkflow } = require('./collection-photo-workflows');
const {
    collectionValuationWorkflow,
    requestValuationRecalculation,
} = require('./collection-valuation-workflows');
const {
    accountDeletionWorkflow,
    collectionExportWorkflow,
} = require('./collection-data-workflows');

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
                // Если true — парсим только «прогнозируемые» категории (монеты, боны и т.п.),
                // пропуская ювелирку/иконы/антиквариат. Используется для тяжёлого прохода
                // истории ставок (lot_bids), которая нужна лишь там, где есть прогноз/риск.
                predictableOnly: !!options.predictableOnly,
                // saveAs — НАШ номер аукциона, когда URL строится по wolmar-id
                // (у нового аукциона его ещё нет в parsing_number, и без saveAs
                // лоты сохранятся под wolmar-id: 2242 вместо 1016).
                ...(options.saveAs != null ? { saveAs: String(options.saveAs) } : {}),
            },
            chunkSize: PARSER_CHUNK_SIZE,
            chunksBeforeContinue: PARSER_CHUNKS_BEFORE_CONTINUE,
        }],
    });
    return { workflowId: handle.workflowId, runId: handle.firstExecutionRunId };
}

// Дофинализация ставок батчем по завершённым аукционам (очередь wolmar-parser).
async function startBidRefresh(auctions) {
    const client = await getClient();
    const workflowId = 'bid-refresh-batch';
    const handle = await client.workflow.start(bidRefreshBatchWorkflow, {
        taskQueue: PARSER_TASK_QUEUE,
        workflowId,
        args: [{
            // элемент: строка (наш № == wolmar-id, текущие аукционы) ИЛИ {num, wolmarId} (старые)
            auctions: auctions.map((x) => (x && typeof x === 'object') ? { num: String(x.num), wolmarId: String(x.wolmarId || x.num) } : String(x)),
            chunkSize: PARSER_CHUNK_SIZE, chunksBeforeContinue: PARSER_CHUNKS_BEFORE_CONTINUE,
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

// --- Смена аукциона (очередь wolmar-parser) ---
// Один фиксированный workflowId: параллельных смен аукциона быть не должно —
// они дрались бы за единственный headless-Chrome парсер-воркера. Повторный старт
// при идущем прогоне падает с WorkflowExecutionAlreadyStartedError, и это норма:
// вызывающий (cron) трактует её как «уже идёт, пропускаем».
const ROLLOVER_WORKFLOW_ID = 'auction-rollover';

async function startRollover(options = {}) {
    const client = await getClient();
    const handle = await client.workflow.start(auctionRolloverWorkflow, {
        taskQueue: PARSER_TASK_QUEUE,
        workflowId: ROLLOVER_WORKFLOW_ID,
        args: [{
            force: !!options.force,
            finalizeAll: !!options.finalizeAll,
            maxFinalize: options.maxFinalize,
            finalizeMaxAgeDays: options.finalizeMaxAgeDays,
            coverageTarget: options.coverageTarget,
            chunkSize: PARSER_CHUNK_SIZE,
            chunksBeforeContinue: PARSER_CHUNKS_BEFORE_CONTINUE,
        }],
    });
    return { workflowId: handle.workflowId, runId: handle.firstExecutionRunId };
}

async function getRolloverProgress() {
    const client = await getClient();
    const handle = client.workflow.getHandle(ROLLOVER_WORKFLOW_ID);
    const desc = await handle.describe();
    let progress = null;
    if (desc.status.name === 'RUNNING') {
        try { progress = await handle.query('progress'); } catch (_) { progress = null; }
    }
    return { workflowId: ROLLOVER_WORKFLOW_ID, status: desc.status.name, progress };
}

async function stopRollover() {
    const client = await getClient();
    await client.workflow.getHandle(ROLLOVER_WORKFLOW_ID).cancel();
    return { workflowId: ROLLOVER_WORKFLOW_ID, cancelled: true };
}

async function enqueuePhotoProcessing({ photoId }) {
    const client = await getClient();
    const { COLLECTION_PHOTO_TASK_QUEUE, collectionPhotoWorkflowId } = require('./shared');
    const workflowId = collectionPhotoWorkflowId(photoId);
    try {
        const handle = await client.workflow.start(collectionPhotoWorkflow, {
            taskQueue: COLLECTION_PHOTO_TASK_QUEUE,
            workflowId,
            workflowIdReusePolicy: 'ALLOW_DUPLICATE_FAILED_ONLY',
            args: [{ photoId }],
        });
        return { workflowId, runId: handle.firstExecutionRunId };
    } catch (error) {
        if (error?.name === 'WorkflowExecutionAlreadyStartedError') return { workflowId, existing: true };
        throw error;
    }
}

async function enqueueValuationRecalculation({ itemId }) {
    const client = await getClient();
    const { COLLECTION_VALUATION_TASK_QUEUE, collectionValuationWorkflowId } = require('./shared');
    const workflowId = collectionValuationWorkflowId(itemId);
    try {
        const handle = await client.workflow.start(collectionValuationWorkflow, {
            taskQueue: COLLECTION_VALUATION_TASK_QUEUE,
            workflowId,
            workflowIdReusePolicy: 'ALLOW_DUPLICATE',
            args: [{ itemId }],
        });
        return { workflowId, runId: handle.firstExecutionRunId };
    } catch (error) {
        if (error?.name !== 'WorkflowExecutionAlreadyStartedError') throw error;
        const handle = client.workflow.getHandle(workflowId);
        try {
            await handle.signal(requestValuationRecalculation);
            return { workflowId, existing: true, signalled: true };
        } catch (signalError) {
            if (!/not found|already completed|closed/i.test(signalError.message || '')) throw signalError;
            const retry = await client.workflow.start(collectionValuationWorkflow, {
                taskQueue: COLLECTION_VALUATION_TASK_QUEUE,
                workflowId,
                workflowIdReusePolicy: 'ALLOW_DUPLICATE',
                args: [{ itemId }],
            });
            return { workflowId, runId: retry.firstExecutionRunId };
        }
    }
}

async function enqueueCollectionExport({ exportId }) {
    const client = await getClient();
    const { COLLECTION_DATA_TASK_QUEUE, collectionExportWorkflowId } = require('./shared');
    const workflowId = collectionExportWorkflowId(exportId);
    try {
        const handle = await client.workflow.start(collectionExportWorkflow, {
            taskQueue: COLLECTION_DATA_TASK_QUEUE,
            workflowId,
            workflowIdReusePolicy: 'ALLOW_DUPLICATE_FAILED_ONLY',
            args: [{ exportId }],
        });
        return { workflowId, runId: handle.firstExecutionRunId };
    } catch (error) {
        if (error?.name === 'WorkflowExecutionAlreadyStartedError') return { workflowId, existing: true };
        throw error;
    }
}

async function enqueueAccountDeletion({ deletionId, executeAt }) {
    const client = await getClient();
    const { accountDeletionWorkflowId, COLLECTION_DATA_TASK_QUEUE } = require('./shared');
    const workflowId = accountDeletionWorkflowId(deletionId);
    try {
        const handle = await client.workflow.start(accountDeletionWorkflow, {
            taskQueue: COLLECTION_DATA_TASK_QUEUE,
            workflowId,
            workflowIdReusePolicy: 'ALLOW_DUPLICATE_FAILED_ONLY',
            args: [{ deletionId, executeAt }],
        });
        return { workflowId, runId: handle.firstExecutionRunId };
    } catch (error) {
        if (error?.name === 'WorkflowExecutionAlreadyStartedError') return { workflowId, existing: true };
        throw error;
    }
}

// --- Живой список активных задач для дашборда «Активные задачи» ---
// Перечисляем RUNNING workflow-ы в namespace и оставляем ТОЛЬКО наши
// (префиксы forecast- / parse-auction-). Дочерние parse-cat-* и чужие
// book-pipeline-* (historical-recipes, общий кластер) пропускаем —
// их не трогаем и не опрашиваем, коэкзистенс не нарушаем.
async function listActive() {
    const client = await getClient();
    const tasks = [];
    let iter;
    try {
        iter = client.workflow.list({ query: 'ExecutionStatus="Running"' });
    } catch (_) {
        return { tasks };
    }
    for await (const wf of iter) {
        const id = wf.workflowId;
        let type = null;
        if (id === 'auction-rollover') type = 'rollover';
        else if (id === 'bid-refresh-batch') type = 'bid-refresh';
        else if (id.startsWith('bidrefresh-parse-')) type = 'parse';
        else if (id.startsWith('forecast-') || id.startsWith('bidrefresh-forecast-')) type = 'forecast';
        else if (id.startsWith('parse-auction-') || id.startsWith('rollover-parse-')
                 || id.startsWith('rollover-finalize-')) type = 'parse';
        else if (id.startsWith('rollover-forecast-')) type = 'forecast';
        else continue; // parse-cat-* (дети) и book-pipeline-* (чужие) — мимо

        let progress = null;
        try { progress = await client.workflow.getHandle(id).query('progress'); } catch (_) {}

        // Для парсинга подтягиваем прогресс текущей категории-ребёнка (лоты внутри).
        if (type === 'parse' && progress && typeof progress.currentCategoryIndex === 'number') {
            const childId = categoryParseWorkflowId(progress.auctionNumber, progress.currentCategoryIndex);
            try { progress.current = await client.workflow.getHandle(childId).query('progress'); } catch (_) {}
        }

        tasks.push({
            workflowId: id,
            type,
            status: wf.status && wf.status.name ? wf.status.name : 'RUNNING',
            startTime: wf.startTime || null,
            progress,
        });
    }
    return { tasks };
}

module.exports = {
    getClient,
    startForecast, getForecastProgress, stopForecast,
    startAuctionParse, getAuctionParseProgress, stopAuctionParse,
    startBidRefresh,
    startRollover, getRolloverProgress, stopRollover,
    enqueuePhotoProcessing,
    enqueueValuationRecalculation,
    enqueueCollectionExport,
    enqueueAccountDeletion,
    listActive,
};

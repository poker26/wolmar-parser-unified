// Воркфлоу парсера аукциона. Детерминированная песочница — НЕТ process/env/pg/puppeteer.
// Структура повторяет естественную вложенность: аукцион → категории → страницы лотов.
// Resume берётся из истории Temporal: упал воркер посреди категории — чанк переиграется
// с последнего завершённого, без файлов прогресса.
'use strict';

const {
    proxyActivities, defineQuery, setHandler, continueAsNew, executeChild, workflowInfo,
} = require('@temporalio/workflow');

// Размеры чанков приходят через input (клиент берёт из env), с литеральными дефолтами.
const DEFAULT_CHUNK_SIZE = 20;
const DEFAULT_CHUNKS_BEFORE_CONTINUE = 50;

const { loadCategories, getCategoryLotUrls, parseLotsChunk } = proxyActivities({
    startToCloseTimeout: '15 minutes',  // чанк = до ~20 лотов * (парс + delay)
    heartbeatTimeout: '120 seconds',
    retry: { maximumAttempts: 3 },      // ретрай чанка идемпотентен (upsert)
});

const progressQuery = defineQuery('progress');

// --- Дочерний воркфлоу: одна категория ---
async function parseCategoryWorkflow(input) {
    const { auctionNumber, categoryName, categoryUrl, options } = input;
    let processed = input.processed || 0;
    let errors = input.errors || 0;
    let offset = input.offset || 0;
    let lotUrls = input.lotUrls || null;
    const chunkSize = input.chunkSize || DEFAULT_CHUNK_SIZE;
    const chunksBeforeContinue = input.chunksBeforeContinue || DEFAULT_CHUNKS_BEFORE_CONTINUE;

    setHandler(progressQuery, () => ({
        scope: 'category', categoryName,
        total: lotUrls ? lotUrls.length : 0, processed, errors, offset,
    }));

    // Список лотов собираем один раз; при continueAsNew переносим через input.
    if (!lotUrls) lotUrls = await getCategoryLotUrls(auctionNumber, categoryUrl);
    const total = lotUrls.length;

    let chunksThisRun = 0;
    while (offset < total) {
        const chunk = lotUrls.slice(offset, offset + chunkSize);
        const r = await parseLotsChunk(auctionNumber, categoryName, chunk, options);
        processed += r.processed;
        errors += r.errors;
        offset += chunk.length;
        chunksThisRun++;

        if (chunksThisRun >= chunksBeforeContinue && offset < total) {
            await continueAsNew({
                auctionNumber, categoryName, categoryUrl, options,
                lotUrls, processed, errors, offset, chunkSize, chunksBeforeContinue,
            });
        }
    }
    return { processed, errors, total };
}

// --- Родительский воркфлоу: аукцион целиком ---
async function parseAuctionWorkflow(input = {}) {
    const auctionNumber = input.auctionNumber;
    const options = input.options || {};
    const startedAt = input.startedAt || workflowInfo().startTime.toISOString();
    const chunkSize = input.chunkSize || DEFAULT_CHUNK_SIZE;
    const chunksBeforeContinue = input.chunksBeforeContinue || DEFAULT_CHUNKS_BEFORE_CONTINUE;

    // Категории резолвим один раз и переносим через continueAsNew (детерминизм).
    let categories = input.categories || null;
    let index = input.index || 0;
    let processed = input.processed || 0;
    let errors = input.errors || 0;

    setHandler(progressQuery, () => ({
        scope: 'auction', auctionNumber, startedAt,
        totalCategories: categories ? categories.length : 0,
        currentCategoryIndex: index,
        currentCategoryName: categories && categories[index] ? categories[index].name : null,
        processed, errors,
        done: categories ? index >= categories.length : false,
    }));

    if (!categories) categories = await loadCategories(auctionNumber);

    // Категории независимы, но браузер один → обрабатываем последовательно (executeChild await).
    while (index < categories.length) {
        const cat = categories[index];
        const r = await executeChild(parseCategoryWorkflow, {
            workflowId: `parse-cat-${auctionNumber}-${index}`,
            args: [{
                auctionNumber, categoryName: cat.name, categoryUrl: cat.url, options,
                chunkSize, chunksBeforeContinue,
            }],
        });
        processed += r.processed;
        errors += r.errors;
        index++;

        // Бар истории родителя растёт медленно (1 событие на категорию), но подстрахуемся.
        if (index < categories.length && index % 100 === 0) {
            await continueAsNew({
                auctionNumber, options, startedAt, categories, index, processed, errors,
                chunkSize, chunksBeforeContinue,
            });
        }
    }
    return { auctionNumber, categories: categories.length, processed, errors };
}

module.exports = { parseAuctionWorkflow, parseCategoryWorkflow };

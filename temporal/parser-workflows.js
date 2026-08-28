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
    heartbeatTimeout: '10 minutes',
    retry: { maximumAttempts: 3 },      // ретрай чанка идемпотентен (upsert)
});

// Активити смены аукциона: короткие (HTTP к главной + пара запросов в БД).
const { planRollover, markRolloverStep } = proxyActivities({
    startToCloseTimeout: '2 minutes',
    retry: { maximumAttempts: 3 },
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
    if (!lotUrls) {
        const maxLots = options && options.maxLotsPerCategory
            ? Math.max(1, Number(options.maxLotsPerCategory))
            : null;
        lotUrls = await getCategoryLotUrls(auctionNumber, categoryUrl, maxLots);
    }
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

    if (!categories) {
        categories = await loadCategories(auctionNumber, {
            predictableOnly: !!options.predictableOnly,
            auctionSeries: options.auctionSeries || 'vip',
        });
    }

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

// --- Батч дофинализации ставок: по списку завершённых аукционов ПОСЛЕДОВАТЕЛЬНО ---
// У парсера один headless-Chrome (singleton по аукциону) → если гнать аукционы параллельно,
// браузер будет пересоздаваться на каждый чанк. Поэтому строго по одному.
// Шаги на аукцион: (1) переразбор ставок (updateBids) → финал winning_bid + lot_status;
// (2) пересчёт прогноза (дочерний workflow на очереди форкаста). Каталог авто-чинится
// (карточки читают auction_lots.winning_bid живым JOIN — пересборка не нужна).
async function bidRefreshBatchWorkflow(input = {}) {
    // ВАЖНО: наш auction_number (VIP №, напр. 995) ≠ wolmar-id в URL (напр. 2195).
    // Подстановка нашего номера в url_template уводила парсер на ЧУЖОЙ аукцион
    // (wolmar.ru/auction/975 = VIP №464!). Поэтому элемент списка — пара
    // {num: наш номер (прогноз/учёт), wolmarId: id для URL}; строка = оба равны.
    const auctions = (input.auctions || []).map((x) =>
        (x && typeof x === 'object') ? { num: String(x.num), wolmarId: String(x.wolmarId || x.num) }
                                     : { num: String(x), wolmarId: String(x) });
    let index = input.index || 0;
    const results = input.results || [];
    const chunkSize = input.chunkSize || DEFAULT_CHUNK_SIZE;
    const chunksBeforeContinue = input.chunksBeforeContinue || DEFAULT_CHUNKS_BEFORE_CONTINUE;
    // Пересчёт прогнозов имеет смысл ТОЛЬКО для текущего аукциона. Для закрытых — бессмысленно
    // (реальные цены уже известны). По умолчанию ВЫКЛ; включается явно для current.
    const withForecast = input.withForecast === true;

    setHandler(progressQuery, () => ({
        scope: 'bid-refresh', total: auctions.length, index,
        current: auctions[index] ? auctions[index].num : null, done: index >= auctions.length, results,
    }));

    while (index < auctions.length) {
        const a = auctions[index];
        // FAULT-ISOLATION: падение одного аукциона НЕ должно убивать весь батч.
        try {
            // (1) переразбор ставок — категории строятся по wolmarId (реальный URL аукциона)
            const pr = await executeChild(parseAuctionWorkflow, {
                workflowId: `bidrefresh-parse-${a.num}`,
                args: [{
                    auctionNumber: a.wolmarId,
                    // saveAs = НАШ номер: парсер пишет лоты под ним, а не через фантомный БД-лукап по wolmar-id.
                    options: { updateBids: true, predictableOnly: true, delayBetweenLots: 800, saveAs: a.num },
                    chunkSize, chunksBeforeContinue,
                }],
            });
            // (2) пересчёт прогноза — ТОЛЬКО если явно запрошено (withForecast, для текущего аукциона).
            if (withForecast) {
                await executeChild('recomputeForecastsWorkflow', {
                    workflowId: `bidrefresh-forecast-${a.num}`,
                    taskQueue: 'wolmar-forecasts',
                    args: [{ inputNumber: a.num, chunkSize: 50, chunksBeforeContinue: 200 }],
                });
            }
            results.push({ auction: a.num, processed: pr.processed, errors: pr.errors });
        } catch (err) {
            results.push({ auction: a.num, error: String(err && err.message || err) });
        }
        index++;
        if (index < auctions.length) {
            await continueAsNew({ auctions, index, results, chunkSize, chunksBeforeContinue });
        }
    }
    return { results };
}

// --- Смена аукциона: закрыть старый, забрать новый, посчитать прогнозы ---
// Ровно та рутина, которую раньше запускали руками. Весь выбор «что делать»
// сделан в активити planRollover; здесь — только последовательное исполнение.
//
// ПОСЛЕДОВАТЕЛЬНО и в этом порядке — не для красоты:
//   • у парсер-воркера ОДИН headless-Chrome (concurrency 1), и singleton-парсер
//     пересоздаёт браузер при смене аукциона: параллельные шаги молотили бы его вхолостую;
//   • дофинализация идёт ПЕРВОЙ, потому что реальные цены закрывшегося аукциона —
//     самые свежие аналоги для прогнозов нового (медиана взвешена по свежести);
//   • прогнозы — последними, когда лоты уже в базе.
// Падение одного шага не отменяет остальные: причина пишется в steps и видна в query.
async function auctionRolloverWorkflow(input = {}) {
    const chunkSize = input.chunkSize || DEFAULT_CHUNK_SIZE;
    const chunksBeforeContinue = input.chunksBeforeContinue || DEFAULT_CHUNKS_BEFORE_CONTINUE;
    const steps = [];
    let plan = null;

    setHandler(progressQuery, () => ({ scope: 'rollover', plan, steps }));

    plan = await planRollover({
        force: !!input.force,
        finalizeAll: !!input.finalizeAll,
        maxFinalize: input.maxFinalize,
        finalizeMaxAgeDays: input.finalizeMaxAgeDays,
        coverageTarget: input.coverageTarget,
    });

    const run = async (name, fn) => {
        try {
            const r = await fn();
            steps.push({ step: name, ok: true, ...r });
        } catch (err) {
            steps.push({ step: name, ok: false, error: String((err && err.message) || err) });
        }
    };

    // (1) Закрывшиеся аукционы → финальные ставки и lot_status.
    // predictableOnly НЕ включаем: цель — закрыть аукцион целиком, иначе лоты
    // «непрогнозируемых» категорий навсегда остаются active и попадают в план снова.
    for (const a of plan.finalize) {
        await run(`finalize-${a.num}`, async () => {
            const r = await executeChild(parseAuctionWorkflow, {
                workflowId: `rollover-finalize-${a.num}`,
                args: [{
                    auctionNumber: a.wolmarId,
                    options: { updateBids: true, updateCategories: false, delayBetweenLots: 800, saveAs: a.num },
                    chunkSize, chunksBeforeContinue,
                }],
            });
            await markRolloverStep(a.num, 'finalized');
            return { auction: a.num, processed: r.processed, errors: r.errors };
        });
    }

    // (2) Новый аукцион: URL строится по wolmar-id, лоты пишутся под НАШИМ номером (saveAs).
    // Без saveAs парсер сохранил бы их под wolmar-id (2242 вместо 1016) — аукцион-фантом.
    if (plan.parse) {
        await run(`parse-${plan.parse.num}`, async () => {
            const r = await executeChild(parseAuctionWorkflow, {
                workflowId: `rollover-parse-${plan.parse.num}`,
                args: [{
                    auctionNumber: plan.parse.wolmarId,
                    options: { updateCategories: true, updateBids: false, delayBetweenLots: 800, saveAs: plan.parse.num },
                    chunkSize, chunksBeforeContinue,
                }],
            });
            await markRolloverStep(plan.parse.num, 'parsed');
            return { auction: plan.parse.num, processed: r.processed, errors: r.errors };
        });
    }

    // (3) Прогнозы — на очереди форкаста, своим воркером.
    if (plan.forecast) {
        await run(`forecast-${plan.forecast}`, async () => {
            const r = await executeChild('recomputeForecastsWorkflow', {
                workflowId: `rollover-forecast-${plan.forecast}`,
                taskQueue: 'wolmar-forecasts',
                args: [{ inputNumber: plan.forecast, chunkSize: 50, chunksBeforeContinue: 200 }],
            });
            await markRolloverStep(plan.forecast, 'forecasted');
            return { auction: plan.forecast, processed: r.processed, errors: r.errors };
        });
    }

    return { plan, steps };
}

module.exports = {
    parseAuctionWorkflow, parseCategoryWorkflow, bidRefreshBatchWorkflow, auctionRolloverWorkflow,
};

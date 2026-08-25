// Активити парсера аукциона. Оборачивают СУЩЕСТВУЮЩИЙ WolmarCategoryParser как библиотеку:
// никакой логики скрейпинга здесь не переписываем — только вызываем его методы из активити.
// Весь side-effect (Puppeteer + pg) живёт тут; workflow остаётся детерминированным.
'use strict';

const { Context } = require('@temporalio/activity');
const config = require('../config');
const WolmarCategoryParser = require('../wolmar-category-parser');
const { requiresExactDescriptionMatch } = require('../utils/category-exclusions');

// Singleton парсера. Внутри — один headless-Chrome и один pg Client (baseParser),
// поэтому у парсер-воркера maxConcurrentActivityTaskExecutions=1. Ключуем по аукциону:
// targetAuctionNumber фиксируется в конструкторе, при смене аукциона пересоздаём.
let parser = null;
let parserAuction = null;
let parserReady = false;

async function closeParser() {
    if (!parser) return;
    try { if (parser.browser) await parser.browser.close(); } catch (_) {}
    try { if (parser.dbClient) await parser.dbClient.end(); } catch (_) {}
    parser = null;
    parserAuction = null;
    parserReady = false;
}

async function getParser(auctionNumber) {
    const a = String(auctionNumber);
    if (parser && parserAuction !== a) await closeParser();
    if (!parser) {
        parser = new WolmarCategoryParser(config.dbConfig, 'auction', a);
        parserAuction = a;
        parserReady = false;
    }
    if (!parserReady) {
        await parser.init();
        parserReady = true;
    }
    return parser;
}

// Категории аукциона из БД → [{name, url}] с подставленным номером аукциона в шаблон.
// opts.predictableOnly=true → оставляем только «прогнозируемые» категории (монеты, боны,
// марки, серебро, золото), отбрасывая ювелирку/иконы/антиквариат/награды/медали/жетоны.
// Используем тот же канонический фильтр, что и прогнозный пайплайн (category-exclusions).
async function loadCategories(auctionNumber, opts = {}) {
    const p = await getParser(auctionNumber);
    let cats = await p.loadCategoriesFromDatabase();
    if (opts && opts.predictableOnly) {
        const before = cats.length;
        cats = cats.filter((c) => !requiresExactDescriptionMatch(c.name));
        console.log(`[loadCategories] predictableOnly: ${before} → ${cats.length} категорий ` +
            `(оставлены: ${cats.map((c) => c.name).join(', ')})`);
    }
    return cats.map((c) => ({
        name: c.name,
        url: c.url_template.replace('{AUCTION_NUMBER}', p.targetAuctionNumber),
    }));
}

// Все ссылки на лоты в категории (с пагинацией — внутри существующего метода).
async function getCategoryLotUrls(auctionNumber, categoryUrl) {
    const p = await getParser(auctionNumber);
    const urls = await p.getCategoryLotUrls(categoryUrl, false, (page, total) => {
        try { Context.current().heartbeat({ scope: 'pagination', page, total }); } catch (_) {}
    });
    return Array.isArray(urls) ? urls : [];
}

// Обработка чанка лотов одной категории. Повторяет per-lot последовательность из
// parseCategoryLots (parseLotPage → category → saveLotToDatabase → delay), heartbeat на лот.
// Идемпотентно (saveLotToDatabase делает upsert), поэтому ретрай чанка безопасен.
async function parseLotsChunk(auctionNumber, categoryName, lotUrls, options) {
    const { updateCategories = false, updateBids = false, delayBetweenLots = 800 } = options || {};
    const includeBids = updateBids;
    const p = await getParser(auctionNumber);

    let processed = 0;
    let errors = 0;
    for (let i = 0; i < lotUrls.length; i++) {
        const url = lotUrls[i];
        try {
            const lotData = await p.parseLotPage(url, null, categoryName, includeBids, false);
            if (!lotData) { errors++; continue; }
            lotData.category = p.mapCategoryNameToCode(categoryName);
            const savedId = await p.saveLotToDatabase(lotData, false, updateCategories);
            if (savedId) processed++; else errors++;
            await p.delay(delayBetweenLots);
        } catch (e) {
            errors++;
            // Detached-frame — пересоздаём страницу, как в оригинальном цикле.
            if (/detached|Frame/.test(e.message)) {
                try { await p.recreatePage(); await p.delay(3000); } catch (_) {}
            }
        }
        Context.current().heartbeat({ lot: i + 1, of: lotUrls.length });
    }
    return { processed, errors };
}

module.exports = { loadCategories, getCategoryLotUrls, parseLotsChunk, closeParser };

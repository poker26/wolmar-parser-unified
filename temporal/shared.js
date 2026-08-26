// Общие константы для Temporal-пилота (форкаст-пересчёт).
// Всё через env, чтобы worker на server1 мог дозваниваться до Temporal на server3.
'use strict';

module.exports = {
    ADDRESS: process.env.TEMPORAL_ADDRESS || '45.12.72.157:7233',
    NAMESPACE: process.env.TEMPORAL_NAMESPACE || 'default',

    // --- Форкаст-пилот ---
    TASK_QUEUE: process.env.TEMPORAL_TASK_QUEUE || 'wolmar-forecasts',
    // Размер страницы лотов на одну активити (баланс между heartbeat-частотой и накладными).
    CHUNK_SIZE: parseInt(process.env.TEMPORAL_FORECAST_CHUNK, 10) || 50,
    // Сколько чанков обработать до continueAsNew (ограничиваем историю событий).
    CHUNKS_BEFORE_CONTINUE: parseInt(process.env.TEMPORAL_FORECAST_CONTINUE_EVERY, 10) || 200,
    forecastWorkflowId: (auctionNumber) => `forecast-${auctionNumber}`,

    // --- Парсер аукциона (Puppeteer) ---
    // Отдельная очередь: у парсер-воркера один headless-Chrome, изолируем от форкаст-воркера.
    PARSER_TASK_QUEUE: process.env.TEMPORAL_PARSER_QUEUE || 'wolmar-parser',
    // Лотов на одну активити-чанк (ретрай чанка переплачивает максимум этим числом лотов).
    PARSER_CHUNK_SIZE: parseInt(process.env.TEMPORAL_PARSER_CHUNK, 10) || 20,
    // Чанков на одну категорию до continueAsNew дочернего воркфлоу.
    PARSER_CHUNKS_BEFORE_CONTINUE: parseInt(process.env.TEMPORAL_PARSER_CONTINUE_EVERY, 10) || 50,
    auctionParseWorkflowId: (auctionNumber) => `parse-auction-${auctionNumber}`,
    categoryParseWorkflowId: (auctionNumber, idx) => `parse-cat-${auctionNumber}-${idx}`,

    // --- Харвест meshok.net (Scrapfly) ---
    // Отдельная очередь: меняет только auction_lots через Scrapfly (HTTP), без браузера/форкаста.
    MESHOK_TASK_QUEUE: process.env.TEMPORAL_MESHOK_QUEUE || 'wolmar-meshok',
    // Страниц на одну категорию-цель до continueAsNew (бар истории воркфлоу).
    MESHOK_PAGES_BEFORE_CONTINUE: parseInt(process.env.TEMPORAL_MESHOK_CONTINUE_EVERY, 10) || 30,
    meshokHarvestWorkflowId: (tag) => `meshok-harvest-${tag || 'all'}`,

    // --- Харвест numismat.ru (curl+cheerio, аукционный дом → value-медиана) ---
    NUMISMAT_TASK_QUEUE: process.env.TEMPORAL_NUMISMAT_QUEUE || 'wolmar-numismat',
    NUMISMAT_PAGES_BEFORE_CONTINUE: parseInt(process.env.TEMPORAL_NUMISMAT_CONTINUE_EVERY, 10) || 40,
    numismatHarvestWorkflowId: (tag) => `numismat-harvest-${tag || 'all'}`,

    // --- Приватные фотографии пользовательской коллекции ---
    COLLECTION_PHOTO_TASK_QUEUE: process.env.TEMPORAL_COLLECTION_PHOTO_QUEUE || 'wolmar-collection-photos',
    collectionPhotoWorkflowId: (photoId) => `collection-photo-${photoId}`,

    // --- Объяснимая оценка экземпляров коллекции ---
    COLLECTION_VALUATION_TASK_QUEUE: process.env.TEMPORAL_COLLECTION_VALUATION_QUEUE || 'wolmar-collection-valuations',
    collectionValuationWorkflowId: (itemId) => `collection-valuation-${itemId}`,

    // --- Экспорт пользовательских данных и управляемое удаление аккаунта ---
    COLLECTION_DATA_TASK_QUEUE: process.env.TEMPORAL_COLLECTION_DATA_QUEUE || 'wolmar-collection-data',
    collectionExportWorkflowId: (exportId) => `collection-export-${exportId}`,
    accountDeletionWorkflowId: (deletionId) => `account-deletion-${deletionId}`,
};

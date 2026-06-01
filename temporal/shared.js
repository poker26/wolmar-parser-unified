// Общие константы для Temporal-пилота (форкаст-пересчёт).
// Всё через env, чтобы worker на server1 мог дозваниваться до Temporal на server3.
'use strict';

module.exports = {
    TASK_QUEUE: process.env.TEMPORAL_TASK_QUEUE || 'wolmar-forecasts',
    ADDRESS: process.env.TEMPORAL_ADDRESS || '45.12.72.157:7233',
    NAMESPACE: process.env.TEMPORAL_NAMESPACE || 'default',
    // Размер страницы лотов на одну активити (баланс между heartbeat-частотой и накладными).
    CHUNK_SIZE: parseInt(process.env.TEMPORAL_FORECAST_CHUNK, 10) || 50,
    // Сколько чанков обработать до continueAsNew (ограничиваем историю событий).
    CHUNKS_BEFORE_CONTINUE: parseInt(process.env.TEMPORAL_FORECAST_CONTINUE_EVERY, 10) || 200,
    forecastWorkflowId: (auctionNumber) => `forecast-${auctionNumber}`,
};

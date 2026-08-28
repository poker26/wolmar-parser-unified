# Карта фактических расчётов цены

Дата проверки: 2026-08-28  
Основание: `RFC-SLAB-AWARE-VALUATION-AND-IDENTIFICATION.md`  
Режим проверки: исходный код текущего release-кандидата и read-only инвентаризация PM2/cron на `46.173.19.68`.

## Активные runtime-процессы

| Процесс | Точка входа | Состояние при проверке | Роль |
|---|---|---:|---|
| `temporal-forecast-worker` | `/var/www/wolmar-current/temporal/worker.js` | online | Прогнозы аукционных лотов |
| `temporal-collection-valuation-worker` | `/var/www/wolmar-current/temporal/collection-valuation-worker.js` | online | Отдельная оценка новой мобильной коллекции |
| `wolmar-server` | `/var/www/wolmar-current/server.js` | online | API и чтение сохранённых прогнозов |

`temporal-collection-valuation-worker` был загружен из предыдущего release (`PWD=/var/www/wolmar-releases/cfeb15a`), хотя его PM2 script path уже указывает через symlink `wolmar-current`. Это важно учитывать при переключении: замена symlink не обновляет код уже работающего Node-процесса.

## Фактические продуктовые пути

| Потребитель | Запуск расчёта | Доменный расчёт | Хранилище результата | Вывод |
|---|---|---|---|---|
| Текущий аукцион | Temporal `forecastWorkflow` → `temporal/activities.js` | `ImprovedPredictionsGenerator.predictPrice()` | `lot_price_predictions` | Основной production-алгоритм |
| Страницы текущего аукциона и лота | `GET /api/predictions/:auctionNumber`, `GET /api/prediction/:lotId` | Не считают; читают `lot_price_predictions` | `lot_price_predictions` | Корректно являются read-моделью |
| Избранное | `POST /api/watchlist/recalculate-predictions` | Запускает `improved-predictions-generator.js --watchlist` | `lot_price_predictions` | Использует основной генератор |
| Старая коллекция аукционных лотов | `POST /api/collection/recalculate-prices` | `CollectionPriceService` → `ImprovedPredictionsGenerator`; при ошибке возможен `simplePrediction()` | `user_collections.predicted_price` | Основное ядро используется, но ручной fallback создаёт второй алгоритм |
| Коллекция типов каталога | `POST /api/coincat/collection/recalc` | Выбирает представительный проход типа, подменяет его грейд пользовательским и вызывает `ImprovedPredictionsGenerator` | `user_collections.predicted_price` | Повторно использует ядро через хрупкий адаптер представительного лота |
| Новая мобильная коллекция | `POST /api/v1/collection/items/:id/valuation/recalculate` → отдельный Temporal workflow | `temporal/collection-valuation-activities.js`: продажи того же `type_id` и нормализованного точного грейда; P25/P50/P75 | `collection_valuation` | Независимый алгоритм, не использует `ImprovedPredictionsGenerator` |
| Каталог и каталоговая коллекция | SQL в `catalog/api.js` | Медианы по проходам, местами с фильтром грейда | Рассчитывается на чтении | Аналитический показатель, но визуально конкурирует с прогнозом |

## Обнаруженные алгоритмические владельцы

1. `ImprovedPredictionsGenerator` — активное ядро прогноза аукционных лотов.
2. `calculateCollectionValuation` — активное параллельное ядро мобильной коллекции.
3. `CollectionPriceService.simplePrediction` — активный fallback с ручными базовыми ценами и коэффициентами состояния.
4. SQL-медианы в `catalog/api.js` — отдельные вычисления рыночного ориентира.

## Старые реализации

`final-price-predictor.js`, `simplified-price-predictor.js` и `robust-predictions-generator.js` существуют в репозитории, но не обнаружены:

- среди активных PM2-процессов;
- в production cron;
- в активных server/Temporal/catalog entry points.

Они используются как самостоятельные CLI/тестовые файлы либо исторический код. До завершения миграции удалять их нельзя; достаточно исключить их из целевой схемы и проверить повторно перед переключением.

## Slab-проблема существующих путей

Ни один активный расчёт не различает структурированно:

- `slabbed`, `raw`, `unknown`;
- компанию слаба;
- грейд с этикетки и грейд аукционного дома.

Следовательно, прямое переключение мобильной коллекции на текущий `ImprovedPredictionsGenerator` не удовлетворяет RFC: оно устранило бы дублирование, но продолжило бы смешивать несопоставимые продажи.

## Граница безопасного изменения

1. Не менять текущие `lot_price_predictions` и `collection_valuation` до завершения shadow/backtest.
2. Добавить общую модель `SlabInfo`, хранение и единый извлекатель.
3. Выполнить dry-run/backfill исторических лотов.
4. Реализовать общий `valuateCoin` рядом с текущими алгоритмами и писать теневой результат отдельно.
5. Сравнить результаты на аукционных лотах и карточках коллекции.
6. Только после backtest переключить writers; read API продолжат читать сохранённый единый результат.

# Wolmar — каталог монет coins.begemot26.ru (контекст для продолжения проекта)

> Этот файл авто-загружается в каждую сессию, открытую в `C:\Users\hippo\wolmar-parser`.
> **ПОЛНАЯ ПАМЯТЬ проекта** (детали, история, гочи) лежит в ДРУГОМ месте — читай по абсолютному пути:
> `C:\Users\hippo\.claude\projects\C--Users-hippo-historical-recipes\memory\`
> Главный индекс там — `MEMORY.md`. Ключевые файлы (читать по абсолютному пути через Read):
> - `wolmar_auctionru_parser.md` ← **RESUME-блок наверху, читать ПЕРВЫМ для маркетплейс-работы**
> - `wolmar_catalog_project.md` (каталог ПОСТРОЕН, директивы) · `wolmar_catalog_foreign.md` (foreign+identify+Биткин) · `wolmar_catalog_ussr.md` (СССР) · `wolmar_parser_overview.md` (инфра/прод) · `wolmar_temporal_pilot.md` · `coins_mtls_gate_monitoring.md`

## Где что
- **Локальный код:** `C:\Users\hippo\wolmar-parser` (эта папка). Каталог/маркетплейс — в `catalog/`.
- **Прод:** `root@46.173.19.68` → `/var/www/wolmar-parser` (pm2 `wolmar-server` порт 3001; cron поллера). Деплой = scp в `/var/www/wolmar-parser/...` + при нужде `pm2 restart wolmar-server`. Сайт за mTLS (400 без серта = норма).
- **Связанный проект:** `C:\Users\hippo\numismatics` (Краузе-vision + refserver/identify/coinphoto; прод `/opt/numismatics`, docker `numis-web`). Делит с wolmar ТОЛЬКО инфру (общая БД, MinIO, Scrapfly-ключ).
- **БД:** общая Postgres (coin_type, auction_lots, lot_type_link, coin_ref…). `catalog/db.js` = пул.

## Состояние (2026-06-18)
**Каталог ПОСТРОЕН** (имперский ~5300т / ЦБ ~1975т / СССР 974т / foreign ~37.8k KM#-спайн Краузе). identify по фото (Qwen3-VL). Биткин#/Федорин# из описаний. Детали — в memory-файлах выше.

**Маркетплейс-источники (auction.ru + meshok) — В РАБОТЕ.** Цель: (1) sold-сделки → прогноз + плашка «выставлено за X»; (2) «хочу купить X» → офферы по площадкам. Дата-модель: `auction_lots` (× `source_site` × `lot_status`: 'sold'→медианы/прогноз, 'active'→«доступно сейчас») → `lot_type_link` → витрина.

### Построено и работает (`catalog/`)
- `coin-matcher.js` — общий матчер лот→тип, ВСЕ эры (имперское/СССР/модерн-РФ/foreign), тема/двор-дизамбиг + abstention, гейты наборы+банкноты.
- `browser-fetch.js` — puppeteer-stealth, проходит **DDoS-Guard auction.ru** (executablePath `/usr/bin/google-chrome`!).
- `solver-fetch.js` — **Scrapfly** (интерактивный Cloudflare meshok), ключ в `catalog/.solver-key`, ~30 кред/вызов.
- auction.ru: `scrape-auctionru-enum.js` + `scrape-auctionru-fetch.js` (фото→MinIO `coin-photos`) + `poll-auctionru.js` (watch-поллер sold, **cron `0 3 * * *`**). `ingest-auctionru-active.js` (791 active-оффер). `integrate-auctionru.js` (71 foreign-self-тип+фото).
- meshok: `ingest-meshok.js` (Scrapfly; opt=2 sold[bidsCount>0]/opt=1 active; JSON `store/lots/cache`).
- live-поиск: `live-search.js` (`searchAuctionRu` → `auction.ru/listing/offer/search_<q+плюсы>`) + **`live-search-server.js` микросервис (pm2 `live-search` fork, 127.0.0.1:3005, тёплый браузер)**. API `where-to-buy&live=1` ходит к нему по HTTP. РАБОТАЕТ.
- витрина: `api.js` `/api/coincat/type/:id` (`offers` active по источникам; sold-медианы фильтруют active) + `where-to-buy?q=[&live=1]`. `public/catalog-coins.html` блок «Доступно сейчас».

### Deal-finder «Недооценённые сейчас» — ПОСТРОЕН (2026-06-19)
Комбинированный активный аукцион: активные маркетплейс-офферы vs медиана проходов.
- Эндпоинт `GET /api/coincat/deals` (api.js): только `source_site IN (auction.ru,meshok)` (НЕ wolmar-active = открытые аукционы со старт-ставками 1-2₽, главный шум!). grade-aware (та же `condition`, иначе общая медиана + пометка). `cap=40` (ref/ask выше → suspect). Параметры: `min_discount, grade_only, suspect (QA-режим), ask_floor, min_passes, cap`.
- UI: кнопка «Недооценённые» в шапке `catalog-coins.html` → `loadDeals()` (карточки, фильтр дисконта, тумблеры «строго по грейду»/«мисматчи QA»).
- **ФОТО офферов**: 790/791 активных auction.ru-офферов имеют фото в MinIO `coin-photos/<offer_id>/N.jpg` (offer_id=`auction_lots.lot_number`), но `avers_image_url` НЕ заполнен. Бакет ПРИВАТНЫЙ (s3 root=403) → фото-прокси `GET /api/coincat/photo/:offer/:idx` в api.js (стримит из MinIO; креды `/opt/numismatics/.env`; пакет `minio` уже стоит). deals отдаёт `photo`+`n_photos`+`lot_number` (только auction.ru, n_photos>0) + **`type_photo`** (фолбэк-визуал типа: avers прохода wolmar → фото ЦБ `cbrImg(cbr_cat_num)` → image_url — для мешок-аукционов без фото оффера; карточка метит «фото типа»). Карточка: фото+зум, при n_photos>1 бейдж «📷 N» + галерея. Все сделки теперь с визуалом.
- Результат: норма = чистые сделки (3₽ Луноход серебро 10500₽ vs 20210₽; 25₽ Трудовые резервы UNC 1300₽ vs 3110₽ grade-basis). suspect = дата-квалити-фид.
- Правка матчера: `coin-matcher.js` NONCOIN — убраны голые «серия/номер» (монеты тоже в сериях, давали ложные срабатывания), добавлены PMG/PPQ + серийник-банкноты (2 буквы+6цифр).

### «Где купить» (live, кейс бегемота) — UI ПОДКЛЮЧЁН (2026-06-19)
- Кнопка «Где купить» в шапке + CTA «искать вживую» в результатах поиска → `openWhereToBuy()` → `where-to-buy?q=&live=1` → микросервис live-search (:3005, тёплый браузер) ищет на auction.ru в реальном времени. Раздел «В нашей базе» (каталог+проходы+офферы) + «Живые объявления auction.ru» (ссылки; заголовки латиницей — кириллица на странице оффера).
- Каталожный матч в where-to-buy переведён на ТОКЕНИЗАЦИЮ (каждое слово ILIKE, AND) — чинит промахи из-за пунктуации/порядка («3 рубля луноход» → «3 рубля. Луноход»).

### Meshok — ингест активных (2026-06-19)
- `ingest-meshok.js <cat> <pages> 1` (opt=1 active, Scrapfly **1000 скрейпов/мес**, остаток ~700 до 19.07). URL-форма теперь **`/listing?good=<cat>&opt=`** (НЕ `/good/` — 14712 в старой форме не отдаёт).
- **Категории meshok** (из JSON-дерева): **14712 = модерн-РФ коммеморативы 1992-1996** (Русский балет/Тургенев/Освобождение, серебро/PROOF — НАШ каталог, выход 60%); 252=мешанина старьё; 1680/15401=bulk-доминированы. Дерево: 1105 имп, 1106 СССР, 1680 «Россия с 1997», 15401 памятные.
- **Фикс `коллекци`** в SET-регексе coin-matcher: ловил зазывалку «в коллекцию!» на одиночках (резал 14/20) → убран. `N шт`/`N монет` оставлены (реальные наборы).
- ⚠️ meshok active = **АУКЦИОНЫ** (ask=текущая ставка; ставок>0 = реальная цена, ставок=0 = старт). `kind:'auction'` 🔨 амбер, НИЖЕ фикс-асков auction.ru (`kind:'ask'`). 14712-лоты со ставками 15-33, endDate=сегодня → живые сделки-в-процессе.

### Матчер — дизамбиг по МЕТАЛЛУ — ПОСТРОЕН (2026-06-19)
suspect-корзина вскрыла: дешёвые тёзки садятся на драг-типы. Фикс в `coin-matcher.js`: `filterMetal` — если в ОПИСАНИИ нет драг-сигнала (`PRECIOUS_SIG`: золот/сереб/платин/паллад/пруф/инвестиц/унци/Au/Ag), драгоценные кандидаты (`coin_type.metal ~ золот|сереб|платин|паллад`) выкидываются (пусто→abstain). Применён во ВСЕХ ветках matchType. Разлинковка существующих: удалено **101** битой связи (43 золото+58 серебро). suspect 10→3 (осталось «50₽ ВОВ» — у золотого типа metal=NULL, ловит cap=40).

### Live-офферы «Где купить» — ENRICH + КАТЕГОРИЯ + ЛЕНТА (2026-06-19)
- `live-search.js`: поиск теперь **curl** (НЕ browser-fetch!) по URL **`/listing/offer/monety-48393/search_<q>`** — вложен в категорию «Монеты» (иначе глобальный поиск тащит палатки/марки/открытки/банкноты со всего сайта; банкноты — отдельная категория, сюда не лезут). ⚠️ puppeteer на этом URL рендерит ДЕФОЛТ категории (SPA-роутер сбрасывает search-сегмент) → ТОЛЬКО curl (сервер-рендер, проходит DDoS-Guard с прода).
- `fetchOfferDetail(url)` curl → `og:title`(decodeEnt: &middot;/&mdash;/числовые) + `"price":N` + `og:image`. `searchAuctionRu(q,{enrich=6})` обогащает топ-6 параллельно.
- UI: **ленточный layout** `.flist`/`.frow` (фото\|текст\|действие, minmax 440px) для «Где купить» И «Недооценённых» — НЕ каталожные `.list`/`.row` (220px-тайлы крошили текст в столбик!). Клиентский фильтр не-монет — лёгкий бэкап. Фото static.auction.ru хотлинкабельно (200).
- Гоча: enrich держит `busy` микросервиса ~30с/поиск. Под лимитом where-to-buy (60с).

### Meshok live-search — ПОСТРОЕН (2026-06-19)
- URL поиска meshok = **`/listing?good=252&search=<q>`** (good=252 = «Монеты»; без good= → глобал тащит картины/книги/значки; `text=`/`searchString=` ИГНОРятся, только `search=`). Лоты в JSON-стейте (id/price/title/bidsCount/endDate) → enrich НЕ нужен; фото нет (Cloudflare CDN).
- `live-search.js` `searchMeshok(q)` (Scrapfly, **retries:0 / waitMs 4000 — 1 попытка, ~25с, иначе nginx 504**: solver-fetch сам ретраит 2×150с!) → микросервис `/msearch` (`mBusy`) → api.js `/api/coincat/meshok-search?q=` (**матчит каждый оффер→тип → фото типа + `type_id`**, своих фото у meshok нет) → UI кнопка «Искать на meshok.net» (`loadMeshok()`, ОТДЕЛЬНОЙ = контроль расхода). Карточки `.frow` 🔨 аукционы, фото типа где сматчено + «наш тип →».
- **Scrapfly апгрейд: квота 200000/мес** (была 1000, юзер пополнил).
- **Дил-сигнал на live-meshok**: эндпоинт матчит оффер→тип, тянет медиану проходов → `ref_median/ratio/discount/is_deal`. ⚠️ meshok = АУКЦИОНЫ: текущая ставка mid-аукциона всегда ниже медианы → `is_deal` ТОЛЬКО если аукцион закрывается ≤2 дня И ставок≥2 (фикс-цена без endDate — сразу) И ratio∈[1.4,40]. UI: дисклеймер «это аукционы, ставка вырастет; жёлтое = ставка ниже медианы, ориентир для торга». Недооценённые наверх, амбер-бордер. `mBusy` сериализует — параллельный запрос → `{"error":"busy"}` (норма, UI шлёт по одному).

### Кэш live-цен — ПОСТРОЕН (2026-06-19)
- Таблица `live_search_cache (source, query_norm, payload jsonb, fetched_at)` PK(source,query_norm). Кэшируется ТОЛЬКО дорогой внешний фетч (микросервис), матчинг/медиана/дил-сигнал — свежие каждый раз. TTL по умолчанию 1800с (`?ttl=`), `?fresh=1` обходит. Хелперы `getCached/putCached/cachedFetch` + `ensureLiveCacheSchema` в api.js. Ошибки/busy НЕ кэшируются.
- Обёрнуты `/api/coincat/meshok-search` (`cached_age_sec`) и where-to-buy live auction.ru (`live_age_sec`). UI: «кэш N мин назад · обновить» (fresh) в обеих секциях. Эффект: повтор запроса meshok = 0.04с / **0 кредитов Scrapfly** (был 31с).

### Temporal-харвест meshok — ЗАПУЩЕН и МОЛОТИТ (2026-06-19)
- Цель: массово тянуть meshok sold-цены (прогноз) + active (Недооценённые), дни прогона. Очередь **`wolmar-meshok`**, воркер pm2 **`temporal-meshok-worker`** (concurrency 1, Scrapfly последовательно), воркфлоу `meshok-harvest-all`.
- Файлы: `catalog/ingest-meshok.js` (рефактор: export `ingestMeshokPage/ensureMeshokIndex`, IIFE под `require.main`); `temporal/meshok-{activities,workflows,worker}.js` + `start-meshok-harvest.js` (цели TARGETS, sold-first). continueAsNew каждые 30 страниц, идемпотентный upsert → resume из истории Temporal.
- Управление: `node temporal/start-meshok-harvest.js [start|progress|stop]`. Воркфлоу пагинирует категорию до пустой страницы, идёт по 14 целям (8 sold + 6 active).
- **Калибровка sold-выхода**: модерн(14712) 35-40%, СССР(1106) 7.5%, имперские(1105) 0% (старьё без ставок=не продано). 16351/16350 иностранные — измерятся в харвесте. **На meshok большинство finished БЕЗ ставок** (sold = `bidsCount>0`).
- ⚠️ **ГЕЙТ к source-aware медианам**: харвест ЛЬЁТ meshok sold в `auction_lots`, а медианы СЕЙЧАС пулят ВСЕ источники (нет source-фильтра) → meshok marketplace-цены смешиваются с wolmar auction-house. Чем больше накопится, тем сильнее сдвиг. → СРОЧНО следующим: source-aware медианы (wolmar vs маркетплейс раздельно).

### Source-aware медианы — ПОСТРОЕНЫ (2026-06-20)
- Хелперы `auctionSrc()/marketSrc()` в api.js: **ценовая медиана = аукц.дома (wolmar/numismat)**, маркетплейсы (auction.ru/meshok) — ОТДЕЛЬНО, не пулим (meshok-харвест не сдвигает value).
- **deals**: приоритет аукц.дом-по-грейду → аукц.дом-overall → маркетплейс-overall (фолбэк для иностранных, где wolmar пуст), `ref_basis: grade|auction|market`. **meshok-search**: то же (auction→market). **types-list `auction_med`**: только аукц.дома + не-active. **карточка типа**: два блока «Аукционные дома» + «Маркетплейсы» (market_grades), проходы с колонкой источника. **simplified-price-predictor**: калибровка фильтрует `source_site IN (wolmar,numismat) AND lot_status != active`.
- Сторона эффекта: source-split строже (нужно ≥3 в ОДНОМ классе, не суммарно) → тонкие иностранные временно теряют медиану, но market-срез наполнится по мере харвеста.

### Metal-backfill + auction.ru дил-сигнал — ГОТОВО (2026-06-20)
- **Backfill metal** (`catalog/backfill-modern-metal.js`): модерн-РФ NULL-metal золотые (номинал≥25 И имя Победоносец/червонец/Сеятель ИЛИ медиана≥50k). Нашёл РОВНО 1 (#1951 «50₽ 2025 Юбилей Победы» 235k) — остальные золотые уже с metal. Проставлен `золото 999/1000`, 3 битых связи убраны → **suspect-корзина 3→0** (гейт ловит «50₽ ВОВ» сам). Гоча: «высокая цена≠золото» — редкий биметалл (ЯНАО 10₽ 59k) отсекается порогом номинал≥25.
- **auction.ru live дил-сигнал** (where-to-buy): каждый priced-оффер матчится→тип→source-aware медиана→`is_deal` (фикс-цена, БЕЗ аукцион-гейта в отличие от meshok). UI: бейдж −N%, «дешевле в N×», «наш тип →», недооценённые наверх. Считается свежим (не кэшируется), кэш — только сырой фетч.

### Market-медиана в витрине списка — ГОТОВО (2026-06-20)
- types-запрос отдаёт `market_med` (рядом с `auction_med`, оба source-aware). UI: `priceLine`/таблица показывают market как фолбэк («· маркетплейс»/«мрк»), сорт price = COALESCE(auction_med, market_med). 35 типов с market-данными (растёт с харвестом; foreign-матчинг к KM# пока редкий).

### Numismat-харвест — ЗАПУЩЕН (2026-06-20)
- numismat.ru = **аукционный дом** (чистая value-медиана), **curl-абелен без обходов**. Было 8 аукционов/9156 лотов, на сайте **253 аукциона** → допарс 245.
- Старый puppeteer-парсер (`numismat-parser.js`) валиден по структуре, но недоделан (нет дискавери/перебора). Переписал на **curl+cheerio**: `catalog/numismat-core.js` (`parseNumismatPage/ingestNumismatPage/listAuctions`). Лот в `.tview`: `.lot_txt`(описание)+`shop-priceN`(p_start/p_cur0/p_cur-1=итог, s_close=дата)+`shop-pic img`. Валидация: **44/44 цены совпали** со старым парсером. URL `au.shtml?au=N&num=100&page=K`.
- **Коллизия auction_number**: общий констрейнт `(lot_number,auction_number)` БЕЗ source_site, а wolmar(476-1006)/numismat(1-1133) номера пересекаются → numismat-лот перезаписал бы wolmar. Фикс: **namespace-префикс `n`** (auction_number='n1056'), ON CONFLICT на существующий констрейнт. Мигрировал 9156 строк. (Не трогал wolmar-парсеры/констрейнт.)
- Temporal: очередь `wolmar-numismat`, pm2 `temporal-numismat-worker` (concurrency 2), воркфлоу `numismat-harvest-all` (дискавери→245 новых первыми). `node temporal/start-numismat-harvest.js [start|progress|stop]`. Матчит к каталогу (imperial ~78%, modern ~28%).

### Foreign-матчинг + сироты — РАЗОБРАНО (2026-06-20)
- **Открытие**: live-находки/сироты НЕ попадают в каталог. 129860 сирот (auction_lots без lot_type_link): numismat 130k (74%!). НО воронка показала — сироты в массе **НЕ монеты** (бумага/медали/боны/подделки/образцы) + неоднозначные; «массовое создание типов» = мусор (банкнотные «типы»). Отказались.
- **Реальная проблема (кейс Гамбия-бегемот)**: монета УЖЕ в каталоге (#366322 «10 DALASIS GAMBIA»), но матчер не привязывал — **экзотический номинал `даласи` не в `parseDenom`**. Фикс: generic-fallback в parseDenom (`<число> <слово>` для иностранных, value=null/isRf=false) + граница номинала в foreign-ветке (`^num([^0-9]|$)`, «10»≠«100»). Гамбия-1992 теперь матчится; 1975-бегемот всё ещё нет (мульти-кандидат: рус.тема vs англ.Краузе-имя — межъязыковой барьер, отложено).
- **NONCOIN ужесточён**: +казначейск/ассигнаци/кредитный-банковый-госбилет (бумага течёт в сироты numismat). (Убрал слишком широкое «государственный банк».)
- **Релинк сирот** (`catalog/relink-orphans.js [--apply]`): новым матчером привязано +221 (218 foreign). Скромно — подтверждает, что сироты не голдмайн.

### MESHOK-ХАРВЕСТ — БАГ ТЕРМИНАЦИИ ИСПРАВЛЕН (2026-06-20)
- **Был баг**: meshok за концом пагинации отдаёт НЕ пустую страницу, а ТЕ ЖЕ лоты → `lots==0` не срабатывал → зациклился на ussr-sold (стр.1130, 64× дублей), сжёг Scrapfly 54640. Остановил.
- **ФИКС (применён)**: `ingestLot` возвращает `new`/`dup` через `RETURNING (xmax=0)`; воркфлоу терминирует категорию по **`r.new==0`** (+ cap maxPages 80 бэкстоп). Валидировано: modern-active завершился за 3 стр, перешёл дальше.
- **Перенацелен на ACTIVE-ОНЛИ** (8 целей opt=1, для «доступно сейчас»/deals) — sold признан низко-рентабельным (большинство meshok-finished без ставок). Запущен, ограничен (~1k кредитов вместо 54k).

### Мобильная адаптивность — ФИКСЫ (2026-06-20)
- **Корень «меню исчезает в портрете» (ВСЕ страницы)**: в `assets/dark.js` `mountHeader` навигация была `hidden md:flex` (display:none <768px) БЕЗ бургера. Добавил **бургер `#dhBurger` (md:hidden) + выпадающее `#dhMobileNav`** (те же ссылки блоками, toggle hidden/flex). Чинит навигацию на всех страницах (общий компонент).
- **Каталог** (`catalog-coins.html`): шапка `.pgbar` пихала 6 элементов в 1 flex-строку → налезание. Фикс в `@media(max-width:720px)`: `flex-wrap` + `h1 display:none` + поиск `flex:1 1 100% order:2` (своя строка) + кнопки `order:1` (ряд кнопок-иконок). `position:static` (не накладываться на sticky site-header — оба были top:0). `.idbtnt` прячется при 720 (не 640). Таблицы `.tb` → `display:block;overflow-x:auto`. `.flist` 1 столбец.
- Остальные страницы — на Tailwind responsive + общий бургер. Проверка пользователем на телефоне ожидается.

### СЛЕДУЮЩИЙ ШАГ (resume отсюда) — остался полиш
(1) мониторить meshok-харвест (`node temporal/start-meshok-harvest.js progress`; 3000+ sold); (2) чистка старых строк live_search_cache (растёт по уник.запросам — добавить TTL-prune); (3) backfill metal иностранных золотых (Краузе composition → гейт на foreign-ветке); (4) улучшить foreign meshok→KM# матчинг (мало foreign market-проходов). **Крупное всё сделано** (харвест/source-aware/дил-сигналы/metal-гейт).

### Ключевые гочи (НЕ переоткрывать)
- auction.ru = DDoS-Guard (browser-stealth проходит даром); meshok = Cloudflare-interactive (ТОЛЬКО Scrapfly, платно); фото-CDN meshok тоже за Cloudflare → фото с meshok дорого, ПРОПУСКАЕМ.
- auction.ru sitemap = АКТИВНЫЕ аски (не сделки); sold = watch-поллер по InStock→OutOfStock. meshok finished `?opt=2` большинство БЕЗ ставок (не продано) → sold по `bidsCount>0`.
- search-URL auction.ru = GET-форма `/listing/offer/search_<q>` (не SPA-autocomplete).

## Директивы пользователя (DURABLE)
1. Длинные/платные операции — через **Temporal** (resume; НЕ тысячи операций в одной транзакции).
2. **НИКОГДА** не оценивать монету в одном грейде по ней же в другом (кросс-грейд запрещён).
3. «Сначала правильный функционал, деньги/тарифы потом».
4. End git commit messages: `Co-Authored-By: Claude…`. Коммит/пуш — только когда просят.

## ═══ СВЕРКА СОСТОЯНИЯ 2026-08-25 (после ~2 мес паузы; проверено на проде и в БД) ═══
**Прод жив** (46.173.19.68): pm2 `wolmar-server`, `live-search`, `temporal-{parser,forecast,meshok,numismat}-worker` — online (все перезапущены ~21:10 25.08). Сайт используется: `live_search_cache` 15 строк, последний фетч 25.08 16:39.

**Данные (auction_lots / coin_type):**
- wolmar.ru closed **392 512** (парсер идёт: последние аукционы 1009-1013, финиш 1013 = 13.08.2026), active 32 659.
- numismat.ru closed **174 960** по **251** аукциону — Temporal-харвест ОТРАБОТАЛ (было 9 156 / 8 аукционов в июне). Воркфлоу `numismat-harvest-all` в Temporal уже нет (retention истёк) — это норма, цель достигнута.
- meshok.net: sold **204**, active **131** — харвест фактически НЕ прогрелся, воркфлоу `meshok-harvest-all` тоже отсутствует. Воркер online, но простаивает.
- auction.ru: active **791** (застыли с 19.06 — «Доступно сейчас» протухло), sold **3**.
- coin_type: foreign **57 705** (было ~37.8k — вырос за счёт конвейера справочников numismatics/coin-ref-photos), imperial 5 112, модерн/ЦБ 1 975, ussr 974. `lot_type_link` **294 478**.

**СЛОМАНО (найдено при сверке):**
1. **`catalog/poll-auctionru.js` падает КАЖДУЮ ночь** (cron `0 3 * * *`, лог `/tmp/auctionru-poll.log`, последний фейл 25.08 03:00): `FATAL duplicate key ... auction_lots_src_lot`. Причина: в БД появился ЧАСТИЧНЫЙ уникальный индекс `auction_lots_src_lot (source_site, lot_number) WHERE source_site IN ('meshok.net','auction.ru')`, а INSERT сделки в поллере (`catalog/poll-auctionru.js:83`) идёт **вообще без ON CONFLICT** → при попытке записать sold-строку поверх уже существующего active-оффера того же offer_id процесс умирает. Отсюда auction.ru sold = 3. Лечение: `ON CONFLICT (source_site, lot_number) WHERE ... DO UPDATE SET lot_status='sold', winning_bid, bids_count, auction_end_date`.
2. **`catalog/scrape-auctionru-enum.js` перестал что-либо находить**: cron воскресный, лог `/tmp/auctionru-enum.log` (23.08 01:00) — «под-сайтмапов: 0 · добавлено 0 · всего в очереди 1457». Структура sitemap auction.ru изменилась/закрылась → очередь не пополняется.
3. Оба маркетплейс-источника (auction.ru active + meshok) — данные июньские; витрина «Доступно сейчас»/«Недооценённые» работает на протухшем срезе.

**Код/репо:** локальная ветка `coin-catalog` = 2 коммита позади `origin/main`, последний локальный коммит **08.06.2026**. ВСЯ работа июня (маркетплейсы, meshok/numismat-харвесты, deals, live-search, source-aware медианы) — **не закоммичена**: modified 25 файлов + ~50 untracked в `catalog/`, `temporal/`, `public/`. Прод-копия `/var/www/wolmar-parser` на ветке `main` со своими незакоммиченными правками (analytics-service и др.) — прод и локалка расходятся, единого источника правды в git НЕТ.
**Правки после июньского лога памяти:** `catalog/api.js` (04.07) — роут `GET /api/coincat/refphoto/:src/:name` из проекта numismatics (стрим из бакета `coin-ref-photos`). **25.08** прошла хардненинг/гигиена-волна (не мной, следа в сессиях нет): `server.js` (watchlist API + `buildCoinSearchSQL` полнотекстовый поиск по-русски + dedup + execFile вместо exec в pm2-логах), `config.production.js` host → `127.0.0.1`, новый `test/project-structure.test.js` (`npm run verify`), переписан `README.md`, `.gitignore` (игнор `_*.js`-разведки и вложенных копий), `package.json` name → `wolmar-parser-unified`.

### СДЕЛАНО В ТОТ ЖЕ ДЕНЬ (2026-08-25, вечер)
1. **Поллер auction.ru починен.** `catalog/poll-auctionru.js`: sold-INSERT получил `ON CONFLICT (source_site, lot_number) WHERE source_site IN ('meshok.net','auction.ru') DO UPDATE` — сделка теперь ПЕРЕВОДИТ active-оффер в `sold` (проверено в транзакции с ROLLBACK: 1 строка, не дубль). Плюс per-lot try/catch: один сбойный оффер больше не роняет ночной прогон, в итоге печатается «сбоев N». Прогон 100 лотов на проде: exit 0, 0 сбоев.
2. **Энумератор auction.ru починен.** `catalog/scrape-auctionru-enum.js`: (а) ретраи фетча sitemap + явный FATAL при пустом индексе (раньше молча «добавлено 0»); (б) фильтр номинала `DENOM` ищет `<число>_<валюта>` В ЛЮБОМ месте слага — якорь `^\d` выкидывал «moneta_10_rublej_2024_goda», «kazakhstan_10_tenge_2020_goda» (~треть годных); (в) в PHIL добавлены боны/банкноты. Прогон на проде: **+1284 оффера, очередь 1457 → 2741**.
3. **Git сведён.** Июньский пласт закоммичен на `coin-catalog` (5 тематических коммитов), сверху merge со снимком прода `origin/codex/reconcile-production-20260825` (конфликты: свои фиксы поллера/энума, прод-ссылка «Коллекция» в current.html, объединённый .gitignore). `npm run verify` 4/4.
   **Хвосты закрыты:** ветка `coin-catalog` запушена в origin (вместе с merge-коммитом); хардненинг `server.js` + `config.production.js` выкачен на прод, `wolmar-server` перезапущен — слушает 127.0.0.1:3001, `/api/coincat/types` и `/api/search-lots` отвечают 200. Открытым остаётся сабмодуль `wolmar-analytics-clean` с незакоммиченным `public/analytics.html` — разбирать в его собственном репозитории.

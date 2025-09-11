const puppeteer = require('puppeteer-core');
const { Client } = require('pg');
const fs = require('fs');
const config = require('./config');

class NumismatAuctionParser {
    constructor(dbConfig, auctionNumber) {
        this.dbConfig = dbConfig;
        this.dbClient = null;
        this.browser = null;
        this.page = null;
        this.processed = 0;
        this.errors = 0;
        this.skipped = 0;
        this.auctionNumber = auctionNumber;
        this.sourceSite = 'numismat.ru';
        this.progressFile = `numismat_progress_${auctionNumber}.json`;
        this.retryCount = 0;
        this.maxRetries = config.parserConfig.maxRetries;
    }

    async init() {
        try {
            console.log('🔧 Инициализация Numismat парсера...');
            
            // Проверяем доступность базы данных
            await this.testDatabaseConnection();
            
            // Создание таблицы если не существует
            await this.createTable();
            
            // Инициализация браузера
            await this.initBrowser();
            
            console.log('✅ Numismat парсер успешно инициализирован');
        } catch (error) {
            console.error('❌ Ошибка инициализации:', error.message);
            throw error;
        }
    }

    async testDatabaseConnection() {
        console.log('🔍 Проверяем подключение к базе данных...');
        
        try {
            const testClient = new Client(this.dbConfig);
            await testClient.connect();
            await testClient.query('SELECT 1');
            await testClient.end();
            
            console.log('✅ Подключение к базе данных успешно');
            
            this.dbClient = new Client(this.dbConfig);
            await this.dbClient.connect();
            
            this.dbClient.on('error', async (err) => {
                console.error('❌ Ошибка соединения с БД:', err.message);
                await this.handleDatabaseError(err);
            });
            
        } catch (error) {
            console.error('❌ Не удалось подключиться к базе данных:', error.message);
            throw new Error(`Ошибка подключения к БД: ${error.message}`);
        }
    }

    async handleDatabaseError(err) {
        if (this.retryCount >= this.maxRetries) {
            console.error('❌ Превышено максимальное количество попыток переподключения');
            return;
        }

        this.retryCount++;
        console.log(`🔄 Попытка переподключения ${this.retryCount}/${this.maxRetries}...`);
        
        try {
            if (this.dbClient) {
                await this.dbClient.end();
            }
            
            await this.delay(config.parserConfig.retryDelay);
            
            this.dbClient = new Client(this.dbConfig);
            await this.dbClient.connect();
            
            this.dbClient.on('error', async (err) => {
                console.error('❌ Ошибка соединения с БД:', err.message);
                await this.handleDatabaseError(err);
            });
            
            this.retryCount = 0;
            console.log('✅ Переподключение к БД успешно');
            
        } catch (reconnectError) {
            console.error('❌ Ошибка переподключения к БД:', reconnectError.message);
        }
    }

    async initBrowser() {
        console.log('🌐 Инициализация браузера...');
        
        try {
            this.browser = await puppeteer.launch(config.browserConfig);
            this.page = await this.browser.newPage();
            
            await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
            
            console.log('✅ Браузер инициализирован');
        } catch (error) {
            console.error('❌ Ошибка инициализации браузера:', error.message);
            throw error;
        }
    }

    async createTable() {
        try {
            console.log('📋 Создание/проверка таблиц для Numismat...');
            
            // Сначала проверяем, существует ли таблица и есть ли в ней поле source_site
            const checkTableQuery = `
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'auction_lots' AND column_name = 'source_site';
            `;
            const checkResult = await this.dbClient.query(checkTableQuery);
            
            if (checkResult.rows.length === 0) {
                console.log('🔄 Добавляем поле source_site в таблицу auction_lots...');
                const addSourceSiteQuery = `
                    ALTER TABLE auction_lots 
                    ADD COLUMN IF NOT EXISTS source_site VARCHAR(50) DEFAULT 'wolmar.ru';
                `;
                await this.dbClient.query(addSourceSiteQuery);
                
                // Также добавляем поля starting_bid и lot_type если их нет
                const addStartingBidQuery = `
                    ALTER TABLE auction_lots 
                    ADD COLUMN IF NOT EXISTS starting_bid DECIMAL(12, 2);
                `;
                await this.dbClient.query(addStartingBidQuery);
                
                const addLotTypeQuery = `
                    ALTER TABLE auction_lots 
                    ADD COLUMN IF NOT EXISTS lot_type VARCHAR(50);
                `;
                await this.dbClient.query(addLotTypeQuery);
                
                // Поля для URL изображений уже существуют в таблице
                console.log('✅ Поля для URL изображений уже существуют в таблице');
                
                // Удаляем старое уникальное ограничение и создаем новое
                console.log('🔄 Обновляем уникальное ограничение...');
                try {
                    const dropOldConstraintQuery = `
                        ALTER TABLE auction_lots 
                        DROP CONSTRAINT IF EXISTS auction_lots_lot_number_auction_number_key;
                    `;
                    await this.dbClient.query(dropOldConstraintQuery);
                    
                    const addNewConstraintQuery = `
                        ALTER TABLE auction_lots 
                        ADD CONSTRAINT auction_lots_unique 
                        UNIQUE (lot_number, auction_number, source_site);
                    `;
                    await this.dbClient.query(addNewConstraintQuery);
                    console.log('✅ Уникальное ограничение обновлено');
                } catch (constraintError) {
                    console.log('⚠️ Не удалось обновить ограничение, продолжаем...');
                }
                
                console.log('✅ Поля добавлены в таблицу auction_lots');
            }
            
            // Создаем таблицу для лотов (расширенная версия с полем source_site)
            const createLotsTableQuery = `
                CREATE TABLE IF NOT EXISTS auction_lots (
                    id SERIAL PRIMARY KEY,
                    lot_number VARCHAR(50),
                    auction_number VARCHAR(50),
                    source_site VARCHAR(50) DEFAULT 'wolmar.ru',
                    coin_description TEXT,
                    avers_image_url TEXT,
                    avers_image_path TEXT,
                    revers_image_url TEXT,
                    revers_image_path TEXT,
                    winner_login VARCHAR(100),
                    winning_bid DECIMAL(12, 2),
                    starting_bid DECIMAL(12, 2),
                    auction_end_date TIMESTAMP,
                    currency VARCHAR(10) DEFAULT 'RUB',
                    parsed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    source_url TEXT,
                    bids_count INTEGER,
                    lot_status VARCHAR(20),
                    year INTEGER,
                    letters VARCHAR(10),
                    metal VARCHAR(10),
                    condition VARCHAR(20),
                    lot_type VARCHAR(50),
                    UNIQUE(lot_number, auction_number, source_site)
                );
            `;
            await this.dbClient.query(createLotsTableQuery);
            
            // Проверяем таблицу для ссылок
            const checkUrlsTableQuery = `
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'auction_lot_urls' AND column_name = 'source_site';
            `;
            const checkUrlsResult = await this.dbClient.query(checkUrlsTableQuery);
            
            if (checkUrlsResult.rows.length === 0) {
                console.log('🔄 Добавляем поле source_site в таблицу auction_lot_urls...');
                const addSourceSiteUrlsQuery = `
                    ALTER TABLE auction_lot_urls 
                    ADD COLUMN IF NOT EXISTS source_site VARCHAR(50) DEFAULT 'wolmar.ru';
                `;
                await this.dbClient.query(addSourceSiteUrlsQuery);
                console.log('✅ Поле source_site добавлено в таблицу auction_lot_urls');
            }
            
            // Создаем таблицу для ссылок на лоты
            const createUrlsTableQuery = `
                CREATE TABLE IF NOT EXISTS auction_lot_urls (
                    id SERIAL PRIMARY KEY,
                    auction_number VARCHAR(50),
                    source_site VARCHAR(50) DEFAULT 'wolmar.ru',
                    lot_url TEXT NOT NULL,
                    lot_number VARCHAR(50),
                    page_number INTEGER,
                    url_index INTEGER,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(auction_number, source_site, lot_url)
                );
            `;
            await this.dbClient.query(createUrlsTableQuery);
            
            console.log('✅ Таблицы проверены/созданы для Numismat');
        } catch (error) {
            console.error('❌ Ошибка создания таблиц:', error.message);
            throw error;
        }
    }

    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async recreatePage() {
        try {
            if (this.page && !this.page.isClosed()) {
                await this.page.close();
            }
            this.page = await this.browser.newPage();
            await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
            console.log('✅ Страница пересоздана');
            return true;
        } catch (error) {
            console.error('❌ Ошибка пересоздания страницы:', error.message);
            return false;
        }
    }

    async ensurePageActive() {
        if (!this.page || this.page.isClosed()) {
            console.log('🔄 Страница была закрыта, создаем новую...');
            return await this.recreatePage();
        }
        return true;
    }

    async isDatabaseAvailable() {
        try {
            await this.dbClient.query('SELECT 1');
            return true;
        } catch (error) {
            return false;
        }
    }

    async safeQuery(query, params = []) {
        try {
            return await this.dbClient.query(query, params);
        } catch (error) {
            if (error.message.includes('Connection terminated') || 
                error.message.includes('connection') || 
                error.message.includes('not queryable')) {
                
                console.log('🔄 Обнаружена ошибка соединения, пытаемся переподключиться...');
                await this.handleDatabaseError(error);
                
                return await this.dbClient.query(query, params);
            }
            throw error;
        }
    }

    // Получение информации об аукционе
    async getAuctionInfo(auctionUrl) {
        try {
            await this.ensurePageActive();
            await this.page.goto(auctionUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await this.delay(2000);

            const auctionInfo = await this.page.evaluate(() => {
                const info = {};

                // Название аукциона
                const titleElement = document.querySelector('h1');
                if (titleElement) {
                    info.title = titleElement.textContent.trim();
                }

                // Дата закрытия аукциона
                const dateElement = document.querySelector('h1 + p, h1 + div');
                if (dateElement) {
                    const dateText = dateElement.textContent;
                    const dateMatch = dateText.match(/(\d{1,2}\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\s+\d{4}\s+г\.)/i);
                    if (dateMatch) {
                        info.endDate = dateMatch[1];
                    }
                }

                // Общее количество лотов - ищем в тексте страницы
                const pageText = document.body.textContent;
                const lotsMatch = pageText.match(/всего лотов:\s*(\d+)/i);
                if (lotsMatch) {
                    info.totalLots = parseInt(lotsMatch[1]);
                }

                // Количество страниц
                const paginationLinks = document.querySelectorAll('a[href*="page="]');
                let maxPage = 1;
                paginationLinks.forEach(link => {
                    const pageMatch = link.href.match(/page=(\d+)/);
                    if (pageMatch) {
                        const pageNum = parseInt(pageMatch[1]);
                        if (pageNum > maxPage) {
                            maxPage = pageNum;
                        }
                    }
                });
                info.maxPage = maxPage;

                return info;
            });

            return auctionInfo;
        } catch (error) {
            console.error('Ошибка получения информации об аукционе:', error.message);
            return null;
        }
    }

    // Парсинг лотов со страницы
    async parseLotsFromPage(pageUrl, pageNumber) {
        try {
            await this.ensurePageActive();
            await this.page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await this.delay(2000);

            const lotsData = await this.page.evaluate((auctionNumber, sourceSite, pageNumber) => {
                const lots = [];

                // Ищем все блоки лотов - на numismat.ru лоты находятся в div с классом "lot_in"
                const lotBlocks = document.querySelectorAll('.lot_in');
                
                lotBlocks.forEach((block, index) => {
                    try {
                        const lot = {
                            auctionNumber: auctionNumber,
                            sourceSite: sourceSite,
                            pageNumber: pageNumber
                        };

                        // Ищем родительский элемент с номером лота
                        const parentElement = block.closest('.zapis');
                        if (parentElement) {
                            const lotHeader = parentElement.querySelector('h3');
                            if (lotHeader) {
                                const lotNumberMatch = lotHeader.textContent.match(/Лот\s*(\d+)/i);
                                if (lotNumberMatch) {
                                    lot.lotNumber = lotNumberMatch[1];
                                }
                            }
                        }

                        // Описание лота
                        const descriptionElement = block.querySelector('p:not(.price)');
                        if (descriptionElement) {
                            lot.coinDescription = descriptionElement.textContent.trim();
                        }

                        // Извлекаем URL изображений
                        const images = block.querySelectorAll('img');
                        if (images.length >= 1) {
                            lot.aversImageUrl = images[0].src || images[0].getAttribute('data-src');
                        }
                        if (images.length >= 2) {
                            lot.reversImageUrl = images[1].src || images[1].getAttribute('data-src');
                        }

                        // Стартовая цена
                        const priceElement = block.querySelector('.price');
                        if (priceElement) {
                            const startPriceMatch = priceElement.textContent.match(/Старт:\s*(\d+(?:\s?\d+)*)/);
                            if (startPriceMatch) {
                                lot.startingBid = startPriceMatch[1].replace(/\s/g, '');
                            }
                        }

                        // Ищем итоговые цены в элементе .shop-priceN
                        if (parentElement) {
                            const priceElement = parentElement.querySelector('.shop-priceN');
                            if (priceElement) {
                                const priceText = priceElement.textContent.trim();
                                
                                // Паттерн: время + стартовая цена + итоговая цена
                                // Пример: "12:04:00 08.11.20242 0009 500"
                                const timeMatch = priceText.match(/(\d{2}:\d{2}:\d{2}\s+\d{2}\.\d{2}\.\d{4})/);
                                if (timeMatch) {
                                    // Время закрытия - конвертируем в формат PostgreSQL
                                    const timeStr = timeMatch[1]; // "12:04:00 08.11.2024"
                                    const [time, date] = timeStr.split(' ');
                                    const [day, month, year] = date.split('.');
                                    lot.auctionEndDate = `${year}-${month}-${day} ${time}`;
                                    
                                    // Ищем числа после времени
                                    const afterTime = priceText.substring(priceText.indexOf(timeMatch[1]) + timeMatch[1].length);
                                    
                                    // Убираем пробелы и ищем два числа подряд
                                    const cleanNumbers = afterTime.replace(/\s/g, '');
                                    
                                    // Используем стартовую цену из .price элемента для правильного разделения
                                    if (lot.startingBid) {
                                        const startPriceStr = lot.startingBid;
                                        
                                        // Ищем стартовую цену в строке и берем все после неё как итоговую
                                        const startPriceIndex = cleanNumbers.indexOf(startPriceStr);
                                        if (startPriceIndex !== -1) {
                                            const finalPriceStr = cleanNumbers.substring(startPriceIndex + startPriceStr.length);
                                            if (finalPriceStr && finalPriceStr !== '0' && finalPriceStr.length >= 2) {
                                                lot.winningBid = finalPriceStr;
                                            }
                                        }
                                    } else {
                                        // Fallback: если стартовая цена не найдена, используем старый метод
                                        const numbersMatch = cleanNumbers.match(/(\d{4})(\d+)/);
                                        if (numbersMatch) {
                                            lot.startingBid = numbersMatch[1];
                                            const finalPrice = numbersMatch[2];
                                            if (finalPrice && finalPrice !== '0' && finalPrice.length >= 2) {
                                                lot.winningBid = finalPrice;
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        // Извлекаем год из описания
                        const yearMatch = lot.coinDescription?.match(/(\d{4})\s*г/);
                        if (yearMatch) {
                            lot.year = parseInt(yearMatch[1]);
                        }

                        // Определяем тип лота
                        if (lot.coinDescription?.toLowerCase().includes('монета')) {
                            lot.lotType = 'coin';
                        } else if (lot.coinDescription?.toLowerCase().includes('банкнот')) {
                            lot.lotType = 'banknote';
                        } else if (lot.coinDescription?.toLowerCase().includes('документ')) {
                            lot.lotType = 'document';
                        } else if (lot.coinDescription?.toLowerCase().includes('вексель')) {
                            lot.lotType = 'document';
                        } else if (lot.coinDescription?.toLowerCase().includes('облигац')) {
                            lot.lotType = 'document';
                        } else if (lot.coinDescription?.toLowerCase().includes('билет')) {
                            lot.lotType = 'document';
                        } else {
                            lot.lotType = 'other';
                        }

                        // Статус лота - для закрытых аукционов
                        lot.lotStatus = 'closed';

                        // Добавляем лот только если у него есть номер и описание
                        if (lot.lotNumber && lot.coinDescription) {
                            lots.push(lot);
                        }
                    } catch (error) {
                        console.error('Ошибка парсинга лота:', error);
                    }
                });

                return lots;
            }, this.auctionNumber, this.sourceSite, pageNumber);

            return lotsData;
        } catch (error) {
            console.error(`Ошибка парсинга страницы ${pageNumber}:`, error.message);
            return [];
        }
    }

    // Основной метод парсинга всего аукциона
    async parseEntireAuction(auctionUrl, options = {}) {
        const {
            maxLots = null,           
            skipExisting = true,      
            delayBetweenPages = 1000,  
            batchSize = 50,          
            testMode = false,
            startPage = 1
        } = options;

        console.log('🚀 Начинаем парсинг аукциона Numismat...');
        console.log(`Настройки: maxLots=${maxLots}, skipExisting=${skipExisting}, delay=${delayBetweenPages}ms, testMode=${testMode}, startPage=${startPage}`);

        try {
            if (!(await this.isDatabaseAvailable())) {
                throw new Error('База данных недоступна');
            }

            // Получаем информацию об аукционе
            const auctionInfo = await this.getAuctionInfo(auctionUrl);
            if (!auctionInfo) {
                throw new Error('Не удалось получить информацию об аукционе');
            }

            console.log(`📊 Информация об аукционе:`);
            console.log(`   Название: ${auctionInfo.title}`);
            console.log(`   Дата закрытия: ${auctionInfo.endDate}`);
            console.log(`   Всего лотов: ${auctionInfo.totalLots}`);
            console.log(`   Страниц: ${auctionInfo.maxPage}`);

            const pagesToProcess = testMode ? Math.min(3, auctionInfo.maxPage) : auctionInfo.maxPage;
            console.log(`📋 Режим: ${testMode ? 'ТЕСТ' : 'ПОЛНЫЙ'} - обрабатываем ${pagesToProcess} страниц`);

            // Обработка страниц
            for (let page = startPage; page <= pagesToProcess; page++) {
                console.log(`\n📄 Обрабатываем страницу ${page}/${pagesToProcess}...`);
                
                const pageUrl = page === 1 ? 
                    auctionUrl : 
                    `${auctionUrl}&page=${page}`;
                
                try {
                    const lotsData = await this.parseLotsFromPage(pageUrl, page);
                    
                    if (lotsData.length === 0) {
                        console.log(`⚠️ На странице ${page} не найдено лотов`);
                        continue;
                    }

                    console.log(`📦 Найдено лотов на странице ${page}: ${lotsData.length}`);

                    // Обработка каждого лота
                    for (const lotData of lotsData) {
                        try {
                            // Проверка на существование лота
                            if (skipExisting && lotData.lotNumber) {
                                const exists = await this.lotExists(lotData.auctionNumber, lotData.lotNumber, lotData.sourceSite);
                                if (exists) {
                                    console.log(`⏭️ Лот ${lotData.lotNumber} уже существует, пропускаем`);
                                    this.skipped++;
                                    continue;
                                }
                            }

                            // Сохранение в БД
                            const savedId = await this.saveLotToDatabase(lotData);
                            if (savedId) {
                                this.processed++;
                                console.log(`✅ Лот ${lotData.lotNumber}: ${lotData.coinDescription?.substring(0, 50)}...`);
                                console.log(`   💰 ${lotData.startingBid} → ${lotData.winningBid} руб. | 📅 ${lotData.auctionEndDate || 'дата не установлена'}`);
                            } else {
                                console.log(`⚠️ Лот ${lotData.lotNumber} не был сохранен в БД`);
                            }

                        } catch (error) {
                            this.errors++;
                            console.error(`❌ Ошибка обработки лота ${lotData.lotNumber}:`, error.message);
                        }
                    }

                    // Задержка между страницами
                    await this.delay(delayBetweenPages);

                } catch (error) {
                    this.errors++;
                    console.error(`❌ Ошибка обработки страницы ${page}:`, error.message);
                    continue;
                }
            }

            // Финальная статистика
            console.log(`\n🎉 Парсинг завершен!`);
            console.log(`📊 Итоговая статистика:`);
            console.log(`   ✅ Успешно обработано: ${this.processed}`);
            console.log(`   ⏭️ Пропущено (существующих): ${this.skipped}`);
            console.log(`   ❌ Ошибок: ${this.errors}`);

        } catch (error) {
            console.error('💥 Критическая ошибка парсинга аукциона:', error.message);
            throw error;
        }
    }

    async lotExists(auctionNumber, lotNumber, sourceSite) {
        try {
            const query = 'SELECT id FROM auction_lots WHERE auction_number = $1 AND lot_number = $2 AND source_site = $3';
            const result = await this.safeQuery(query, [auctionNumber, lotNumber, sourceSite]);
            return result.rows.length > 0;
        } catch (error) {
            console.error('❌ Ошибка проверки существования лота:', error.message);
            return false;
        }
    }

    async saveLotToDatabase(lotData) {
        // Сначала проверяем, существует ли лот
        const exists = await this.lotExists(lotData.auctionNumber, lotData.lotNumber, lotData.sourceSite);
        if (exists) {
            console.log(`⏭️ Лот ${lotData.lotNumber} уже существует, пропускаем`);
            return null;
        }

        // Сохраняем URL изображений
        console.log(`📷 Аверс URL: ${lotData.aversImageUrl || 'не найден'}`);
        console.log(`📷 Реверс URL: ${lotData.reversImageUrl || 'не найден'}`);

        const insertQuery = `
            INSERT INTO auction_lots (
                lot_number, auction_number, source_site, coin_description, 
                winner_login, winning_bid, starting_bid, auction_end_date, 
                source_url, lot_status, year, lot_type, avers_image_url, revers_image_url
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            RETURNING id;
        `;

        const values = [
            lotData.lotNumber || null,
            lotData.auctionNumber || null,
            lotData.sourceSite || 'numismat.ru',
            lotData.coinDescription || null,
            lotData.winnerLogin || null,
            lotData.winningBid ? parseFloat(lotData.winningBid) : null,
            lotData.startingBid ? parseFloat(lotData.startingBid) : null,
            lotData.auctionEndDate || null,
            lotData.sourceUrl || null,
            lotData.lotStatus || null,
            lotData.year ? parseInt(lotData.year) : null,
            lotData.lotType || null,
            lotData.aversImageUrl || null,
            lotData.reversImageUrl || null
        ];

        try {
            const result = await this.safeQuery(insertQuery, values);
            return result.rows[0].id;
        } catch (error) {
            console.error('❌ Ошибка сохранения в БД:', error.message);
            return null;
        }
    }


    async close() {
        try {
            if (this.page && !this.page.isClosed()) {
                await this.page.close();
            }
        } catch (error) {
            console.error('Ошибка при закрытии страницы:', error.message);
        }
        
        try {
            if (this.browser) {
                await this.browser.close();
            }
        } catch (error) {
            console.error('Ошибка при закрытии браузера:', error.message);
        }
        
        try {
            if (this.dbClient) {
                await this.dbClient.end();
            }
        } catch (error) {
            console.error('Ошибка при закрытии соединения с БД:', error.message);
        }
    }
}

// Основная функция
async function main(auctionNumber) {
    const parser = new NumismatAuctionParser(config.dbConfig, auctionNumber);
    
    try {
        await parser.init();
        
        const auctionUrl = `https://numismat.ru/au.shtml?au=${auctionNumber}`;
        await parser.parseEntireAuction(auctionUrl, {
            maxLots: null,
            skipExisting: true,
            delayBetweenPages: config.parserConfig.delayBetweenLots,
            batchSize: config.parserConfig.batchSize,
            testMode: false
        });
        
    } catch (error) {
        console.error('💥 Общая ошибка:', error.message);
    } finally {
        try {
            await parser.close();
        } catch (closeError) {
            console.error('Ошибка при закрытии парсера:', closeError.message);
        }
    }
}

// Тестовая функция
async function testRun(auctionNumber) {
    const parser = new NumismatAuctionParser(config.dbConfig, auctionNumber);
    
    try {
        await parser.init();
        
        const auctionUrl = `https://numismat.ru/au.shtml?au=${auctionNumber}`;
        await parser.parseEntireAuction(auctionUrl, {
            maxLots: 10,
            skipExisting: false,
            delayBetweenPages: 1000,
            batchSize: 5,
            testMode: true
        });
        
    } catch (error) {
        console.error('💥 Ошибка теста:', error.message);
    } finally {
        try {
            await parser.close();
        } catch (closeError) {
            console.error('Ошибка при закрытии парсера:', closeError.message);
        }
    }
}

module.exports = NumismatAuctionParser;

// Запуск
if (require.main === module) {
    (async () => {
        const args = process.argv.slice(2);
        
        if (args.length === 0) {
            console.log('🚀 Numismat Auction Parser v1.0');
            console.log('Доступные команды:');
            console.log('  main <номер_аукциона>              - Полный парсинг аукциона');
            console.log('  test <номер_аукциона>              - Тестовый запуск (3 страницы)');
            console.log('');
            console.log('Примеры:');
            console.log('  node numismat-parser.js main 1054');
            console.log('  node numismat-parser.js test 1054');
            return;
        }

        const command = args[0];
        const auctionNumber = args[1];

        if (!auctionNumber) {
            console.error('❌ Ошибка: Не указан номер аукциона');
            return;
        }

        console.log(`🚀 Numismat Auction Parser v1.0 - Аукцион ${auctionNumber}`);

        try {
            switch (command) {
                case 'main':
                    console.log(`📍 Запуск полного парсинга аукциона ${auctionNumber}...`);
                    await main(auctionNumber);
                    break;
                    
                case 'test':
                    console.log(`📍 Тестовый запуск аукциона ${auctionNumber}...`);
                    await testRun(auctionNumber);
                    break;
                    
                default:
                    console.error(`❌ Неизвестная команда: ${command}`);
                    console.log('Используйте: main, test');
            }
        } catch (error) {
            console.error('💥 Критическая ошибка:', error.message);
        }
    })();
}

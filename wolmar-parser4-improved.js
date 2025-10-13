const { Client } = require('pg');
const puppeteer = require('puppeteer-core');
const fs = require('fs');

class WolmarAuctionParser {
    constructor(dbConfig, auctionNumber) {
        this.dbConfig = dbConfig;
        this.auctionNumber = auctionNumber;
        this.dbClient = new Client(dbConfig);
        this.browser = null;
        this.page = null;
        this.processed = 0;
        this.skipped = 0;
        this.errors = 0;
    }

    async init() {
        await this.dbClient.connect();
        console.log('✅ Подключение к базе данных успешно');
        
        this.browser = await puppeteer.launch({
            headless: true,
            executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                '--disable-dev-shm-usage',
                '--user-data-dir=/tmp/chrome-temp-' + Math.random().toString(36).substring(7),
                '--disable-metrics',
                '--disable-metrics-reporting',
                '--disable-background-mode',
                '--disable-background-timer-throttling',
                '--disable-renderer-backgrounding',
                '--disable-backgrounding-occluded-windows',
                '--disable-logging',
                '--disable-gpu-logging',
                '--disable-features=TranslateUI,BlinkGenPropertyTrees,VizDisplayCompositor'
            ]
        });
        
        this.page = await this.browser.newPage();
        await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        this.page.setDefaultTimeout(30000);
        this.page.setDefaultNavigationTimeout(30000);
        
        console.log('✅ Браузер инициализирован');
        await this.createTable();
    }

    async createTable() {
        try {
            const createTableQuery = `
                CREATE TABLE IF NOT EXISTS auction_lots (
                    id SERIAL PRIMARY KEY,
                    auction_number VARCHAR(10) NOT NULL,
                    lot_number VARCHAR(20) NOT NULL,
                    coin_description TEXT,
                    avers_image_url TEXT,
                    revers_image_url TEXT,
                    winner_login VARCHAR(100),
                    winning_bid INTEGER,
                    auction_end_date DATE,
                    bids_count INTEGER,
                    lot_status VARCHAR(50),
                    year VARCHAR(10),
                    letters VARCHAR(100),
                    metal VARCHAR(100),
                    condition VARCHAR(100),
                    weight DECIMAL(10,3),
                    parsed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    source_url TEXT,
                    UNIQUE(auction_number, lot_number)
                );
            `;
            await this.dbClient.query(createTableQuery);
            
            // Создаем таблицу для хранения данных о лотах с состояниями
            const createConditionsTableQuery = `
                CREATE TABLE IF NOT EXISTS auction_lots_conditions (
                    id SERIAL PRIMARY KEY,
                    auction_number VARCHAR(10) NOT NULL,
                    lot_url TEXT NOT NULL,
                    condition_text TEXT,
                    extracted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(auction_number, lot_url)
                );
            `;
            await this.dbClient.query(createConditionsTableQuery);
            
            console.log('✅ Таблицы проверены/созданы');
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

    // Функция для извлечения состояния с градацией
    extractConditionWithGrade(conditionText) {
        if (!conditionText) return null;
        return conditionText.replace(/\s+/g, '');
    }

    // Улучшенная функция для получения всех ссылок на лоты с состояниями
    async getAllLotUrlsWithConditions(auctionUrl, testMode = false) {
        console.log('🔍 Собираем ссылки на все лоты с состояниями...');
        const allLotsData = new Map();
        
        try {
            await this.ensurePageActive();
            await this.page.goto(auctionUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await this.delay(2000);

            const paginationInfo = await this.page.evaluate(() => {
                const totalLotsElement = document.querySelector('.disabled[style*="float: right"]');
                const totalLots = totalLotsElement ? totalLotsElement.textContent.match(/(\d+)\s*лот/)?.[1] : null;
                
                const paginationLinks = document.querySelectorAll('.paginator li a');
                let maxPage = 1;
                paginationLinks.forEach(link => {
                    const pageNum = parseInt(link.textContent);
                    if (pageNum && pageNum > maxPage) {
                        maxPage = pageNum;
                    }
                });

                return {
                    totalLots: totalLots ? parseInt(totalLots) : null,
                    maxPage: maxPage
                };
            });

            console.log(`📊 Найдено лотов: ${paginationInfo.totalLots}`);
            console.log(`📄 Страниц пагинации: ${paginationInfo.maxPage}`);

            const pagesToProcess = testMode ? 1 : paginationInfo.maxPage;
            console.log(`📋 Режим: ${testMode ? 'ТЕСТ (только 1 страница)' : 'ПОЛНЫЙ'} - обрабатываем ${pagesToProcess} страниц`);

            for (let page = 1; page <= pagesToProcess; page++) {
                console.log(`🔄 Обрабатываем страницу ${page}/${pagesToProcess}...`);
                
                const pageUrl = page === 1 ? auctionUrl : `${auctionUrl}?page=${page}`;
                
                try {
                    await this.page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
                    await this.delay(1000);

                    const pageLotsData = await this.page.evaluate(() => {
                        const lots = [];
                        const lotLinks = document.querySelectorAll('a.title.lot[href*="/auction/"]');
                        
                        lotLinks.forEach(link => {
                            if (link.href && link.href.includes('/auction/')) {
                                const lotData = { url: link.href };
                                
                                const parentRow = link.closest('tr');
                                if (parentRow) {
                                    const cells = parentRow.querySelectorAll('td');
                                    cells.forEach(cell => {
                                        const cellText = cell.textContent.trim();
                                        if (cellText.match(/^(MS|AU|XF|VF|UNC|PL)[\s\d\-\+\/]*$/i)) {
                                            lotData.condition = cellText;
                                        }
                                    });
                                }
                                
                                if (!lotData.condition && parentRow) {
                                    const rowText = parentRow.textContent;
                                    const conditionMatch = rowText.match(/(MS|AU|XF|VF|UNC|PL)[\s\d\-\+\/]*/i);
                                    if (conditionMatch) {
                                        lotData.condition = conditionMatch[0].trim();
                                    }
                                }
                                
                                if (lotData.condition) {
                                    lots.push(lotData);
                                }
                            }
                        });

                        return lots;
                    });

                    pageLotsData.forEach(lotData => {
                        allLotsData.set(lotData.url, lotData);
                    });
                    
                    console.log(`   ✓ Найдено лотов с состояниями на странице: ${pageLotsData.length} (всего: ${allLotsData.size})`);

                    await this.delay(500);

                } catch (error) {
                    console.error(`❌ Ошибка на странице ${page}:`, error.message);
                    if (error.message.includes('detached') || error.message.includes('Frame')) {
                        console.log(`🔄 Обнаружена ошибка detached frame на странице ${page}, пересоздаем страницу...`);
                        await this.recreatePage();
                        await this.delay(3000);
                    }
                    continue;
                }
            }

            // Сохраняем данные о лотах в базу данных
            if (allLotsData.size > 0) {
                console.log(`💾 Сохраняем данные о ${allLotsData.size} лотах в базу данных...`);
                await this.saveLotUrlsWithConditionsToDatabase(Array.from(allLotsData.values()));
            }

            return Array.from(allLotsData.keys());

        } catch (error) {
            console.error('❌ Ошибка при сборе ссылок и состояний:', error.message);
            return [];
        }
    }

    // Функция для сохранения данных о лотах с состояниями в базу данных
    async saveLotUrlsWithConditionsToDatabase(lotsData) {
        try {
            for (const lotData of lotsData) {
                try {
                    const insertQuery = `
                        INSERT INTO auction_lots_conditions (auction_number, lot_url, condition_text)
                        VALUES ($1, $2, $3)
                        ON CONFLICT (auction_number, lot_url) 
                        DO UPDATE SET 
                            condition_text = EXCLUDED.condition_text,
                            extracted_at = CURRENT_TIMESTAMP;
                    `;
                    
                    await this.dbClient.query(insertQuery, [
                        this.auctionNumber,
                        lotData.url,
                        lotData.condition
                    ]);
                    
                } catch (error) {
                    console.error(`❌ Ошибка при сохранении лота ${lotData.url}:`, error.message);
                }
            }
            
            console.log(`✅ Сохранено ${lotsData.length} записей о состояниях лотов`);
            
        } catch (error) {
            console.error('❌ Ошибка при сохранении данных о состояниях:', error.message);
        }
    }

    // Улучшенная функция парсинга лота с использованием сохраненных состояний
    async parseLotPageWithSavedCondition(url, auctionEndDate = null) {
        try {
            await this.ensurePageActive();
            await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await this.delay(2000);

            const lotData = await this.page.evaluate(() => {
                const data = {};

                // Номер аукциона
                const breadcrumbAuction = document.querySelector('ol[typeof="BreadcrumbList"] li:nth-child(2) span[property="name"]');
                if (breadcrumbAuction) {
                    const match = breadcrumbAuction.textContent.match(/№\s*(\d+)/);
                    if (match) {
                        data.auctionNumber = match[1];
                    }
                }

                if (!data.auctionNumber) {
                    const h1 = document.querySelector('h1');
                    if (h1) {
                        const match = h1.textContent.match(/№\s*(\d+)/);
                        if (match) {
                            data.auctionNumber = match[1];
                        }
                    }
                }

                if (!data.auctionNumber) {
                    const urlMatch = window.location.href.match(/\/auction\/(\d+)\//);
                    if (urlMatch) {
                        data.auctionNumber = urlMatch[1];
                    }
                }

                // Номер лота
                const lotTitle = document.querySelector('h5');
                if (lotTitle) {
                    const match = lotTitle.textContent.match(/Лот\s*№?\s*(\d+)/);
                    if (match) {
                        data.lotNumber = match[1];
                    }
                }

                if (!data.lotNumber) {
                    const lotElements = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
                    for (const element of lotElements) {
                        const match = element.textContent.match(/Лот\s*№?\s*(\d+)/);
                        if (match) {
                            data.lotNumber = match[1];
                            break;
                        }
                    }
                }

                if (!data.lotNumber) {
                    const urlMatch = window.location.href.match(/\/auction\/\d+\/(\d+)/);
                    if (urlMatch) {
                        data.lotNumber = urlMatch[1];
                    }
                }

                // Описание монеты
                const descriptionElement = document.querySelector('.lot-description, .description, .lot-info');
                if (descriptionElement) {
                    data.coinDescription = descriptionElement.textContent.trim();
                }

                if (!data.coinDescription) {
                    const pageText = document.body.textContent;
                    const descriptionMatch = pageText.match(/Описание[:\s]*([^\n\r]+)/i);
                    if (descriptionMatch) {
                        data.coinDescription = descriptionMatch[1].trim();
                    }
                }

                // Извлекаем информацию о состоянии с градацией
                const valuesText = document.body.textContent;
                
                const conditionMatch = valuesText.match(/Сохранность:\s*([\w\-\+\/\s]+)/);
                if (conditionMatch) {
                    data.condition = conditionMatch[1].replace(/\s+/g, '');
                }

                if (!data.condition) {
                    const conditionCells = document.querySelectorAll('td, .condition, .grade');
                    for (const cell of conditionCells) {
                        const cellText = cell.textContent.trim();
                        if (cellText.match(/^(MS|AU|XF|VF|UNC|PL)[\s\d\-\+\/]*$/i)) {
                            data.condition = cellText.replace(/\s+/g, '');
                            break;
                        }
                    }
                }

                // Остальные поля
                const yearMatch = valuesText.match(/Год[:\s]*(\d{4})/);
                if (yearMatch) {
                    data.year = yearMatch[1];
                }

                const metalMatch = valuesText.match(/Металл[:\s]*([^\n\r]+)/i);
                if (metalMatch) {
                    data.metal = metalMatch[1].trim();
                }

                const weightMatch = valuesText.match(/Вес[:\s]*([\d,\.]+)\s*г/i);
                if (weightMatch) {
                    data.weight = parseFloat(weightMatch[1].replace(',', '.'));
                }

                const lettersMatch = valuesText.match(/Буквы[:\s]*([^\n\r]+)/i);
                if (lettersMatch) {
                    data.letters = lettersMatch[1].trim();
                }

                const winnerMatch = valuesText.match(/Победитель[:\s]*([^\n\r]+)/i);
                if (winnerMatch) {
                    data.winnerLogin = winnerMatch[1].trim();
                }

                const bidMatch = valuesText.match(/Цена[:\s]*([\d\s]+)\s*руб/i);
                if (bidMatch) {
                    data.winningBid = parseInt(bidMatch[1].replace(/\s/g, ''));
                }

                const bidsMatch = valuesText.match(/Ставок[:\s]*(\d+)/i);
                if (bidsMatch) {
                    data.bidsCount = parseInt(bidsMatch[1]);
                }

                const statusMatch = valuesText.match(/Статус[:\s]*([^\n\r]+)/i);
                if (statusMatch) {
                    data.lotStatus = statusMatch[1].trim();
                }

                data.sourceUrl = window.location.href;
                return data;
            });

            if (auctionEndDate) {
                lotData.auctionEndDate = auctionEndDate;
            }

            return lotData;

        } catch (error) {
            console.error('Ошибка при парсинге лота:', error.message);
            return null;
        }
    }

    // Основной метод парсинга всего аукциона (улучшенная версия)
    async parseEntireAuction(auctionUrl, options = {}) {
        const {
            maxLots = null,           
            skipExisting = true,      
            delayBetweenLots = 800,  
            batchSize = 50,          
            testMode = false,
            startIndex = 0,
            resumeFromProgress = false,
            savedLotUrls = null
        } = options;

        console.log('Начинаем улучшенный парсинг всего аукциона...');
        console.log(`Настройки: maxLots=${maxLots}, skipExisting=${skipExisting}, delay=${delayBetweenLots}ms, testMode=${testMode}, startIndex=${startIndex}`);

        try {
            const auctionEndDate = await this.getAuctionEndDate(auctionUrl);
            
            let lotUrls = savedLotUrls;
            
            if (!lotUrls || lotUrls.length === 0) {
                console.log('🔍 Собираем ссылки на лоты с состояниями...');
                lotUrls = await this.getAllLotUrlsWithConditions(auctionUrl, testMode);
            } else {
                console.log(`📋 Используем сохраненный список из ${lotUrls.length} ссылок`);
            }
            
            if (lotUrls.length === 0) {
                console.log('Не найдено ссылок на лоты');
                return;
            }

            const totalLots = maxLots ? Math.min(maxLots, lotUrls.length) : lotUrls.length;
            console.log(`Будет обработано лотов: ${totalLots} (начиная с индекса ${startIndex})`);

            for (let i = startIndex; i < totalLots; i++) {
                const url = lotUrls[i];
                const progress = `${i + 1}/${totalLots}`;
                
                try {
                    console.log(`\n[${progress}] Парсинг: ${url}`);
                    
                    const lotData = await this.parseLotPageWithSavedCondition(url, auctionEndDate);
                    
                    if (skipExisting && lotData.auctionNumber && lotData.lotNumber) {
                        const exists = await this.lotExists(lotData.auctionNumber, lotData.lotNumber);
                        if (exists) {
                            console.log(`Лот ${lotData.lotNumber} уже существует, пропускаем`);
                            this.skipped++;
                            continue;
                        }
                    }

                    const savedId = await this.saveLotToDatabase(lotData);
                    if (savedId) {
                        this.processed++;
                        console.log(`[${progress}] Лот ${lotData.lotNumber}: ${lotData.coinDescription?.substring(0, 50)}...`);
                        console.log(`   ${lotData.winningBid} руб. | ${lotData.winnerLogin} | ${lotData.auctionEndDate || 'дата не установлена'}`);
                    } else {
                        console.log(`[${progress}] Лот ${lotData.lotNumber} не был сохранен в БД`);
                    }

                    if ((i + 1) % 10 === 0) {
                        await this.saveProgress(auctionUrl, i + 1, totalLots, url, lotUrls);
                    }

                    await this.delay(delayBetweenLots);

                    if ((i + 1) % batchSize === 0) {
                        console.log(`\nПромежуточная статистика:`);
                        console.log(`   Обработано: ${this.processed}`);
                        console.log(`   Пропущено: ${this.skipped}`);
                        console.log(`   Ошибок: ${this.errors}`);
                    }

                } catch (error) {
                    console.error(`❌ Ошибка при обработке лота ${url}:`, error.message);
                    this.errors++;
                    
                    if (error.message.includes('detached') || error.message.includes('Frame')) {
                        console.log('🔄 Обнаружена ошибка detached frame, пересоздаем страницу...');
                        await this.recreatePage();
                        await this.delay(3000);
                    }
                }
            }

            console.log('\n🎉 ПАРСИНГ АУКЦИОНА ЗАВЕРШЕН!');
            console.log(`📊 Обработано: ${this.processed}`);
            console.log(`⏭️ Пропущено: ${this.skipped}`);
            console.log(`❌ Ошибок: ${this.errors}`);

        } catch (error) {
            console.error('❌ Ошибка при парсинге аукциона:', error.message);
        }
    }

    // Остальные методы остаются без изменений...
    async getAuctionEndDate(auctionUrl) {
        // Реализация получения даты закрытия аукциона
        return null;
    }

    async lotExists(auctionNumber, lotNumber) {
        // Реализация проверки существования лота
        return false;
    }

    async saveLotToDatabase(lotData) {
        // Реализация сохранения лота в базу данных
        return null;
    }

    async saveProgress(auctionUrl, currentIndex, totalLots, currentUrl, lotUrls) {
        // Реализация сохранения прогресса
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

module.exports = WolmarAuctionParser;

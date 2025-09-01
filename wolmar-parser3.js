const puppeteer = require('puppeteer-core');
const { Client } = require('pg');
const fs = require('fs');
const https = require('https');

class WolmarAuctionParser {
    constructor(dbConfig, auctionNumber) {
        this.dbClient = new Client(dbConfig);
        this.browser = null;
        this.page = null;
        this.processed = 0;
        this.errors = 0;
        this.skipped = 0;
        this.auctionNumber = auctionNumber;
        this.progressFile = `parser_progress_${auctionNumber}.json`; // Файл для сохранения прогресса с номером аукциона
    }

    async init() {
        try {
            // Подключение к базе данных
            await this.dbClient.connect();
            console.log('✅ Подключено к базе данных');
            
            // Создание таблицы если не существует
            await this.createTable();
            
            // Инициализация браузера
            this.browser = await puppeteer.launch({
                executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
                headless: true, // Скрытый режим для массового парсинга
                args: [
                    '--no-sandbox', 
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--disable-images', // Не загружаем изображения для ускорения
                    '--disable-javascript' // Отключаем JS где возможно
                ]
            });
            this.page = await this.browser.newPage();
            
            // Установка user-agent
            await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
            
            console.log('✅ Браузер инициализирован');
        } catch (error) {
            console.error('❌ Ошибка инициализации:', error.message);
            throw error;
        }
    }

    async createTable() {
        try {
            const createTableQuery = `
                CREATE TABLE IF NOT EXISTS auction_lots (
                    id SERIAL PRIMARY KEY,
                    lot_number VARCHAR(50),
                    auction_number VARCHAR(50),
                    coin_description TEXT,
                    avers_image_url TEXT,
                    avers_image_path TEXT,
                    revers_image_url TEXT,
                    revers_image_path TEXT,
                    winner_login VARCHAR(100),
                    winning_bid DECIMAL(12, 2),
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
                    UNIQUE(lot_number, auction_number)
                );
            `;
            await this.dbClient.query(createTableQuery);
            console.log('✅ Таблица проверена/создана');
        } catch (error) {
            console.error('❌ Ошибка создания таблицы:', error.message);
            throw error;
        }
    }

    // Утилитарный метод для задержки
    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Метод для безопасного пересоздания страницы
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

    // Метод для проверки и восстановления страницы
    async ensurePageActive() {
        if (!this.page || this.page.isClosed()) {
            console.log('🔄 Страница была закрыта, создаем новую...');
            return await this.recreatePage();
        }
        return true;
    }

    // Парсинг даты и времени из различных форматов
    parseDateTime(dateStr) {
        if (!dateStr) return null;
        
        const monthMap = {
            'января': '01', 'февраля': '02', 'марта': '03', 'апреля': '04',
            'мая': '05', 'июня': '06', 'июля': '07', 'августа': '08',
            'сентября': '09', 'октября': '10', 'ноября': '11', 'декабря': '12'
        };

        // Паттерны для различных форматов дат
        const patterns = [
            // DD.MM.YYYY HH:MM
            {
                regex: /(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})\s+(\d{1,2}):(\d{2})/,
                format: (match) => {
                    const day = match[1].padStart(2, '0');
                    const month = match[2].padStart(2, '0');
                    const year = match[3].length === 2 ? '20' + match[3] : match[3];
                    const hour = match[4].padStart(2, '0');
                    const minute = match[5].padStart(2, '0');
                    return `${year}-${month}-${day} ${hour}:${minute}:00`;
                }
            },
            // DD месяц YYYY HH:MM
            {
                regex: /(\d{1,2})\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\s+(\d{4})\s+(\d{1,2}):(\d{2})/i,
                format: (match) => {
                    const day = match[1].padStart(2, '0');
                    const month = monthMap[match[2].toLowerCase()];
                    const year = match[3];
                    const hour = match[4].padStart(2, '0');
                    const minute = match[5].padStart(2, '0');
                    return month ? `${year}-${month}-${day} ${hour}:${minute}:00` : null;
                }
            },
            // YYYY-MM-DD HH:MM
            {
                regex: /(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})/,
                format: (match) => {
                    const year = match[1];
                    const month = match[2].padStart(2, '0');
                    const day = match[3].padStart(2, '0');
                    const hour = match[4].padStart(2, '0');
                    const minute = match[5].padStart(2, '0');
                    return `${year}-${month}-${day} ${hour}:${minute}:00`;
                }
            },
            // DD.MM HH:MM (текущий год)
            {
                regex: /(\d{1,2})[.\-/](\d{1,2})\s+(\d{1,2}):(\d{2})/,
                format: (match) => {
                    const day = match[1].padStart(2, '0');
                    const month = match[2].padStart(2, '0');
                    const year = new Date().getFullYear();
                    const hour = match[3].padStart(2, '0');
                    const minute = match[4].padStart(2, '0');
                    return `${year}-${month}-${day} ${hour}:${minute}:00`;
                }
            }
        ];

        for (let pattern of patterns) {
            const match = dateStr.match(pattern.regex);
            if (match) {
                const formatted = pattern.format(match);
                if (formatted) {
                    return formatted;
                }
            }
        }

        return null;
    }

    // Извлечение даты из текста страницы
    extractDateFromText(text) {
        if (!text) return null;
        
        // Ищем последние упоминания дат в тексте
        const dateMatches = [];
        const patterns = [
            /(\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}\s+\d{1,2}:\d{2})/g,
            /(\d{1,2}\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\s+\d{4}\s+\d{1,2}:\d{2})/gi,
            /(\d{4}-\d{1,2}-\d{1,2}\s+\d{1,2}:\d{2})/g
        ];

        for (let pattern of patterns) {
            let match;
            while ((match = pattern.exec(text)) !== null) {
                dateMatches.push(match[1]);
            }
        }

        // Берем последнюю найденную дату (предположительно дату окончания)
        if (dateMatches.length > 0) {
            const lastDate = dateMatches[dateMatches.length - 1];
            return this.parseDateTime(lastDate);
        }

        return null;
    }

    // Получение даты окончания аукциона
    async getAuctionEndDate(auctionUrl) {
        try {
            // Проверяем, что страница еще активна
            await this.ensurePageActive();

            await this.page.goto(auctionUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await this.delay(2000);

            const pageText = await this.page.evaluate(() => {
                return document.body.textContent || document.body.innerText || '';
            });

            return this.extractDateFromText(pageText);
        } catch (error) {
            console.error('Ошибка получения даты окончания аукциона:', error.message);
            
            // Если ошибка связана с detached frame, пересоздаем страницу
            if (error.message.includes('detached') || error.message.includes('Frame')) {
                console.log('🔄 Обнаружена ошибка detached frame, пересоздаем страницу...');
                await this.recreatePage();
            }
            
            return null;
        }
    }

    // Получение списка всех ссылок на лоты из основной страницы аукциона
    async getAllLotUrls(auctionUrl, testMode = false) {
        console.log('🔍 Собираем ссылки на все лоты...');
        const allUrls = new Set();
        
        try {
            // Проверяем, что страница еще активна
            await this.ensurePageActive();

            await this.page.goto(auctionUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await this.delay(2000);

            // Получаем общее количество страниц
            const paginationInfo = await this.page.evaluate(() => {
                // Ищем информацию о количестве лотов и страниц
                const totalLotsElement = document.querySelector('.disabled[style*="float: right"]');
                const totalLots = totalLotsElement ? totalLotsElement.textContent.match(/(\d+)\s*лот/)?.[1] : null;
                
                // Ищем последнюю страницу в пагинации
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

            // В тестовом режиме обрабатываем только первую страницу
            const pagesToProcess = testMode ? 1 : paginationInfo.maxPage;
            console.log(`📋 Режим: ${testMode ? 'ТЕСТ (только 1 страница)' : 'ПОЛНЫЙ'} - обрабатываем ${pagesToProcess} страниц`);

            // Проходим по страницам пагинации
            for (let page = 1; page <= pagesToProcess; page++) {
                console.log(`🔄 Обрабатываем страницу ${page}/${pagesToProcess}...`);
                
                const pageUrl = page === 1 ? auctionUrl : `${auctionUrl}?page=${page}`;
                
                try {
                    await this.page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
                    await this.delay(1000);

                    // Извлекаем ссылки на лоты с текущей страницы
                    const pageUrls = await this.page.evaluate(() => {
                        const urls = [];
                        
                        // Ищем все ссылки на лоты в таблице
                        const lotLinks = document.querySelectorAll('a.title.lot[href*="/auction/"]');
                        
                        lotLinks.forEach(link => {
                            if (link.href && link.href.includes('/auction/')) {
                                urls.push(link.href);
                            }
                        });

                        return urls;
                    });

                    pageUrls.forEach(url => allUrls.add(url));
                    console.log(`   ✓ Найдено ссылок на странице: ${pageUrls.length} (всего: ${allUrls.size})`);

                    // Задержка между страницами
                    await this.delay(500);

                } catch (error) {
                    console.error(`❌ Ошибка на странице ${page}:`, error.message);
                    
                    // Если ошибка связана с detached frame, пересоздаем страницу
                    if (error.message.includes('detached') || error.message.includes('Frame')) {
                        console.log(`🔄 Обнаружена ошибка detached frame на странице ${page}, пересоздаем страницу...`);
                        await this.recreatePage();
                        // Делаем паузу перед продолжением
                        await this.delay(3000);
                    }
                    
                    continue;
                }
            }

        } catch (error) {
            console.error('❌ Ошибка при сборе ссылок:', error.message);
            
            // Если ошибка связана с detached frame, пересоздаем страницу
            if (error.message.includes('detached') || error.message.includes('Frame')) {
                console.log('🔄 Обнаружена ошибка detached frame при сборе ссылок, пересоздаем страницу...');
                await this.recreatePage();
            }
        }

        const urlArray = Array.from(allUrls);
        console.log(`📋 Всего собрано уникальных ссылок: ${urlArray.length}`);
        return urlArray;
    }

    // Проверка, существует ли лот в базе данных
    async lotExists(auctionNumber, lotNumber) {
        try {
            const query = 'SELECT id FROM auction_lots WHERE auction_number = $1 AND lot_number = $2';
            const result = await this.dbClient.query(query, [auctionNumber, lotNumber]);
            return result.rows.length > 0;
        } catch (error) {
            console.error('❌ Ошибка проверки существования лота:', error.message);
            
            // Если соединение прервано, пробуем переподключиться
            if (error.message.includes('Connection terminated') || error.message.includes('connection')) {
                console.log('🔄 Переподключение к базе данных...');
                try {
                    await this.dbClient.end();
                    await this.dbClient.connect();
                    console.log('✅ Переподключение успешно');
                    
                    // Повторяем запрос
                    const result = await this.dbClient.query(query, [auctionNumber, lotNumber]);
                    return result.rows.length > 0;
                } catch (reconnectError) {
                    console.error('❌ Ошибка переподключения:', reconnectError.message);
                    return false;
                }
            }
            
            return false; // В случае ошибки считаем, что лот не существует
        }
    }

    // Парсинг отдельного лота
    async parseLotPage(url, auctionEndDate = null) {
        try {
            // Проверяем, что страница еще активна
            await this.ensurePageActive();
            await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await this.delay(2000);

            const lotData = await this.page.evaluate(() => {
                const data = {};

                // Номер аукциона - из хлебных крошек
                const breadcrumbAuction = document.querySelector('ol[typeof="BreadcrumbList"] li:nth-child(2) span[property="name"]');
                if (breadcrumbAuction) {
                    const match = breadcrumbAuction.textContent.match(/№\s*(\d+)/);
                    if (match) {
                        data.auctionNumber = match[1];
                    }
                }

                // Если не нашли в breadcrumb, ищем в h1
                if (!data.auctionNumber) {
                    const h1 = document.querySelector('h1');
                    if (h1) {
                        const match = h1.textContent.match(/№\s*(\d+)/);
                        if (match) {
                            data.auctionNumber = match[1];
                        }
                    }
                }

                // Извлекаем из URL как резерв
                if (!data.auctionNumber) {
                    const urlMatch = window.location.href.match(/\/auction\/(\d+)\//);
                    if (urlMatch) {
                        data.auctionNumber = urlMatch[1];
                    }
                }

                // Номер лота - из заголовка h5
                const lotTitle = document.querySelector('h5');
                if (lotTitle) {
                    const match = lotTitle.textContent.match(/Лот\s*№\s*(\d+)/i);
                    if (match) {
                        data.lotNumber = match[1];
                    }
                }

                // Из URL как резерв
                if (!data.lotNumber) {
                    const urlMatch = window.location.href.match(/\/(\d+)(?:\/|\?|$)/);
                    if (urlMatch) {
                        data.lotNumber = urlMatch[1];
                    }
                }

                // Описание монеты
                let description = '';
                if (lotTitle) {
                    const titleText = lotTitle.textContent.replace(/Лот\s*№\s*\d+\.\s*/i, '').trim();
                    description = titleText;
                }

                const descriptionDiv = document.querySelector('.description');
                if (descriptionDiv) {
                    const descText = descriptionDiv.textContent.trim();
                    if (descText && descText !== description) {
                        description += (description ? ' | ' : '') + descText;
                    }
                }
                data.coinDescription = description;

                // Изображения
                data.images = [];
                const imageLinks = document.querySelectorAll('a[href*="/auction/"][onclick*="openLotImage"]');
                imageLinks.forEach(link => {
                    const img = link.querySelector('img');
                    if (img && img.src) {
                        const fullImageUrl = img.src.replace('/preview_', '/');
                        data.images.push(fullImageUrl);
                    }
                });

                // Информация о торгах
                const valuesDiv = document.querySelectorAll('.values')[1];
                if (valuesDiv) {
                    const valuesText = valuesDiv.textContent;

                    // Текущая ставка
                    const bidMatch = valuesText.match(/Ставка:\s*(\d+(?:\s?\d+)*(?:[.,]\d+)?)\s*руб/i);
                    if (bidMatch) {
                        data.winningBid = bidMatch[1].replace(/\s/g, '').replace(',', '.');
                    }

                    // Лидер
                    const leaderMatch = valuesText.match(/Лидер:\s*([a-zA-Z0-9_А-Яа-я]+)/i);
                    if (leaderMatch) {
                        data.winnerLogin = leaderMatch[1];
                    }

                    // Количество ставок
                    const bidsCountMatch = valuesText.match(/Количество ставок:\s*(\d+)/i);
                    if (bidsCountMatch) {
                        data.bidsCount = bidsCountMatch[1];
                    }

                    // Статус
                    if (valuesText.includes('Лот закрыт')) {
                        data.lotStatus = 'closed';
                    } else {
                        data.lotStatus = 'active';
                    }
                }

                // Характеристики монеты
                const firstValuesDiv = document.querySelectorAll('.values')[0];
                if (firstValuesDiv) {
                    const valuesText = firstValuesDiv.textContent;
                    
                    const yearMatch = valuesText.match(/Год:\s*(\d+)/);
                    if (yearMatch) {
                        data.year = yearMatch[1];
                    }

                    const lettersMatch = valuesText.match(/Буквы:\s*([А-Я\*]+)/);
                    if (lettersMatch) {
                        data.letters = lettersMatch[1];
                    }

                    const metalMatch = valuesText.match(/Металл:\s*(\w+)/);
                    if (metalMatch) {
                        data.metal = metalMatch[1];
                    }

                    const conditionMatch = valuesText.match(/Сохранность:\s*([\w\-\+\/]+)/);
                    if (conditionMatch) {
                        data.condition = conditionMatch[1];
                    }
                }

                return data;
            });

            // Устанавливаем дату окончания аукциона
            if (auctionEndDate) {
                lotData.auctionEndDate = auctionEndDate;
            }

            lotData.sourceUrl = url;
            return lotData;

        } catch (error) {
            console.error(`❌ Ошибка парсинга ${url}:`, error.message);
            
            // Если ошибка связана с detached frame, пересоздаем страницу
            if (error.message.includes('detached') || error.message.includes('Frame')) {
                console.log('🔄 Обнаружена ошибка detached frame, пересоздаем страницу...');
                await this.recreatePage();
            }
            
            throw error;
        }
    }

    async saveLotToDatabase(lotData) {
        const insertQuery = `
            INSERT INTO auction_lots (
                lot_number, auction_number, coin_description, 
                avers_image_url, revers_image_url,
                winner_login, winning_bid, auction_end_date, source_url,
                bids_count, lot_status, year, letters, metal, condition
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
            ON CONFLICT (lot_number, auction_number) 
            DO UPDATE SET
                coin_description = EXCLUDED.coin_description,
                winner_login = EXCLUDED.winner_login,
                winning_bid = EXCLUDED.winning_bid,
                auction_end_date = EXCLUDED.auction_end_date,
                bids_count = EXCLUDED.bids_count,
                lot_status = EXCLUDED.lot_status,
                year = EXCLUDED.year,
                letters = EXCLUDED.letters,
                metal = EXCLUDED.metal,
                condition = EXCLUDED.condition,
                parsed_at = CURRENT_TIMESTAMP
            RETURNING id;
        `;

        const values = [
            lotData.lotNumber || null,
            lotData.auctionNumber || null,
            lotData.coinDescription || null,
            lotData.images?.[0] || null,
            lotData.images?.[1] || null,
            lotData.winnerLogin || null,
            lotData.winningBid ? parseFloat(lotData.winningBid) : null,
            lotData.auctionEndDate || null,
            lotData.sourceUrl || null,
            lotData.bidsCount ? parseInt(lotData.bidsCount) : null,
            lotData.lotStatus || null,
            lotData.year ? parseInt(lotData.year) : null,
            lotData.letters || null,
            lotData.metal || null,
            lotData.condition || null
        ];

        try {
            const result = await this.dbClient.query(insertQuery, values);
            return result.rows[0].id;
        } catch (error) {
            console.error('❌ Ошибка сохранения в БД:', error.message);
            
            // Если соединение прервано, пробуем переподключиться
            if (error.message.includes('Connection terminated') || error.message.includes('connection')) {
                console.log('🔄 Переподключение к базе данных...');
                try {
                    await this.dbClient.end();
                    await this.dbClient.connect();
                    console.log('✅ Переподключение успешно');
                    
                    // Повторяем запрос
                    const result = await this.dbClient.query(insertQuery, values);
                    return result.rows[0].id;
                } catch (reconnectError) {
                    console.error('❌ Ошибка переподключения:', reconnectError.message);
                    console.log('⚠️ Продолжаем парсинг без сохранения этого лота');
                    return null;
                }
            }
            
            // Не выбрасываем ошибку, чтобы парсинг продолжался
            console.log('⚠️ Продолжаем парсинг без сохранения этого лота');
            return null;
        }
    }

    // Основной метод парсинга всего аукциона
    async parseEntireAuction(auctionUrl, options = {}) {
        const {
            maxLots = null,           
            skipExisting = true,      
            delayBetweenLots = 800,  
            batchSize = 50,          
            testMode = false,
            startIndex = 0,          // Начать с определенного индекса
            resumeFromProgress = false, // Не загружать прогресс повторно
            savedLotUrls = null      // Сохраненные ссылки на лоты
        } = options;

        console.log('Начинаем парсинг всего аукциона...');
        console.log(`Настройки: maxLots=${maxLots}, skipExisting=${skipExisting}, delay=${delayBetweenLots}ms, testMode=${testMode}, startIndex=${startIndex}`);

        try {
            // СНАЧАЛА получаем дату закрытия аукциона
            const auctionEndDate = await this.getAuctionEndDate(auctionUrl);
            
            // Получаем ссылки на лоты (используем сохраненные или собираем заново)
            let lotUrls = savedLotUrls;
            if (!lotUrls || lotUrls.length === 0) {
                console.log('🔍 Собираем ссылки на все лоты...');
                lotUrls = await this.getAllLotUrls(auctionUrl, testMode);
            } else {
                console.log(`📋 Используем сохраненный список из ${lotUrls.length} ссылок`);
            }
            
            if (lotUrls.length === 0) {
                console.log('Не найдено ссылок на лоты');
                return;
            }

            const totalLots = maxLots ? Math.min(maxLots, lotUrls.length) : lotUrls.length;
            console.log(`Будет обработано лотов: ${totalLots} (начиная с индекса ${startIndex})`);

            // Обработка лотов с передачей единой даты
            for (let i = startIndex; i < totalLots; i++) {
                const url = lotUrls[i];
                const progress = `${i + 1}/${totalLots}`;
                
                try {
                    console.log(`\n[${progress}] Парсинг: ${url}`);
                    
                    // Передаем дату закрытия аукциона в парсинг лота
                    const lotData = await this.parseLotPage(url, auctionEndDate);
                    
                    // Проверка на существование лота
                    if (skipExisting && lotData.auctionNumber && lotData.lotNumber) {
                        const exists = await this.lotExists(lotData.auctionNumber, lotData.lotNumber);
                        if (exists) {
                            console.log(`Лот ${lotData.lotNumber} уже существует, пропускаем`);
                            this.skipped++;
                            continue;
                        }
                    }

                    // Сохранение в БД
                    const savedId = await this.saveLotToDatabase(lotData);
                    if (savedId) {
                        this.processed++;
                        
                        // Вывод информации о лоте
                        console.log(`[${progress}] Лот ${lotData.lotNumber}: ${lotData.coinDescription?.substring(0, 50)}...`);
                        console.log(`   ${lotData.winningBid} руб. | ${lotData.winnerLogin} | ${lotData.auctionEndDate || 'дата не установлена'}`);
                    } else {
                        console.log(`[${progress}] Лот ${lotData.lotNumber} не был сохранен в БД`);
                    }

                    // Автоматическое сохранение прогресса каждые 10 лотов
                    if ((i + 1) % 10 === 0) {
                        await this.saveProgress(auctionUrl, i + 1, totalLots, url, lotUrls);
                    }

                    // Задержка между лотами
                    await this.delay(delayBetweenLots);

                    // Промежуточное сохранение прогресса
                    if ((i + 1) % batchSize === 0) {
                        console.log(`\nПромежуточная статистика:`);
                        console.log(`   Обработано: ${this.processed}`);
                        console.log(`   Пропущено: ${this.skipped}`);
                        console.log(`   Ошибок: ${this.errors}`);
                        // Сохраняем прогресс при каждой промежуточной статистике
                        await this.saveProgress(auctionUrl, i + 1, totalLots, url, lotUrls);
                    }

                } catch (error) {
                    this.errors++;
                    console.error(`[${progress}] Ошибка обработки ${url}:`, error.message);
                    
                    // Сохраняем прогресс при ошибке
                    await this.saveProgress(auctionUrl, i, totalLots, url, lotUrls);
                    
                    // Если ошибка связана с detached frame, делаем дополнительную паузу
                    if (error.message.includes('detached') || error.message.includes('Frame')) {
                        console.log(`[${progress}] Обнаружена ошибка detached frame, делаем паузу 5 секунд...`);
                        await this.delay(5000);
                    }
                    
                    // Если ошибка связана с соединением базы данных, пробуем переподключиться
                    if (error.message.includes('Connection terminated') || error.message.includes('connection')) {
                        console.log(`[${progress}] Обнаружена ошибка соединения с БД, пробуем переподключиться...`);
                        try {
                            await this.dbClient.end();
                            await this.dbClient.connect();
                            console.log(`[${progress}] Переподключение к БД успешно`);
                        } catch (reconnectError) {
                            console.error(`[${progress}] Ошибка переподключения к БД:`, reconnectError.message);
                        }
                    }
                    
                    continue;
                }
            }

            // Финальная статистика
            console.log(`\nПарсинг завершен!`);
            console.log(`Итоговая статистика:`);
            console.log(`   Успешно обработано: ${this.processed}`);
            console.log(`   Пропущено (существующих): ${this.skipped}`);
            console.log(`   Ошибок: ${this.errors}`);
            console.log(`   Всего попыток: ${totalLots - startIndex}`);
            console.log(`   Дата закрытия аукциона: ${auctionEndDate}`);

            // Очищаем файл прогресса при успешном завершении
            await this.clearProgress();

        } catch (error) {
            console.error('Критическая ошибка парсинга аукциона:', error.message);
            
            // Если ошибка связана с detached frame, пытаемся восстановиться
            if (error.message.includes('detached') || error.message.includes('Frame')) {
                console.log('🔄 Обнаружена критическая ошибка detached frame, пытаемся восстановиться...');
                try {
                    await this.recreatePage();
                    console.log('✅ Восстановление выполнено успешно');
                } catch (recreateError) {
                    console.error('❌ Не удалось восстановиться:', recreateError.message);
                }
            }
            
            // Если ошибка связана с соединением базы данных, пробуем переподключиться
            if (error.message.includes('Connection terminated') || error.message.includes('connection')) {
                console.log('🔄 Обнаружена критическая ошибка соединения с БД, пробуем переподключиться...');
                try {
                    await this.dbClient.end();
                    await this.dbClient.connect();
                    console.log('✅ Переподключение к БД успешно');
                } catch (reconnectError) {
                    console.error('❌ Не удалось переподключиться к БД:', reconnectError.message);
                }
            }
            
            throw error;
        }
    }

    // Метод для сохранения прогресса парсинга
    async saveProgress(auctionUrl, currentIndex, totalLots, lastProcessedUrl = null, lotUrls = null) {
        try {
            const progress = {
                auctionUrl,
                currentIndex,
                totalLots,
                lastProcessedUrl,
                timestamp: new Date().toISOString(),
                processed: this.processed,
                errors: this.errors,
                skipped: this.skipped,
                lotUrls: lotUrls // Сохраняем список ссылок на лоты
            };
            
            fs.writeFileSync(this.progressFile, JSON.stringify(progress, null, 2));
            console.log(`💾 Прогресс сохранен: ${currentIndex}/${totalLots}`);
        } catch (error) {
            console.error('❌ Ошибка сохранения прогресса:', error.message);
        }
    }

    // Метод для загрузки прогресса парсинга
    async loadProgress() {
        try {
            if (fs.existsSync(this.progressFile)) {
                const progressData = fs.readFileSync(this.progressFile, 'utf8');
                const progress = JSON.parse(progressData);
                console.log(`📂 Найден сохраненный прогресс: ${progress.currentIndex}/${progress.totalLots}`);
                console.log(`   Последний обработанный URL: ${progress.lastProcessedUrl}`);
                console.log(`   Время сохранения: ${progress.timestamp}`);
                return progress;
            }
        } catch (error) {
            console.error('❌ Ошибка загрузки прогресса:', error.message);
        }
        return null;
    }

    // Метод для очистки файла прогресса
    async clearProgress() {
        try {
            if (fs.existsSync(this.progressFile)) {
                fs.unlinkSync(this.progressFile);
                console.log('🗑️ Файл прогресса удален');
            }
        } catch (error) {
            console.error('❌ Ошибка удаления файла прогресса:', error.message);
        }
    }

    // Метод для поиска индекса лота по номеру
    async findLotIndexByNumber(lotUrls, targetLotNumber) {
        console.log(`🔍 Ищем лот с номером ${targetLotNumber}...`);
        
        for (let i = 0; i < lotUrls.length; i++) {
            try {
                await this.ensurePageActive();
                await this.page.goto(lotUrls[i], { waitUntil: 'domcontentloaded', timeout: 30000 });
                await this.delay(1000);

                const lotNumber = await this.page.evaluate(() => {
                    const lotTitle = document.querySelector('h5');
                    if (lotTitle) {
                        const match = lotTitle.textContent.match(/Лот\s*№\s*(\d+)/i);
                        if (match) {
                            return match[1];
                        }
                    }
                    return null;
                });

                if (lotNumber === targetLotNumber) {
                    console.log(`✅ Найден лот ${targetLotNumber} на позиции ${i + 1}`);
                    return i;
                }

                if (i % 10 === 0) {
                    console.log(`   Проверено ${i + 1}/${lotUrls.length} лотов...`);
                }

            } catch (error) {
                console.error(`❌ Ошибка при поиске лота ${targetLotNumber} на позиции ${i}:`, error.message);
                continue;
            }
        }
        
        console.log(`❌ Лот с номером ${targetLotNumber} не найден`);
        return -1;
    }

    // Метод для поиска индекса по URL страницы
    async findLotIndexByPage(lotUrls, targetPage) {
        console.log(`🔍 Ищем лоты на странице ${targetPage}...`);
        
        const pageUrl = targetPage === 1 ? 
            'https://www.wolmar.ru/auction/2122' : 
            `https://www.wolmar.ru/auction/2122?page=${targetPage}`;
        
        try {
            await this.ensurePageActive();
            await this.page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await this.delay(2000);

            // Получаем ссылки на лоты с указанной страницы
            const pageUrls = await this.page.evaluate(() => {
                const urls = [];
                const lotLinks = document.querySelectorAll('a.title.lot[href*="/auction/"]');
                lotLinks.forEach(link => {
                    if (link.href && link.href.includes('/auction/')) {
                        urls.push(link.href);
                    }
                });
                return urls;
            });

            // Ищем первую ссылку с этой страницы в общем списке
            for (let i = 0; i < lotUrls.length; i++) {
                if (pageUrls.includes(lotUrls[i])) {
                    console.log(`✅ Найдена первая ссылка со страницы ${targetPage} на позиции ${i + 1}`);
                    return i;
                }
            }

        } catch (error) {
            console.error(`❌ Ошибка при поиске страницы ${targetPage}:`, error.message);
        }
        
        console.log(`❌ Ссылки со страницы ${targetPage} не найдены в общем списке`);
        return -1;
    }

    // Метод для возобновления парсинга с определенной позиции
    async resumeParsing(auctionUrl, options = {}) {
        const {
            startFromIndex = null,      // Начать с определенного индекса
            startFromLotNumber = null,  // Начать с определенного номера лота
            startFromPage = null,       // Начать с определенной страницы
            resumeFromProgress = true,  // Возобновить с сохраненного прогресса
            useSavedUrls = true,        // Использовать сохраненные ссылки
            maxLots = null,             
            skipExisting = true,        
            delayBetweenLots = 800,     
            batchSize = 50,             
            testMode = false            
        } = options;

        console.log('🔄 Возобновляем парсинг аукциона...');
        console.log(`Настройки: startFromIndex=${startFromIndex}, startFromLotNumber=${startFromLotNumber}, startFromPage=${startFromPage}, resumeFromProgress=${resumeFromProgress}, useSavedUrls=${useSavedUrls}`);

        let startIndex = 0;
        let progress = null;
        let lotUrls = null;

        // Загружаем сохраненный прогресс если нужно
        if (resumeFromProgress || useSavedUrls) {
            progress = await this.loadProgress();
            if (progress && progress.auctionUrl === auctionUrl) {
                if (resumeFromProgress) {
                    startIndex = progress.currentIndex;
                    this.processed = progress.processed;
                    this.errors = progress.errors;
                    this.skipped = progress.skipped;
                    console.log(`📂 Возобновляем с сохраненной позиции: ${startIndex}`);
                }
                if (useSavedUrls && progress.lotUrls) {
                    lotUrls = progress.lotUrls; // Загружаем сохраненные ссылки
                    console.log(`📋 Используем сохраненный список из ${lotUrls.length} ссылок`);
                }
            }
        }

        // Приоритет: startFromLotNumber > startFromPage > startFromIndex > сохраненный прогресс
        if (startFromLotNumber) {
            console.log(`🎯 Начинаем с номера лота: ${startFromLotNumber}`);
            if (!lotUrls) {
                lotUrls = await this.getAllLotUrls(auctionUrl, testMode);
            }
            const foundIndex = await this.findLotIndexByNumber(lotUrls, startFromLotNumber);
            if (foundIndex >= 0) {
                startIndex = foundIndex;
            } else {
                console.log(`⚠️ Лот ${startFromLotNumber} не найден, начинаем с начала`);
                startIndex = 0;
            }
        } else if (startFromPage) {
            console.log(`📄 Начинаем со страницы: ${startFromPage}`);
            if (!lotUrls) {
                lotUrls = await this.getAllLotUrls(auctionUrl, testMode);
            }
            const foundIndex = await this.findLotIndexByPage(lotUrls, startFromPage);
            if (foundIndex >= 0) {
                startIndex = foundIndex;
            } else {
                console.log(`⚠️ Страница ${startFromPage} не найдена, начинаем с начала`);
                startIndex = 0;
            }
        } else if (startFromIndex !== null) {
            startIndex = startFromIndex;
            console.log(`📍 Начинаем с индекса: ${startIndex}`);
        }

        // Запускаем парсинг с определенной позиции
        await this.parseEntireAuction(auctionUrl, {
            ...options,
            startIndex,
            resumeFromProgress: false, // Не загружаем прогресс повторно
            savedLotUrls: lotUrls // Передаем сохраненные ссылки
        });
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

// Использование parser3
async function main(auctionNumber) {
    const dbConfig = {
        user: 'postgres.xkwgspqwebfeteoblayu',        
        host: 'aws-0-eu-north-1.pooler.supabase.com',
        database: 'postgres',   
        password: 'Gopapopa326+',    
        port: 6543,
        ssl: {
            rejectUnauthorized: false
        }
    };

    const parser = new WolmarAuctionParser(dbConfig, auctionNumber);
    
    try {
        await parser.init();
        
        // Парсинг всего аукциона
        const auctionUrl = `https://www.wolmar.ru/auction/${auctionNumber}`;
        await parser.parseEntireAuction(auctionUrl, {
            maxLots: null,           // Парсить все лоты
            skipExisting: true,      // Пропускать существующие лоты
            delayBetweenLots: 800,   // Уменьшенная задержка благодаря упрощению
            batchSize: 50,           
            testMode: false          // Полный режим
        });
        
    } catch (error) {
        console.error('Общая ошибка:', error.message);
        
        // Если ошибка связана с detached frame, выводим дополнительную информацию
        if (error.message.includes('detached') || error.message.includes('Frame')) {
            console.log('💡 Рекомендация: Попробуйте перезапустить парсер или уменьшить количество одновременно обрабатываемых лотов');
        }
    } finally {
        try {
            await parser.close();
        } catch (closeError) {
            console.error('Ошибка при закрытии парсера:', closeError.message);
        }
    }
}

// Функция для возобновления парсинга с сохраненного прогресса
async function resumeFromProgress(auctionNumber) {
    const dbConfig = {
        user: 'postgres.xkwgspqwebfeteoblayu',        
        host: 'aws-0-eu-north-1.pooler.supabase.com',
        database: 'postgres',   
        password: 'Gopapopa326+',    
        port: 6543,
        ssl: {
            rejectUnauthorized: false
        }
    };

    const parser = new WolmarAuctionParser(dbConfig, auctionNumber);
    
    try {
        await parser.init();
        
        // Возобновляем парсинг с сохраненного прогресса
        const auctionUrl = `https://www.wolmar.ru/auction/${auctionNumber}`;
        await parser.resumeParsing(auctionUrl, {
            resumeFromProgress: true,  // Возобновить с сохраненного прогресса
            skipExisting: true,        // Пропускать существующие лоты
            delayBetweenLots: 800,     
            batchSize: 50,             
            testMode: false            
        });
        
    } catch (error) {
        console.error('Ошибка возобновления:', error.message);
    } finally {
        try {
            await parser.close();
        } catch (closeError) {
            console.error('Ошибка при закрытии парсера:', closeError.message);
        }
    }
}

// Функция для запуска с определенного номера лота
async function startFromLotNumber(auctionNumber, lotNumber) {
    const dbConfig = {
        user: 'postgres.xkwgspqwebfeteoblayu',        
        host: 'aws-0-eu-north-1.pooler.supabase.com',
        database: 'postgres',   
        password: 'Gopapopa326+',    
        port: 6543,
        ssl: {
            rejectUnauthorized: false
        }
    };

    const parser = new WolmarAuctionParser(dbConfig, auctionNumber);
    
    try {
        await parser.init();
        
        // Начинаем парсинг с определенного номера лота
        const auctionUrl = `https://www.wolmar.ru/auction/${auctionNumber}`;
        await parser.resumeParsing(auctionUrl, {
            startFromLotNumber: lotNumber,  // Начать с определенного номера лота
            resumeFromProgress: false,      // Не возобновлять с сохраненной позиции
            useSavedUrls: true,             // Использовать сохраненные ссылки
            skipExisting: true,             // Пропускать существующие лоты
            delayBetweenLots: 800,          
            batchSize: 50,                  
            testMode: false                 
        });
        
    } catch (error) {
        console.error('Ошибка запуска с номера лота:', error.message);
    } finally {
        try {
            await parser.close();
        } catch (closeError) {
            console.error('Ошибка при закрытии парсера:', closeError.message);
        }
    }
}

// Функция для запуска с определенной страницы
async function startFromPage(auctionNumber, pageNumber) {
    const dbConfig = {
        user: 'postgres.xkwgspqwebfeteoblayu',        
        host: 'aws-0-eu-north-1.pooler.supabase.com',
        database: 'postgres',   
        password: 'Gopapopa326+',    
        port: 6543,
        ssl: {
            rejectUnauthorized: false
        }
    };

    const parser = new WolmarAuctionParser(dbConfig, auctionNumber);
    
    try {
        await parser.init();
        
        // Начинаем парсинг с определенной страницы
        const auctionUrl = `https://www.wolmar.ru/auction/${auctionNumber}`;
        await parser.resumeParsing(auctionUrl, {
            startFromPage: pageNumber,      // Начать с определенной страницы
            resumeFromProgress: false,      // Не возобновлять с сохраненной позиции
            useSavedUrls: true,             // Использовать сохраненные ссылки
            skipExisting: true,             // Пропускать существующие лоты
            delayBetweenLots: 800,          
            batchSize: 50,                  
            testMode: false                 
        });
        
    } catch (error) {
        console.error('Ошибка запуска со страницы:', error.message);
    } finally {
        try {
            await parser.close();
        } catch (closeError) {
            console.error('Ошибка при закрытии парсера:', closeError.message);
        }
    }
}

// Функция для запуска с определенного индекса
async function startFromIndex(auctionNumber, index) {
    const dbConfig = {
        user: 'postgres.xkwgspqwebfeteoblayu',        
        host: 'aws-0-eu-north-1.pooler.supabase.com',
        database: 'postgres',   
        password: 'Gopapopa326+',    
        port: 6543,
        ssl: {
            rejectUnauthorized: false
        }
    };

    const parser = new WolmarAuctionParser(dbConfig, auctionNumber);
    
    try {
        await parser.init();
        
        // Начинаем парсинг с определенного индекса
        const auctionUrl = `https://www.wolmar.ru/auction/${auctionNumber}`;
        await parser.resumeParsing(auctionUrl, {
            startFromIndex: index,          // Начать с определенного индекса
            resumeFromProgress: false,      // Не возобновлять с сохраненной позиции
            useSavedUrls: true,             // Использовать сохраненные ссылки
            skipExisting: true,             // Пропускать существующие лоты
            delayBetweenLots: 800,          
            batchSize: 50,                  
            testMode: false                 
        });
        
    } catch (error) {
        console.error('Ошибка запуска с индекса:', error.message);
    } finally {
        try {
            await parser.close();
        } catch (closeError) {
            console.error('Ошибка при закрытии парсера:', closeError.message);
        }
    }
}

// Быстрый тест на небольшом количестве лотов
async function testRun(auctionNumber) {
    const dbConfig = {
        user: 'postgres.xkwgspqwebfeteoblayu',        
        host: 'aws-0-eu-north-1.pooler.supabase.com',
        database: 'postgres',   
        password: 'Gopapopa326+',    
        port: 6543,
        ssl: {
            rejectUnauthorized: false
        }
    };

    const parser = new WolmarAuctionParser(dbConfig, auctionNumber);
    
    try {
        await parser.init();
        
        // Тестовый запуск на лотах только с первой страницы
        const auctionUrl = `https://www.wolmar.ru/auction/${auctionNumber}`;
        await parser.parseEntireAuction(auctionUrl, {
            maxLots: 5,             // Только 5 лотов для быстрого теста
            skipExisting: false,    // Не пропускать для теста
            delayBetweenLots: 1000, // Задержка для наблюдения
            batchSize: 3,           
            testMode: true          // ТЕСТОВЫЙ РЕЖИМ: только первая страница ссылок!
        });
        
    } catch (error) {
        console.error('Ошибка теста:', error.message);
        
        // Если ошибка связана с detached frame, выводим дополнительную информацию
        if (error.message.includes('detached') || error.message.includes('Frame')) {
            console.log('💡 Рекомендация: Попробуйте перезапустить парсер или уменьшить количество одновременно обрабатываемых лотов');
        }
    } finally {
        try {
            await parser.close();
        } catch (closeError) {
            console.error('Ошибка при закрытии парсера:', closeError.message);
        }
    }
}

module.exports = WolmarAuctionParser;

// Запуск
if (require.main === module) {
    (async () => {
        const args = process.argv.slice(2);
        
        if (args.length === 0) {
            console.log('🚀 Wolmar Auction Parser v3.0');
            console.log('Доступные команды:');
            console.log('  main <номер_аукциона>              - Полный парсинг аукциона');
            console.log('  test <номер_аукциона>              - Тестовый запуск (5 лотов)');
            console.log('  resume <номер_аукциона>            - Возобновить с сохраненного прогресса');
            console.log('  lot <номер_аукциона> <номер_лота>  - Начать с определенного номера лота');
            console.log('  page <номер_аукциона> <номер_страницы> - Начать с определенной страницы');
            console.log('  index <номер_аукциона> <номер_индекса> - Начать с определенного индекса');
            console.log('');
            console.log('Примеры:');
            console.log('  node wolmar-parser3.js main 2122');
            console.log('  node wolmar-parser3.js lot 2122 7512932');
            console.log('  node wolmar-parser3.js index 2122 1000');
            return;
        }

        const command = args[0];
        const auctionNumber = args[1];

        if (!auctionNumber) {
            console.error('❌ Ошибка: Не указан номер аукциона');
            return;
        }

        console.log(`🚀 Wolmar Auction Parser v3.0 - Аукцион ${auctionNumber}`);

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
                    
                case 'resume':
                    console.log(`📍 Возобновление парсинга аукциона ${auctionNumber}...`);
                    await resumeFromProgress(auctionNumber);
                    break;
                    
                case 'lot':
                    const lotNumber = args[2];
                    if (!lotNumber) {
                        console.error('❌ Ошибка: Не указан номер лота');
                        return;
                    }
                    console.log(`📍 Запуск с лота ${lotNumber} аукциона ${auctionNumber}...`);
                    await startFromLotNumber(auctionNumber, lotNumber);
                    break;
                    
                case 'page':
                    const pageNumber = args[2];
                    if (!pageNumber) {
                        console.error('❌ Ошибка: Не указан номер страницы');
                        return;
                    }
                    console.log(`📍 Запуск со страницы ${pageNumber} аукциона ${auctionNumber}...`);
                    await startFromPage(auctionNumber, pageNumber);
                    break;
                    
                case 'index':
                    const index = args[2];
                    if (!index) {
                        console.error('❌ Ошибка: Не указан индекс');
                        return;
                    }
                    console.log(`📍 Запуск с индекса ${index} аукциона ${auctionNumber}...`);
                    await startFromIndex(auctionNumber, index);
                    break;
                    
                default:
                    console.error(`❌ Неизвестная команда: ${command}`);
                    console.log('Используйте: main, test, resume, lot, page, index');
            }
        } catch (error) {
            console.error('❌ Критическая ошибка:', error.message);
            
            // Если ошибка связана с detached frame, выводим дополнительную информацию
            if (error.message.includes('detached') || error.message.includes('Frame')) {
                console.log('💡 Рекомендация: Попробуйте перезапустить парсер или уменьшить количество одновременно обрабатываемых лотов');
                console.log('💡 Также можно попробовать команду: resume');
            }
        }
    })();
}
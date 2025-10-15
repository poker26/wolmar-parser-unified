/**
 * Wolmar Category Parser
 * 
 * Парсер лотов по категориям Wolmar на основе wolmar-parser5.js
 * 
 * Основные возможности:
 * - Обнаружение всех категорий на Wolmar
 * - Парсинг лотов по категориям с автоматической классификацией
 * - Сохранение с указанием источника (категория vs аукцион)
 * - Обработка пагинации в категориях
 * 
 * Дата создания: 18.09.2025
 * Автор: AI Assistant
 */

const puppeteer = require('puppeteer-core');
const { Client } = require('pg');
const fs = require('fs');
const https = require('https');

// Импортируем базовый парсер
const WolmarAuctionParser = require('./wolmar-parser5');
const LotClassifier = require('./lot-classifier');
const path = require('path');

class WolmarCategoryParser {
    constructor(dbConfig, mode = 'categories', auctionNumber = null) {
        // Сохраняем конфигурацию
        this.dbConfig = dbConfig;
        this.mode = mode; // 'categories', 'auction', 'resume'
        this.targetAuctionNumber = auctionNumber;
        
        // Создаем экземпляр базового парсера
        const parserId = mode === 'auction' ? `category-parser-${auctionNumber}` : 'category-parser';
        this.baseParser = new WolmarAuctionParser(dbConfig, parserId);
        
        // Копируем ссылки на свойства базового парсера
        this.dbClient = this.baseParser.dbClient;
        this.browser = this.baseParser.browser;
        this.page = this.baseParser.page;
        this.processed = this.baseParser.processed;
        this.errors = this.baseParser.errors;
        this.skipped = this.baseParser.skipped;
        this.auctionNumber = this.baseParser.auctionNumber;
        this.categoryProgress = {}; // Инициализируем прогресс категорий
        
        // Поля для возобновления парсинга
        this.lastProcessedLot = null;
        this.lastProcessedCategory = null;
        this.lastProcessedCategoryIndex = 0;
        
        // Настройка логирования
        this.logFile = path.join(__dirname, 'logs', 'category-parser.log');
        this.ensureLogDirectory();
    }
    
    // Создание директории для логов
    ensureLogDirectory() {
        const logsDir = path.dirname(this.logFile);
        if (!fs.existsSync(logsDir)) {
            fs.mkdirSync(logsDir, { recursive: true });
        }
    }
    
    // Функция логирования
    writeLog(message) {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] ${message}\n`;
        
        // Записываем в файл
        fs.appendFileSync(this.logFile, logMessage);
        
        // Также выводим в консоль
        console.log(message);
    }
    
    // Копируем необходимые методы из базового класса
    get delay() { return this.baseParser.delay.bind(this.baseParser); }
    get ensurePageActive() { return this.baseParser.ensurePageActive.bind(this.baseParser); }
    get recreatePage() { return this.baseParser.recreatePage.bind(this.baseParser); }
    
    // Инициализация парсера
    async init() {
        try {
            this.writeLog('🚀 Начинаем инициализацию парсера категорий...');
            
            // Добавляем таймаут для инициализации
            const initPromise = this.baseParser.init();
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Таймаут инициализации (60 секунд)')), 60000)
            );
            
            await Promise.race([initPromise, timeoutPromise]);
            this.progressFile = this.baseParser.progressFile;
            
            // Обновляем ссылки на свойства базового парсера после инициализации
            this.dbClient = this.baseParser.dbClient;
            this.browser = this.baseParser.browser;
            this.page = this.baseParser.page;
            this.processed = this.baseParser.processed;
            this.errors = this.baseParser.errors;
            this.skipped = this.baseParser.skipped;
            this.auctionNumber = this.baseParser.auctionNumber;
            
            // Добавляем специфичные для категорий свойства
            this.categories = [];
            this.classifier = new LotClassifier();
            this.baseUrl = 'https://wolmar.ru';
            
            // Прогресс по категориям
            this.categoryProgress = {};
            
            this.writeLog('✅ Парсер категорий инициализирован успешно');
        } catch (error) {
            this.writeLog(`❌ КРИТИЧЕСКАЯ ОШИБКА инициализации парсера категорий: ${error.message}`);
            this.writeLog(`❌ Стек ошибки: ${error.stack}`);
            throw error;
        }
    }

    

    async ensurePageActive() {
        return await this.baseParser.ensurePageActive();
    }

    async recreatePage() {
        const result = await this.baseParser.recreatePage();
        
        // Обновляем ссылку на страницу после пересоздания
        this.page = this.baseParser.page;
        
        return result;
    }

    async delay(ms) {
        return await this.baseParser.delay(ms);
    }

    /**
     * Определяет реальный номер аукциона для поиска в БД
     * @param {string} wolmarId - внутренний Wolmar ID (например, 2070)
     * @returns {string} - реальный номер аукциона (например, 914)
     */
    async getRealAuctionNumber(wolmarId) {
        try {
            // Ищем в БД лоты с parsing_number = wolmarId и берем auction_number
            const query = 'SELECT DISTINCT auction_number FROM auction_lots WHERE parsing_number = $1 LIMIT 1';
            const result = await this.dbClient.query(query, [wolmarId]);
            
            if (result.rows.length > 0) {
                return result.rows[0].auction_number;
            }
            
            // Если не найдено, возвращаем wolmarId как есть (для новых аукционов)
            return wolmarId;
        } catch (error) {
            this.writeLog(`❌ Ошибка определения реального номера аукциона: ${error.message}`);
            return wolmarId; // Fallback
        }
    }

    async lotExists(auctionNumber, lotNumber) {
        // Для category parser нужно искать по реальному номеру аукциона, а не по внутреннему Wolmar ID
        // auctionNumber здесь - это внутренний Wolmar ID (например, 2070)
        // Но в БД лоты сохраняются с реальным номером аукциона (например, 914)
        
        try {
            const realAuctionNumber = await this.getRealAuctionNumber(auctionNumber);
            this.writeLog(`🔍 Ищем лот ${lotNumber} с auction_number = ${realAuctionNumber} (Wolmar ID: ${auctionNumber})`);
            
            const query = 'SELECT id FROM auction_lots WHERE auction_number = $1 AND lot_number = $2';
            const result = await this.dbClient.query(query, [realAuctionNumber, lotNumber]);
            const exists = result.rows.length > 0;
            
            this.writeLog(`📊 Лот ${lotNumber} ${exists ? 'найден' : 'не найден'} в БД`);
            return exists;
        } catch (error) {
            this.writeLog(`❌ Ошибка проверки существования лота: ${error.message}`);
            // Fallback к базовой логике
            return await this.baseParser.lotExists(auctionNumber, lotNumber);
        }
    }

    /**
     * Возвращает название категории как есть (без преобразований)
     */
    mapCategoryNameToCode(categoryName) {
        // Просто возвращаем название категории как есть
        return categoryName;
    }

    /**
     * Извлекает категорию из URL лота
     */
    extractCategoryFromUrl(url) {
        try {
            const urlObj = new URL(url);
            const categoryParam = urlObj.searchParams.get('category');
            
            if (categoryParam) {
                // Преобразуем slug категории в читаемое название
                return this.slugToCategoryName(categoryParam);
            }
            
            return null;
        } catch (error) {
            console.error('Ошибка извлечения категории из URL:', error);
            return null;
        }
    }

    /**
     * Преобразует slug категории в читаемое название
     */
    slugToCategoryName(slug) {
        const categoryMap = {
            'nagradnye-ordena-i-medali-inostrannye': 'Наградные ордена и медали иностранные',
            'nagradnye-ordena-i-medali-rossii': 'Наградные ордена и медали России',
            'monety-antika-srednevekove': 'Монеты антика, средневековье',
            'dopetrovskie-monety': 'Допетровские монеты',
            'monety-petra-i': 'Монеты Петра I',
            'monety-xviii-veka': 'Монеты XVIII века',
            'monety-xix-veka': 'Монеты XIX века',
            'monety-nikolaya-ii': 'Монеты Николая II',
            'monety-rsfsr-sssr-rossii': 'Монеты РСФСР, СССР, России',
            'monety-rossii-do-1917-zoloto': 'Монеты России до 1917 года (золото)',
            'monety-rossii-do-1917-serebro': 'Монеты России до 1917 года (серебро)',
            'monety-rossii-do-1917-med': 'Монеты России до 1917 года (медь)',
            'monety-inostrannye': 'Монеты иностранные',
            'bony': 'Боны',
            'bony-rossii': 'Боны России',
            'bony-inostrannye': 'Боны иностранные',
            'marki': 'Марки',
            'marka': 'Марка',
            'antikvariat': 'Антиквариат',
            'ikony': 'Иконы',
            'yuvelirnye-izdeliya-chasy': 'Ювелирные изделия, часы',
            'serebro': 'Серебро',
            'books': 'Книги',
            'kartiny-farfor-bronza-i-pr': 'Картины, фарфор, бронза и пр.',
            'nagrady-znaki-zhetony-kopii': 'Награды, знаки, жетоны, копии',
            'nagrady-znaki-zhetony': 'Награды, знаки, жетоны',
            'pamyatnye-medali': 'Памятные медали',
            'nastolnye-medali': 'Настольные медали',
            'zhetony-znaki-i-dr': 'Жетоны, знаки и др.',
            'zoloto-platina-i-dr-do-1945-goda': 'Золото, платина и др. до 1945 года',
            'zoloto-platina-i-dr-posle-1945-goda': 'Золото, платина и др. после 1945 года',
            'serebro-i-dr-do-1800-goda': 'Серебро и др. до 1800 года',
            'serebro-i-dr-s-1800-po-1945-god': 'Серебро и др. с 1800 по 1945 год',
            'serebro-i-dr-posle-1945-goda': 'Серебро и др. после 1945 года'
        };
        
        return categoryMap[slug] || slug; // Возвращаем маппинг или оригинальный slug
    }

    /**
     * Обновление категории существующего лота
     */
    async updateLotCategory(auctionNumber, lotNumber, category, sourceCategory) {
        try {
            const query = `
                UPDATE auction_lots 
                SET category = $1, source_category = $2, parsing_method = 'category_parser'
                WHERE auction_number = $3 AND lot_number = $4 
                AND (category IS NULL OR category = '')
            `;
            
            const result = await this.dbClient.query(query, [category, sourceCategory, auctionNumber, lotNumber]);
            
            // Возвращаем true если была обновлена хотя бы одна запись
            return result.rowCount > 0;
            
        } catch (error) {
            this.writeLog(`❌ ОШИБКА обновления категории лота: ${error.message}`);
            this.writeLog(`❌ Параметры: auction=${auctionNumber}, lot=${lotNumber}, category=${category}, source=${sourceCategory}`);
            this.writeLog(`❌ Стек ошибки: ${error.stack}`);
            
            // Если соединение прервано, пробуем переподключиться
            if (error.message.includes('Connection terminated') || error.message.includes('connection') || error.message.includes('not queryable')) {
                console.log('🔄 Переподключение к базе данных...');
                try {
                    await this.dbClient.end();
                    this.dbClient = new Client(this.dbConfig);
                    await this.dbClient.connect();
                    console.log('✅ Переподключение успешно');
                    
                    // Повторяем операцию
                    return await this.updateLotCategory(auctionNumber, lotNumber, category, sourceCategory);
                } catch (reconnectError) {
                    console.error('❌ Ошибка переподключения:', reconnectError.message);
                    return false;
                }
            }
            
            return false;
        }
    }

    /**
     * Поиск категорий на странице конкретного аукциона
     */
    async discoverCategoriesFromAuction(auctionUrl) {
        console.log(`🔍 Ищем категории на странице аукциона: ${auctionUrl}`);
        
        try {
            await this.ensurePageActive();
            await this.page.goto(auctionUrl, { waitUntil: 'networkidle2' });
            await this.delay(2000);
            
            const categories = await this.page.evaluate(() => {
                const categoryLinks = [];
                
                // Ищем ссылки на категории в блоке .categories
                const categoryBlocks = document.querySelectorAll('.categories');
                categoryBlocks.forEach(block => {
                    const links = block.querySelectorAll('a[href*="/auction/"]');
                    links.forEach(link => {
                        const href = link.getAttribute('href');
                        const text = link.textContent.trim();
                        
                        // Проверяем, что это ссылка на категорию (содержит /auction/ и не содержит ?category= или /lot/)
                        if (href && href.includes('/auction/') && 
                            !href.includes('?category=') && 
                            !href.includes('/lot/') &&
                            text && text.length > 0) {
                            
                            // Проверяем, что это не просто ссылка на страницу аукциона
                            const urlParts = href.split('/');
                            if (urlParts.length > 3) { // /auction/2077/category-name
                                categoryLinks.push({
                                    name: text,
                                    url: href.startsWith('http') ? href : `https://www.wolmar.ru${href}`
                                });
                            }
                        }
                    });
                });
                
                // Если не нашли в .categories, ищем по всему документу
                if (categoryLinks.length === 0) {
                    const allLinks = document.querySelectorAll('a[href*="/auction/"]');
                    allLinks.forEach(link => {
                        const href = link.getAttribute('href');
                        const text = link.textContent.trim();
                        
                        if (href && href.includes('/auction/') && 
                            !href.includes('?category=') && 
                            !href.includes('/lot/') &&
                            text && text.length > 0) {
                            
                            const urlParts = href.split('/');
                            if (urlParts.length > 3) { // /auction/2077/category-name
                                categoryLinks.push({
                                    name: text,
                                    url: href.startsWith('http') ? href : `https://www.wolmar.ru${href}`
                                });
                            }
                        }
                    });
                }
                
                return categoryLinks;
            });
            
            console.log(`✅ Найдено категорий: ${categories.length}`);
            return categories;
            
        } catch (error) {
            this.writeLog(`❌ ОШИБКА поиска категорий на странице аукциона: ${error.message}`);
            this.writeLog(`❌ URL аукциона: ${auctionUrl}`);
            this.writeLog(`❌ Стек ошибки: ${error.stack}`);
            return [];
        }
    }

    /**
     * Загрузка категорий из базы данных
     */
    async loadCategoriesFromDatabase() {
        try {
            this.writeLog('🔍 Загружаем категории из базы данных...');
            
            const query = 'SELECT name, url_slug, url_template FROM wolmar_categories ORDER BY name';
            const result = await this.dbClient.query(query);
            
            this.categories = result.rows.map(row => ({
                name: row.name,
                url_slug: row.url_slug,
                url_template: row.url_template,
                type: 'database_category'
            }));
            
            this.writeLog(`✅ Загружено ${this.categories.length} категорий из базы данных`);
            
            // Выводим загруженные категории для отладки
            if (this.categories.length > 0) {
                console.log('📋 Загруженные категории:');
                this.categories.forEach((cat, index) => {
                    console.log(`  ${index + 1}. ${cat.name} -> ${cat.url_slug}`);
                });
            } else {
                console.log('⚠️ Категории не найдены в базе данных. Запустите скрипт parse-and-save-categories.js');
            }
            
            return this.categories;
            
        } catch (error) {
            this.writeLog(`❌ ОШИБКА загрузки категорий из базы данных: ${error.message}`);
            this.writeLog(`❌ Стек ошибки БД: ${error.stack}`);
            throw error;
        }
    }

    /**
     * Обнаружение всех категорий на Wolmar (устаревший метод - теперь используем базу данных)
     */
    async discoverCategories() {
        console.log('⚠️ Метод discoverCategories() устарел. Используйте loadCategoriesFromDatabase()');
        return await this.loadCategoriesFromDatabase();
    }

    /**
     * Получение ссылок на лоты в категории
     */
    async getCategoryLotUrls(categoryUrl, testMode = false) {
        this.writeLog(`🔍 Собираем ссылки на лоты в категории: ${categoryUrl}`);
        const allUrls = new Set();
        
        try {
            await this.ensurePageActive();
            await this.page.goto(categoryUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await this.delay(2000);

            // Получаем информацию о пагинации
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

            console.log(`   📊 Найдено лотов: ${paginationInfo.totalLots || 'неизвестно'}`);
            console.log(`   📄 Страниц: ${paginationInfo.maxPage}`);

            const maxPages = testMode ? Math.min(3, paginationInfo.maxPage) : paginationInfo.maxPage;

            // Собираем ссылки со всех страниц
            for (let page = 1; page <= maxPages; page++) {
                try {
                    const pageUrl = page === 1 ? categoryUrl : `${categoryUrl}${categoryUrl.includes('?') ? '&' : '?'}page=${page}`;
                    
                    console.log(`   📄 Обрабатываем страницу ${page}/${maxPages}: ${pageUrl}`);
                    
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
                        await this.delay(3000);
                    }
                    
                    continue;
                }
            }

            const urls = Array.from(allUrls);
            console.log(`✅ Собрано ${urls.length} уникальных ссылок на лоты в категории`);
            
            return urls;

        } catch (error) {
            this.writeLog(`❌ ОШИБКА сбора ссылок в категории: ${error.message}`);
            this.writeLog(`❌ URL категории: ${categoryUrl}`);
            this.writeLog(`❌ Стек ошибки: ${error.stack}`);
            throw error;
        }
    }

    /**
     * Парсинг отдельного лота с добавлением категории
     */
    async parseLotPage(url, auctionEndDate = null, sourceCategory = null) {
        try {
            // Вызываем метод базового парсера
            const lotData = await this.baseParser.parseLotPage(url, auctionEndDate);
            
            // Добавляем информацию о категории
            lotData.sourceCategory = sourceCategory;
            lotData.parsingMethod = 'category_parser';
            
            // Преобразуем изображения из массива в отдельные поля (как в базовом парсере)
            if (lotData.images && lotData.images.length > 0) {
                lotData.aversImageUrl = lotData.images[0];
                lotData.reversImageUrl = lotData.images[1] || null;
            }
            
            // Извлекаем категорию из URL, если она есть
            const urlCategory = this.extractCategoryFromUrl(url);
            if (urlCategory) {
                lotData.category = urlCategory;
                lotData.categoryConfidence = 1.0; // Высокая уверенность для URL-категории
                console.log(`   🏷️ Категория из URL: ${urlCategory}`);
            } else if (sourceCategory) {
                // Используем переданную категорию
                lotData.category = this.mapCategoryNameToCode(sourceCategory);
                lotData.categoryConfidence = 0.9; // Высокая уверенность для категории парсера
            } else if (this.classifier && lotData.coinDescription) {
                // Применяем классификатор только если нет других источников категории
                const classification = this.classifier.classify({
                    coin_description: lotData.coinDescription,
                    letters: lotData.letters || '',
                    metal: lotData.metal || '',
                    lot_type: lotData.lotType || ''
                });
                
                lotData.category = classification.category;
                lotData.categoryConfidence = classification.confidence;
            }
            
            return lotData;
            
        } catch (error) {
            this.writeLog(`❌ ОШИБКА парсинга лота с категорией: ${error.message}`);
            this.writeLog(`❌ URL лота: ${url}`);
            this.writeLog(`❌ Стек ошибки: ${error.stack}`);
            throw error;
        }
    }

    /**
     * Сохранение лота в базу данных с дополнительными полями
     */
    async saveLotToDatabase(lotData) {
        try {
            // Определяем реальный номер аукциона для сохранения
            const realAuctionNumber = await this.getRealAuctionNumber(lotData.auctionNumber);
            this.writeLog(`💾 Сохраняем лот ${lotData.lotNumber} с auction_number = ${realAuctionNumber} (Wolmar ID: ${lotData.auctionNumber})`);
            
            const insertQuery = `
                INSERT INTO auction_lots (
                    lot_number, auction_number, coin_description, avers_image_url, avers_image_path,
                    revers_image_url, revers_image_path, winner_login, winning_bid, auction_end_date,
                    currency, source_url, bids_count, lot_status, year, metal, weight, condition,
                    letters, lot_type, category, source_category, parsing_method, parsing_number
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24
                ) RETURNING id
            `;

            const values = [
                lotData.lotNumber,
                realAuctionNumber, // Используем реальный номер аукциона вместо внутреннего Wolmar ID
                lotData.coinDescription,
                lotData.aversImageUrl || null,
                null, // aversImagePath - не используется
                lotData.reversImageUrl || null,
                null, // reversImagePath - не используется
                lotData.winnerLogin,
                lotData.winningBid,
                lotData.auctionEndDate,
                lotData.currency || 'RUB',
                lotData.sourceUrl,
                lotData.bidsCount,
                lotData.lotStatus,
                lotData.year,
                lotData.metal,
                lotData.weight,
                lotData.condition,
                lotData.letters,
                lotData.lotType,
                lotData.category,
                lotData.sourceCategory,
                lotData.parsingMethod,
                this.targetAuctionNumber // parsing_number - внутренний Wolmar ID
            ];

            const result = await this.dbClient.query(insertQuery, values);
            return result.rows[0].id;

        } catch (error) {
            this.writeLog(`❌ ОШИБКА сохранения лота в БД: ${error.message}`);
            this.writeLog(`❌ Данные лота: ${JSON.stringify(lotData, null, 2)}`);
            this.writeLog(`❌ Стек ошибки БД: ${error.stack}`);
            
            // Если соединение прервано, пробуем переподключиться
            if (error.message.includes('Connection terminated') || error.message.includes('connection') || error.message.includes('not queryable')) {
                console.log('🔄 Переподключение к базе данных...');
                try {
                    await this.dbClient.end();
                    this.dbClient = new Client(this.dbConfig);
                    await this.dbClient.connect();
                    console.log('✅ Переподключение успешно');
                    
                    // Повторяем операцию
                    return await this.saveLotToDatabase(lotData);
                } catch (reconnectError) {
                    console.error('❌ Ошибка переподключения:', reconnectError.message);
                    return null;
                }
            }
            
            return null;
        }
    }

    /**
     * Парсинг лотов в конкретной категории
     */
    async parseCategoryLots(categoryUrl, categoryName, options = {}) {
        const {
            maxLots = null,
            skipExisting = true,
            delayBetweenLots = 800,
            testMode = false,
            startFromLot = 1
        } = options;

        this.writeLog(`\n🎯 Начинаем парсинг категории: ${categoryName}`);
        this.writeLog(`   URL: ${categoryUrl}`);
        this.writeLog(`   Настройки: maxLots=${maxLots}, skipExisting=${skipExisting}, delay=${delayBetweenLots}ms, testMode=${testMode}`);

        try {
            // Получаем ссылки на лоты в категории
            this.writeLog(`🔍 Получаем список лотов для категории ${categoryName}...`);
            const lotUrls = await this.getCategoryLotUrls(categoryUrl, testMode);
            
            if (lotUrls.length === 0) {
                this.writeLog(`⚠️ ВНИМАНИЕ: В категории ${categoryName} не найдено лотов`);
                return;
            }
            
            this.writeLog(`📋 Найдено лотов в категории ${categoryName}: ${lotUrls.length}`);
            
            // Инициализируем прогресс категории
            if (!this.categoryProgress[categoryName]) {
                this.categoryProgress[categoryName] = { processed: 0, total: lotUrls.length };
            } else {
                this.categoryProgress[categoryName].total = lotUrls.length;
            }

            // Применяем startFromLot для пропуска начальных лотов
            let startIndex = 0;
            
            // Если startFromLot больше 1, ищем позицию этого лота в категории
            if (startFromLot > 1) {
                // Ищем лот с номером startFromLot в списке лотов категории
                const lotIndex = lotUrls.findIndex(url => {
                    const lotMatch = url.match(/\/auction\/\d+\/(\d+)/);
                    return lotMatch && parseInt(lotMatch[1]) === startFromLot;
                });
                
                if (lotIndex !== -1) {
                    startIndex = lotIndex;
                    this.writeLog(`🔍 Найден лот ${startFromLot} в позиции ${lotIndex + 1} из ${lotUrls.length} в категории ${categoryName}`);
                } else {
                    this.writeLog(`⚠️ Лот ${startFromLot} не найден в категории ${categoryName}. Начинаем с начала категории.`);
                    startIndex = 0;
                }
            }
            
            const availableLots = lotUrls.length - startIndex;
            const totalLots = maxLots ? Math.min(maxLots, availableLots) : availableLots;
            
            this.writeLog(`📊 Будет обработано лотов: ${totalLots} (начиная с лота ${startFromLot})`);

            let categoryProcessed = 0;
            let categorySkipped = 0;
            let categoryErrors = 0;

            // Обрабатываем лоты начиная с указанного индекса
            for (let i = 0; i < totalLots; i++) {
                const actualIndex = startIndex + i;
                const url = lotUrls[actualIndex];
                const progress = `${i + 1}/${totalLots}`;
                
                try {
                    this.writeLog(`\n[${progress}] ПАРСИНГ ЛОТА: ${url}`);
                    
                    // Парсим лот с указанием категории
                    const lotData = await this.parseLotPage(url, null, categoryName);
                    
                    if (!lotData) {
                        this.writeLog(`⚠️ Лот не был распарсен: ${url}`);
                        categorySkipped++;
                        continue;
                    }
                    
                    // Присваиваем категорию из URL (не полагаемся на классификатор)
                    lotData.category = this.mapCategoryNameToCode(categoryName);
                    
                    // Проверка на существование лота
                    if (skipExisting && lotData.auctionNumber && lotData.lotNumber) {
                        const exists = await this.lotExists(lotData.auctionNumber, lotData.lotNumber);
                        if (exists) {
                            // Обновляем категорию существующего лота, если она пустая
                            const updated = await this.updateLotCategory(lotData.auctionNumber, lotData.lotNumber, lotData.category, categoryName);
                            if (updated) {
                                this.writeLog(`   🔄 Лот ${lotData.lotNumber} обновлен: категория "${lotData.category}" из источника "${categoryName}"`);
                                categoryProcessed++;
                                this.processed++;
                                // Обновляем прогресс категории
                                if (!this.categoryProgress[categoryName]) {
                                    this.categoryProgress[categoryName] = { processed: 0, total: 0 };
                                }
                                this.categoryProgress[categoryName].processed++;
                                this.saveProgress(); // Сохраняем прогресс
                            } else {
                                this.writeLog(`   ⏭️ Лот ${lotData.lotNumber} уже существует с категорией, пропускаем`);
                                categorySkipped++;
                                this.skipped++;
                                this.saveProgress(); // Сохраняем прогресс
                            }
                            continue;
                        }
                    }

                    // Сохранение в БД
                    this.writeLog(`   💾 Сохраняем лот в БД...`);
                    const savedId = await this.saveLotToDatabase(lotData);
                    if (savedId) {
                        categoryProcessed++;
                        this.processed++;
                        // Обновляем прогресс категории
                        if (!this.categoryProgress[categoryName]) {
                            this.categoryProgress[categoryName] = { processed: 0, total: 0 };
                        }
                        this.categoryProgress[categoryName].processed++;
                        
                        // Сохраняем информацию о последнем обработанном лоте
                        // Сохраняем порядковый номер в категории, а не глобальный номер лота
                        this.lastProcessedLot = actualIndex + 1; // +1 потому что actualIndex начинается с 0
                        this.lastProcessedCategory = categoryName;
                        this.lastProcessedCategoryIndex = actualIndex;
                        
                        this.saveProgress(); // Сохраняем прогресс
                        
                        // Вывод информации о лоте
                        this.writeLog(`   ✅ Лот ${lotData.lotNumber} СОХРАНЕН: ${lotData.coinDescription?.substring(0, 50)}...`);
                        this.writeLog(`   💰 ${lotData.winningBid} руб. | 👤 ${lotData.winnerLogin} | 🏷️ ${lotData.category || 'не определена'}`);
                    } else {
                        this.writeLog(`   ❌ ОШИБКА: Лот ${lotData.lotNumber} не был сохранен в БД`);
                        categoryErrors++;
                        this.errors++;
                    }

                    // Задержка между лотами
                    await this.delay(delayBetweenLots);

                } catch (error) {
                    this.writeLog(`❌ ОШИБКА обработки лота [${progress}]: ${error.message}`);
                    this.writeLog(`❌ Стек ошибки лота: ${error.stack}`);
                    categoryErrors++;
                    this.errors++;
                    
                    // Если ошибка связана с detached frame, пересоздаем страницу
                    if (error.message.includes('detached') || error.message.includes('Frame')) {
                        this.writeLog(`🔄 Обнаружена ошибка detached frame, пересоздаем страницу...`);
                        await this.recreatePage();
                        await this.delay(3000);
                    }
                }
            }

            this.writeLog(`\n📊 Статистика по категории "${categoryName}":`);
            this.writeLog(`   ✅ Обработано: ${categoryProcessed}`);
            this.writeLog(`   ⏭️ Пропущено: ${categorySkipped}`);
            this.writeLog(`   ❌ Ошибок: ${categoryErrors}`);

        } catch (error) {
            this.writeLog(`❌ КРИТИЧЕСКАЯ ОШИБКА парсинга категории ${categoryName}: ${error.message}`);
            this.writeLog(`❌ Стек ошибки категории: ${error.stack}`);
            throw error;
        }
    }

    /**
     * Парсинг конкретного аукциона (как в wolmar-parser5)
     */
    async parseSpecificAuction(auctionNumber, startFromLot = 1, options = {}) {
        const {
            maxLots = null,
            skipExisting = true,
            delayBetweenLots = 800,
            testMode = false,
            resumeFromLastLot = false
        } = options;

        this.writeLog(`🎯 НАЧИНАЕМ ПАРСИНГ АУКЦИОНА: ${auctionNumber}`);
        this.writeLog(`   Стартовый лот: ${startFromLot}`);
        this.writeLog(`   Возобновление с последнего лота: ${resumeFromLastLot}`);
        this.writeLog(`   Настройки: maxLots=${maxLots}, skipExisting=${skipExisting}, delay=${delayBetweenLots}ms, testMode=${testMode}`);

        try {
            // Убеждаемся, что парсер инициализирован
            if (!this.page) {
                this.writeLog('🚀 Инициализируем парсер...');
                await this.init();
            }
            
            // Загружаем прогресс, если нужно возобновление
            if (resumeFromLastLot) {
                this.writeLog('📂 Загружаем сохраненный прогресс...');
                const savedProgress = this.loadProgress();
                if (savedProgress && savedProgress.lastProcessedLot && startFromLot === 1) {
                    // Используем сохраненный прогресс только если startFromLot не указан вручную
                    this.writeLog(`🔄 Найден сохраненный прогресс: последний лот ${savedProgress.lastProcessedLot} в категории ${savedProgress.lastProcessedCategory}`);
                    startFromLot = savedProgress.lastProcessedLot;
                } else if (savedProgress && savedProgress.lastProcessedLot) {
                    this.writeLog(`📊 Сохраненный прогресс: последний лот ${savedProgress.lastProcessedLot} в категории ${savedProgress.lastProcessedCategory}, но используем указанный вручную: ${startFromLot}`);
                } else {
                    this.writeLog('⚠️ Сохраненный прогресс не найден, начинаем с указанного лота');
                }
            }
            
            // Загружаем категории из базы данных
            this.writeLog('📂 Загружаем категории из базы данных...');
            const dbCategories = await this.loadCategoriesFromDatabase();
            
            if (dbCategories.length === 0) {
                this.writeLog(`⚠️ ВНИМАНИЕ: Категории не найдены в базе данных. Запустите скрипт parse-and-save-categories.js`);
                return;
            }
            
            // Формируем URL категорий для конкретного аукциона
            const categories = dbCategories.map(cat => ({
                name: cat.name,
                url: cat.url_template.replace('{AUCTION_NUMBER}', this.targetAuctionNumber)
            }));
            
            this.writeLog(`📋 Используем ${categories.length} категорий из БД для аукциона ${auctionNumber}`);
            categories.forEach(cat => this.writeLog(`   - ${cat.name}: ${cat.url}`));
            
            // Проверяем, есть ли категории для парсинга
            if (categories.length === 0) {
                this.writeLog(`⚠️ ВНИМАНИЕ: Нет категорий для парсинга аукциона ${auctionNumber}`);
                return {
                    success: true,
                    processed: 0,
                    errors: 0,
                    skipped: 0,
                    categories: 0,
                    message: 'Нет категорий для парсинга'
                };
            }
            
            this.writeLog(`🚀 НАЧИНАЕМ ПАРСИНГ ${categories.length} КАТЕГОРИЙ...`);
            
            // Если возобновляем с последнего лота, находим нужную категорию
            let startCategoryIndex = 0;
            if (resumeFromLastLot && this.lastProcessedCategory) {
                startCategoryIndex = categories.findIndex(cat => cat.name === this.lastProcessedCategory);
                if (startCategoryIndex === -1) {
                    this.writeLog(`⚠️ Категория ${this.lastProcessedCategory} не найдена, начинаем с первой`);
                    startCategoryIndex = 0;
                } else {
                    this.writeLog(`🔄 Возобновляем с категории ${this.lastProcessedCategory} (индекс ${startCategoryIndex})`);
                }
            }
            
            // Парсим категории начиная с нужной
            for (let i = startCategoryIndex; i < categories.length; i++) {
                const category = categories[i];
                try {
                    this.writeLog(`🔄 Начинаем парсинг категории: ${category.name}`);
                    
                    // Для первой категории при возобновлении используем startFromLot
                    const categoryStartFromLot = (i === startCategoryIndex && resumeFromLastLot) ? startFromLot : 1;
                    
                    await this.parseCategoryLots(category.url, category.name, {
                        maxLots,
                        skipExisting,
                        delayBetweenLots,
                        testMode,
                        startFromLot: categoryStartFromLot
                    });
                    this.writeLog(`✅ Категория ${category.name} обработана успешно`);
                } catch (categoryError) {
                    this.writeLog(`❌ ОШИБКА при парсинге категории ${category.name}: ${categoryError.message}`);
                    this.writeLog(`❌ Стек ошибки категории: ${categoryError.stack}`);
                    // Продолжаем с следующей категорией
                }
            }

            this.writeLog(`🎉 ПАРСИНГ АУКЦИОНА ${auctionNumber} ЗАВЕРШЕН!`);
            this.writeLog(`📊 ИТОГОВАЯ СТАТИСТИКА:`);
            this.writeLog(`   ✅ Обработано лотов: ${this.processed}`);
            this.writeLog(`   ❌ Ошибок: ${this.errors}`);
            this.writeLog(`   ⏭️ Пропущено: ${this.skipped}`);

            return {
                success: true,
                processed: this.processed,
                errors: this.errors,
                skipped: this.skipped,
                categories: Object.keys(this.categoryProgress).length
            };

        } catch (error) {
            this.writeLog(`❌ КРИТИЧЕСКАЯ ОШИБКА парсинга аукциона ${auctionNumber}: ${error.message}`);
            this.writeLog(`❌ Стек ошибки: ${error.stack}`);
            console.error(`❌ Ошибка парсинга аукциона ${auctionNumber}:`, error.message);
            throw error;
        }
    }

    /**
     * Возобновление парсинга с определенной позиции
     */
    async resumeParsing(resumeOptions = {}) {
        const {
            category = null,
            auctionNumber = null,
            startFromLot = 1,
            skipExisting = true,
            delayBetweenLots = 800
        } = resumeOptions;

        this.writeLog(`🔄 ВОЗОБНОВЛЕНИЕ ПАРСИНГА...`);
        this.writeLog(`   Категория: ${category || 'не указана'}`);
        this.writeLog(`   Аукцион: ${auctionNumber || 'не указан'}`);
        this.writeLog(`   Стартовый лот: ${startFromLot}`);

        try {
            this.writeLog(`🔄 ВОЗОБНОВЛЯЕМ ПАРСИНГ с параметрами: auction=${auctionNumber}, category=${category}, startFromLot=${startFromLot}`);
            
            if (auctionNumber) {
                // Для аукциона используем parseSpecificAuction с возобновлением
                this.writeLog(`🎯 Возобновляем парсинг аукциона ${auctionNumber} с лота ${startFromLot}`);
                return await this.parseSpecificAuction(auctionNumber, startFromLot, {
                    skipExisting,
                    delayBetweenLots,
                    testMode: false,
                    resumeFromLastLot: true
                });
            } else if (category) {
                // Возобновляем парсинг конкретной категории
                this.writeLog(`🔍 Ищем категорию "${category}" в списке доступных категорий...`);
                const categoryData = this.categories.find(cat => cat.name === category);
                if (!categoryData) {
                    this.writeLog(`❌ КАТЕГОРИЯ "${category}" НЕ НАЙДЕНА в списке доступных категорий`);
                    throw new Error(`Категория "${category}" не найдена`);
                }
                
                this.writeLog(`✅ Найдена категория "${category}": ${categoryData.url}`);
                return await this.parseCategoryLots(categoryData.url, category, {
                    skipExisting,
                    delayBetweenLots,
                    startFromLot
                });
            } else {
                throw new Error('Необходимо указать либо категорию, либо номер аукциона для возобновления');
            }

        } catch (error) {
            this.writeLog(`❌ ОШИБКА возобновления парсинга: ${error.message}`);
            this.writeLog(`❌ Стек ошибки: ${error.stack}`);
            throw error;
        }
    }

    /**
     * Сохранение прогресса парсинга
     */
    saveProgress() {
        try {
            const progress = {
                timestamp: new Date().toISOString(),
                mode: this.mode,
                targetAuctionNumber: this.targetAuctionNumber,
                processed: this.processed,
                errors: this.errors,
                skipped: this.skipped,
                categoryProgress: this.categoryProgress || {},
                // Новые поля для возобновления
                lastProcessedLot: this.lastProcessedLot || null,
                lastProcessedCategory: this.lastProcessedCategory || null,
                lastProcessedCategoryIndex: this.lastProcessedCategoryIndex || 0
            };
            
            const fs = require('fs');
            fs.writeFileSync(this.progressFile, JSON.stringify(progress, null, 2));
            console.log(`💾 Прогресс Category Parser сохранен: обработано ${this.processed}, ошибок ${this.errors}, пропущено ${this.skipped}`);
        } catch (error) {
            this.writeLog(`❌ ОШИБКА сохранения прогресса Category Parser: ${error.message}`);
            this.writeLog(`❌ Файл прогресса: ${this.progressFile}`);
            this.writeLog(`❌ Стек ошибки: ${error.stack}`);
        }
    }

    /**
     * Загрузка прогресса парсинга
     */
    loadProgress() {
        try {
            console.log('🔍 loadProgress: проверяем файл:', this.progressFile);
            const fs = require('fs');
            if (fs.existsSync(this.progressFile)) {
                console.log('🔍 loadProgress: файл существует');
                const progressData = fs.readFileSync(this.progressFile, 'utf8');
                const progress = JSON.parse(progressData);
                console.log(`📂 Найден сохраненный прогресс Category Parser: обработано ${progress.processed}, ошибок ${progress.errors}, пропущено ${progress.skipped}`);
                console.log('🔍 loadProgress: categoryProgress:', progress.categoryProgress);
                
                this.processed = progress.processed || 0;
                this.errors = progress.errors || 0;
                this.skipped = progress.skipped || 0;
                this.categoryProgress = progress.categoryProgress || {};
                // Загружаем новые поля для возобновления
                this.lastProcessedLot = progress.lastProcessedLot || null;
                this.lastProcessedCategory = progress.lastProcessedCategory || null;
                this.lastProcessedCategoryIndex = progress.lastProcessedCategoryIndex || 0;
                
                return progress;
            } else {
                console.log('🔍 loadProgress: файл не существует');
            }
        } catch (error) {
            this.writeLog(`❌ ОШИБКА загрузки прогресса Category Parser: ${error.message}`);
            this.writeLog(`❌ Файл прогресса: ${this.progressFile}`);
            this.writeLog(`❌ Стек ошибки: ${error.stack}`);
        }
        return null;
    }

    /**
     * Получение статуса и прогресса парсинга
     */
    async getParsingStatus() {
        try {
            console.log('🔍 getParsingStatus: начинаем...');
            
            // Читаем прогресс из файла базового парсера (элегантное решение)
            const fs = require('fs');
            const baseProgressFile = this.baseParser.progressFile;
            
            let processed = 0, errors = 0, skipped = 0;
            
            if (fs.existsSync(baseProgressFile)) {
                console.log('🔍 getParsingStatus: читаем файл базового парсера:', baseProgressFile);
                const baseProgress = JSON.parse(fs.readFileSync(baseProgressFile, 'utf8'));
                processed = baseProgress.processed || 0;
                errors = baseProgress.errors || 0;
                skipped = baseProgress.skipped || 0;
                console.log(`📊 Прогресс из файла: processed=${processed}, errors=${errors}, skipped=${skipped}`);
            } else {
                console.log('🔍 getParsingStatus: файл базового парсера не найден');
            }
            
            // Формируем статистику категорий из сохраненного прогресса
            let categories = [];
            if (this.categoryProgress && Object.keys(this.categoryProgress).length > 0) {
                console.log('🔍 getParsingStatus: категории найдены:', Object.keys(this.categoryProgress));
                categories = Object.keys(this.categoryProgress).map(categoryName => {
                    const progress = this.categoryProgress[categoryName];
                    return {
                        category: categoryName,
                        count: progress.total || 0,
                        with_source: progress.processed || 0
                    };
                });
            } else {
                console.log('🔍 getParsingStatus: категории не найдены');
            }
            
            return {
                total: { total_lots: 0, lots_with_categories: 0, lots_with_source_category: 0 },
                categories: categories,
                recent: [],
                parser: {
                    mode: this.mode,
                    targetAuctionNumber: this.targetAuctionNumber,
                    processed: processed,
                    errors: errors,
                    skipped: skipped
                }
            };

        } catch (error) {
            this.writeLog(`❌ ОШИБКА получения статуса парсинга: ${error.message}`);
            this.writeLog(`❌ Стек ошибки: ${error.stack}`);
            return null;
        }
    }

    /**
     * Основной метод парсинга всех категорий
     */
    async parseAllCategories(options = {}) {
        const {
            maxCategories = null,
            maxLotsPerCategory = null,
            skipExisting = true,
            delayBetweenLots = 800,
            testMode = false
        } = options;

        this.writeLog('🚀 НАЧИНАЕМ ПАРСИНГ ВСЕХ КАТЕГОРИЙ WOLMAR...');
        this.writeLog(`Настройки: maxCategories=${maxCategories}, maxLotsPerCategory=${maxLotsPerCategory}, testMode=${testMode}`);

        try {
            // Инициализация
            await this.init();

            // Загрузка категорий из базы данных
            this.writeLog('📂 Загружаем категории из базы данных...');
            const categories = await this.loadCategoriesFromDatabase();
            
            if (categories.length === 0) {
                this.writeLog('⚠️ ВНИМАНИЕ: Категории не найдены в базе данных');
                return;
            }

            const totalCategories = maxCategories ? Math.min(maxCategories, categories.length) : categories.length;
            this.writeLog(`📊 Будет обработано категорий: ${totalCategories}`);

            // Парсинг каждой категории
            for (let i = 0; i < totalCategories; i++) {
                const category = categories[i];
                const progress = `${i + 1}/${totalCategories}`;
                this.writeLog(`\n🔄 [${progress}] Обрабатываем категорию: ${category.name}`);
                
                console.log(`\n🎯 [${progress}] Обрабатываем категорию: ${category.name}`);
                
                try {
                    // Генерируем URL категории для текущего аукциона
                    const categoryUrl = category.url_template.replace('{AUCTION_NUMBER}', this.targetAuctionNumber);
                    
                    await this.parseCategoryLots(categoryUrl, category.name, {
                        maxLots: maxLotsPerCategory,
                        skipExisting,
                        delayBetweenLots,
                        testMode
                    });
                    
                    // Задержка между категориями
                    await this.delay(2000);
                    
                } catch (error) {
                    this.writeLog(`❌ ОШИБКА обработки категории ${category.name}: ${error.message}`);
                    this.writeLog(`❌ Стек ошибки категории: ${error.stack}`);
                    this.errors++;
                    continue;
                }
            }

            // Финальная статистика
            this.writeLog(`🎉 ПАРСИНГ ВСЕХ КАТЕГОРИЙ ЗАВЕРШЕН!`);
            this.writeLog(`📊 ОБЩАЯ СТАТИСТИКА:`);
            this.writeLog(`   ✅ Обработано лотов: ${this.processed}`);
            this.writeLog(`   ❌ Ошибок: ${this.errors}`);
            this.writeLog(`   ⏭️ Пропущено: ${this.skipped}`);

        } catch (error) {
            this.writeLog(`❌ КРИТИЧЕСКАЯ ОШИБКА парсинга категорий: ${error.message}`);
            this.writeLog(`❌ Стек ошибки: ${error.stack}`);
            throw error;
        } finally {
            // Закрываем соединения
            if (this.browser) {
                await this.browser.close();
            }
            if (this.dbClient) {
                await this.dbClient.end();
            }
        }
    }
}

// Экспорт для использования в других модулях
module.exports = WolmarCategoryParser;

// Запуск если файл вызван напрямую
if (require.main === module) {
    async function main() {
        const config = require('./config');
        const args = process.argv.slice(2);
        
        if (args.length === 0) {
            console.log('🚀 Wolmar Category Parser');
            console.log('Доступные команды:');
            console.log('  auction <номер_аукциона> [--include-bids]     - Парсинг аукциона по категориям');
            console.log('  resume <номер_аукциона> [--from-lot <номер>] [--include-bids] - Возобновление парсинга');
            console.log('');
            console.log('Примеры:');
            console.log('  node wolmar-category-parser.js auction 2009');
            console.log('  node wolmar-category-parser.js auction 2009 --include-bids');
            console.log('  node wolmar-category-parser.js resume 2009');
            console.log('  node wolmar-category-parser.js resume 2009 --from-lot 6891172 --include-bids');
            return;
        }
        
        const command = args[0];
        const auctionNumber = args[1];
        
        if (!auctionNumber) {
            console.error('❌ Ошибка: Не указан номер аукциона');
            process.exit(1);
        }
        
        // Парсим дополнительные параметры
        const includeBids = args.includes('--include-bids');
        const fromLotIndex = args.indexOf('--from-lot');
        const startFromLot = fromLotIndex !== -1 && args[fromLotIndex + 1] ? parseInt(args[fromLotIndex + 1]) : null;
        
        console.log(`🚀 Wolmar Category Parser - Аукцион ${auctionNumber}`);
        console.log(`📋 Команда: ${command}`);
        console.log(`💰 Парсить ставки: ${includeBids ? 'Да' : 'Нет'}`);
        if (startFromLot) {
            console.log(`🔄 Начать с лота: ${startFromLot}`);
        }
        
        const parser = new WolmarCategoryParser(config.dbConfig, command, auctionNumber);
        
        try {
            await parser.init();
            
            if (command === 'auction') {
                console.log(`📍 Запуск парсинга аукциона ${auctionNumber} по категориям...`);
                await parser.parseSpecificAuction(auctionNumber, 1, {
                    skipExisting: true,
                    delayBetweenLots: 800,
                    includeBids: includeBids
                });
            } else if (command === 'resume') {
                console.log(`📍 Возобновление парсинга аукциона ${auctionNumber}...`);
                await parser.parseSpecificAuction(auctionNumber, startFromLot || 1, {
                    skipExisting: true,
                    delayBetweenLots: 800,
                    includeBids: includeBids,
                    resumeFromLastLot: true  // Всегда пытаемся загрузить из файла прогресса
                });
            } else {
                throw new Error(`Неподдерживаемая команда: ${command}`);
            }
            
            console.log('✅ Парсинг завершен успешно');
            process.exit(0);
            
        } catch (error) {
            console.error('❌ Парсинг завершен с ошибкой:', error.message);
            console.error('❌ Стек ошибки:', error.stack);
            process.exit(1);
        }
    }
    
    main().catch(error => {
        console.error('❌ Критическая ошибка:', error.message);
        process.exit(1);
    });
}

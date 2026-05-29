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
const { cleanupChromeTempFiles } = require('./puppeteer-utils');

class WolmarCategoryParser {
    constructor(dbConfig, mode = 'categories', auctionNumber = null) {
        // Сохраняем конфигурацию
        this.dbConfig = dbConfig;
        this.mode = mode; // 'categories', 'auction', 'resume'
        this.targetAuctionNumber = auctionNumber;
        
        // Создаем экземпляр базового парсера
        const parserId = `category-parser-${auctionNumber}`;
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
     * Парсинг истории ставок для лота
     */
    async parseBidHistory(page, lotUrl = null) {
        try {
            this.writeLog(`💰 Парсим историю ставок через AJAX...`);
            
            // Используем переданный URL лота или текущий URL страницы
            const url = lotUrl || page.url();
            const urlMatch = url.match(/\/auction\/(\d+)\/(\d+)/);
            if (!urlMatch) {
                this.writeLog(`❌ Не удалось извлечь auction_id и lot_id из URL: ${url}`);
                return [];
            }
            
            const auctionId = urlMatch[1];
            const lotId = urlMatch[2];
            this.writeLog(`🔍 Извлечены параметры: auction_id=${auctionId}, lot_id=${lotId}`);
            
            // Формируем AJAX URL
            const ajaxUrl = `https://www.wolmar.ru/ajax/bids.php?auction_id=${auctionId}&lot_id=${lotId}`;
            this.writeLog(`🌐 AJAX URL: ${ajaxUrl}`);
            
            // Делаем запрос к AJAX endpoint
            const response = await page.goto(ajaxUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
            if (!response || !response.ok()) {
                this.writeLog(`❌ Ошибка AJAX запроса: ${response?.status()}`);
                return [];
            }
            
            // Парсим HTML таблицы ставок
            const bidHistory = await page.evaluate(() => {
                const bids = [];
                
                // Ищем таблицу ставок
                const table = document.querySelector('table.colored');
                if (!table) {
                    console.log('Таблица ставок не найдена');
                    return bids;
                }
                
                const rows = table.querySelectorAll('tr');
                console.log(`Найдено строк в таблице: ${rows.length}`);
                
                // Пропускаем заголовок (первая строка)
                for (let i = 1; i < rows.length; i++) {
                    const row = rows[i];
                    const cells = row.querySelectorAll('td');
                    
                    if (cells.length >= 4) {
                        // Структура: Сумма, *, Логин, Дата/Время, (пустая)
                        const amountText = cells[0]?.textContent?.trim();
                        const starText = cells[1]?.textContent?.trim();
                        const bidderText = cells[2]?.textContent?.trim();
                        const timestampText = cells[3]?.textContent?.trim();
                        
                        console.log(`Строка ${i}: "${amountText}" | "${starText}" | "${bidderText}" | "${timestampText}"`);
                        
                        if (amountText && bidderText && timestampText) {
                            // Извлекаем сумму (убираем пробелы и конвертируем в число)
                            const amount = parseInt(amountText.replace(/\s/g, ''));
                            
                            // Определяем автобид по наличию звездочки в колонке 1
                            const isAutoBid = starText === '*';
                            
                            bids.push({
                                amount: amount,
                                bidder: bidderText,
                                timestamp: timestampText, // Форматируем позже в Node.js контексте
                                isAutoBid: isAutoBid
                            });
                        }
                    }
                }
                
                return bids;
            });
            
            // Форматируем даты в Node.js контексте
            const formattedBidHistory = bidHistory.map(bid => ({
                ...bid,
                timestamp: this.formatTimestamp(bid.timestamp)
            }));
            
            this.writeLog(`✅ Найдено ${formattedBidHistory.length} ставок через AJAX`);
            return formattedBidHistory;
            
        } catch (error) {
            this.writeLog(`❌ Ошибка парсинга истории ставок: ${error.message}`);
            return [];
        }
    }

    /**
     * Форматирование временной метки из DD.MM.YYYY HH:MM:SS в YYYY-MM-DD HH:MM:SS
     */
    formatTimestamp(timestampText) {
        try {
            // Парсим дату в формате DD.MM.YYYY HH:MM:SS
            const match = timestampText.match(/(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
            if (match) {
                const [, day, month, year, hour, minute, second] = match;
                return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
            }
            
            // Если формат не распознан, возвращаем как есть
            this.writeLog(`⚠️ Неизвестный формат даты: ${timestampText}`);
            return timestampText;
        } catch (error) {
            this.writeLog(`❌ Ошибка форматирования даты: ${error.message}`);
            return timestampText;
        }
    }

    /**
     * Получение ID лота по номеру аукциона и номеру лота
     */
    async getLotId(auctionNumber, lotNumber) {
        try {
            const realAuctionNumber = await this.getRealAuctionNumber(auctionNumber);
            const result = await this.dbClient.query(
                'SELECT id FROM auction_lots WHERE auction_number = $1 AND lot_number = $2',
                [realAuctionNumber, lotNumber]
            );
            return result.rows.length > 0 ? result.rows[0].id : null;
        } catch (error) {
            this.writeLog(`❌ Ошибка получения ID лота: ${error.message}`);
            return null;
        }
    }

    /**
     * Сохранение истории ставок в базу данных
     */
    async saveBidsToDatabase(bidHistory, lotId, auctionNumber, lotNumber) {
        if (!bidHistory || bidHistory.length === 0) {
            return;
        }
        
        try {
            this.writeLog(`💾 Сохраняем ${bidHistory.length} ставок в БД...`);
            
            for (const bid of bidHistory) {
                const insertQuery = `
                    INSERT INTO lot_bids (
                        lot_id, auction_number, lot_number, bid_amount, bidder_login, bid_timestamp, is_auto_bid
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                    ON CONFLICT (auction_number, lot_number, bid_amount, bidder_login, bid_timestamp) DO NOTHING
                `;
                
                const values = [
                    lotId,
                    auctionNumber,
                    lotNumber,
                    bid.amount,
                    bid.bidder,
                    bid.timestamp,
                    bid.isAutoBid
                ];
                
                await this.dbClient.query(insertQuery, values);
            }
            
            this.writeLog(`✅ Сохранено ${bidHistory.length} ставок`);
            
        } catch (error) {
            this.writeLog(`❌ Ошибка сохранения ставок: ${error.message}`);
            throw error;
        }
    }

    /**
     * Обновление информации о победителе и выигравшей ставке
     */
    async updateLotWinnerInfo(auctionNumber, lotNumber, bidHistory) {
        if (!bidHistory || bidHistory.length === 0) {
            return;
        }
        
        try {
            // Находим последнюю (выигравшую) ставку
            // Сортируем по времени (последняя ставка - это выигравшая)
            const sortedBids = bidHistory.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            const winningBid = sortedBids[0];
            
            if (winningBid) {
                const updateQuery = `
                    UPDATE auction_lots 
                    SET winning_bid = $1, winner_login = $2
                    WHERE auction_number = $3 AND lot_number = $4
                `;
                
                const result = await this.dbClient.query(updateQuery, [
                    winningBid.amount,
                    winningBid.bidder,
                    auctionNumber,
                    lotNumber
                ]);
                
                if (result.rowCount > 0) {
                    this.writeLog(`   🏆 Обновлена информация о победителе: ${winningBid.bidder} (${winningBid.amount} руб.)`);
                }
            }
            
        } catch (error) {
            this.writeLog(`   ⚠️ Ошибка обновления информации о победителе: ${error.message}`);
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
    async updateLotCategory(auctionNumber, lotNumber, category, sourceCategory, bidHistory = null) {
        try {
            const query = `
                UPDATE auction_lots 
                SET category = $1, source_category = $2, parsing_method = 'category_parser'
                WHERE auction_number = $3 AND lot_number = $4 
                AND (category IS NULL OR category = '')
            `;
            
            const result = await this.dbClient.query(query, [category, sourceCategory, auctionNumber, lotNumber]);
            
            // Если лот был обновлен и есть история ставок, сохраняем её
            if (result.rowCount > 0 && bidHistory && bidHistory.length > 0) {
                try {
                    // Получаем ID лота
                    const lotIdQuery = `SELECT id FROM auction_lots WHERE auction_number = $1 AND lot_number = $2`;
                    const lotIdResult = await this.dbClient.query(lotIdQuery, [auctionNumber, lotNumber]);
                    
                    if (lotIdResult.rows.length > 0) {
                        const lotId = lotIdResult.rows[0].id;
                        // Определяем реальный номер аукциона
                        const realAuctionNumber = await this.getRealAuctionNumber(auctionNumber);
                        // Сохраняем ставки
                        await this.saveBidsToDatabase(bidHistory, lotId, realAuctionNumber, lotNumber);
                        this.writeLog(`   💰 Ставки для лота ${lotNumber} сохранены (${bidHistory.length} ставок)`);
                        
                        // Обновляем информацию о победителе и выигравшей ставке
                        await this.updateLotWinnerInfo(auctionNumber, lotNumber, bidHistory);
                    }
                } catch (bidError) {
                    this.writeLog(`   ⚠️ Ошибка сохранения ставок для лота ${lotNumber}: ${bidError.message}`);
                }
            }
            
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
                this.writeLog('📋 Загруженные категории (в алфавитном порядке):');
                this.categories.forEach((cat, index) => {
                    const marker = cat.name === 'Боны' ? ' ⚠️ ВНИМАНИЕ: ЭТА КАТЕГОРИЯ' : '';
                    this.writeLog(`  ${index + 1}. ${cat.name} -> ${cat.url_slug}${marker}`);
                });
                this.writeLog(`✅ Подтверждено: категории загружены в алфавитном порядке (ORDER BY name)`);
            } else {
                this.writeLog('⚠️ Категории не найдены в базе данных. Запустите скрипт parse-and-save-categories.js');
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
            this.writeLog(`   📍 Переходим на страницу категории...`);
            
            try {
                await this.page.goto(categoryUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
                await this.delay(2000);
                this.writeLog(`   ✅ Страница категории загружена`);
            } catch (gotoError) {
                this.writeLog(`❌ ОШИБКА загрузки страницы категории: ${gotoError.message}`);
                this.writeLog(`❌ URL: ${categoryUrl}`);
                // Возвращаем пустой массив вместо выброса ошибки, чтобы парсер мог продолжить
                return [];
            }

            // Получаем информацию о пагинации
            let paginationInfo;
            try {
                paginationInfo = await this.page.evaluate(() => {
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
            } catch (evalError) {
                this.writeLog(`⚠️ Ошибка получения информации о пагинации: ${evalError.message}`);
                // Продолжаем с первой страницы
                paginationInfo = { totalLots: null, maxPage: 1 };
            }

            this.writeLog(`   📊 Найдено лотов: ${paginationInfo.totalLots || 'неизвестно'}`);
            this.writeLog(`   📄 Страниц: ${paginationInfo.maxPage}`);

            const maxPages = testMode ? Math.min(3, paginationInfo.maxPage) : paginationInfo.maxPage;

            // Собираем ссылки со всех страниц
            for (let page = 1; page <= maxPages; page++) {
                try {
                    const pageUrl = page === 1 ? categoryUrl : `${categoryUrl}${categoryUrl.includes('?') ? '&' : '?'}page=${page}`;
                    
                    this.writeLog(`   📄 Обрабатываем страницу ${page}/${maxPages}: ${pageUrl}`);
                    
                    try {
                        await this.page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
                        await this.delay(1000);
                    } catch (pageGotoError) {
                        this.writeLog(`   ⚠️ Ошибка загрузки страницы ${page}: ${pageGotoError.message}`);
                        
                        // Если ошибка связана с detached frame, пересоздаем страницу
                        if (pageGotoError.message.includes('detached') || pageGotoError.message.includes('Frame')) {
                            this.writeLog(`   🔄 Обнаружена ошибка detached frame на странице ${page}, пересоздаем страницу...`);
                            await this.recreatePage();
                            await this.delay(3000);
                            // Пробуем еще раз
                            try {
                                await this.page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
                                await this.delay(1000);
                            } catch (retryError) {
                                this.writeLog(`   ❌ Повторная попытка загрузки страницы ${page} не удалась: ${retryError.message}`);
                                continue;
                            }
                        } else {
                            continue;
                        }
                    }

                    // Извлекаем ссылки на лоты с текущей страницы
                    let pageUrls = [];
                    try {
                        pageUrls = await this.page.evaluate(() => {
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
                    } catch (evalError) {
                        this.writeLog(`   ⚠️ Ошибка извлечения ссылок со страницы ${page}: ${evalError.message}`);
                        continue;
                    }

                    pageUrls.forEach(url => allUrls.add(url));
                    this.writeLog(`   ✓ Найдено ссылок на странице: ${pageUrls.length} (всего: ${allUrls.size})`);

                    // Задержка между страницами
                    await this.delay(500);

                } catch (error) {
                    this.writeLog(`   ❌ Ошибка на странице ${page}: ${error.message}`);
                    
                    // Если ошибка связана с detached frame, пересоздаем страницу
                    if (error.message.includes('detached') || error.message.includes('Frame')) {
                        this.writeLog(`   🔄 Обнаружена ошибка detached frame на странице ${page}, пересоздаем страницу...`);
                        await this.recreatePage();
                        await this.delay(3000);
                    }
                    
                    continue;
                }
            }

            const urls = Array.from(allUrls);
            this.writeLog(`✅ Собрано ${urls.length} уникальных ссылок на лоты в категории`);
            
            return urls;

        } catch (error) {
            this.writeLog(`❌ КРИТИЧЕСКАЯ ОШИБКА сбора ссылок в категории: ${error.message}`);
            this.writeLog(`❌ URL категории: ${categoryUrl}`);
            this.writeLog(`❌ Стек ошибки: ${error.stack}`);
            // Возвращаем пустой массив вместо выброса ошибки, чтобы парсер мог продолжить
            return [];
        }
    }

    /**
     * Парсинг отдельного лота с добавлением категории
     */
    async parseLotPage(url, auctionEndDate = null, sourceCategory = null, includeBids = false, parseBidsForExistingLots = false) {
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
            }
            
            // Парсим историю ставок, если требуется
            if (includeBids && this.page) {
                try {
                    lotData.bidHistory = await this.parseBidHistory(this.page, url);
                } catch (bidError) {
                    this.writeLog(`⚠️ Ошибка парсинга ставок для лота: ${bidError.message}`);
                    lotData.bidHistory = [];
                }
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
    async saveLotToDatabase(lotData, parseBidsForExistingLots = false, updateCategories = false) {
        try {
            // Определяем реальный номер аукциона для сохранения
            const realAuctionNumber = await this.getRealAuctionNumber(lotData.auctionNumber);
            this.writeLog(`💾 Сохраняем лот ${lotData.lotNumber} с auction_number = ${realAuctionNumber} (Wolmar ID: ${lotData.auctionNumber})`);
            
            // Проверяем текущее состояние лота в БД перед сохранением (для диагностики)
            let existingCategory = null;
            if (lotData.sourceCategory === 'Боны') {
                const checkBeforeQuery = await this.dbClient.query(
                    'SELECT category, source_category FROM auction_lots WHERE lot_number = $1 AND auction_number = $2',
                    [lotData.lotNumber, realAuctionNumber]
                );
                if (checkBeforeQuery.rows.length > 0) {
                    existingCategory = checkBeforeQuery.rows[0].category;
                    this.writeLog(`⚠️ Лот уже существует в БД. Текущая category=${existingCategory}, source_category=${checkBeforeQuery.rows[0].source_category}`);
                    this.writeLog(`⚠️ Пытаемся сохранить с category=${lotData.category}, source_category=${lotData.sourceCategory}`);
                    this.writeLog(`⚠️ updateCategories=${updateCategories} - категория будет ${updateCategories ? 'ПЕРЕЗАПИСАНА' : 'сохранена только если пустая'}`);
                } else {
                    this.writeLog(`⚠️ Лот НОВЫЙ, будет создан с category=${lotData.category}, source_category=${lotData.sourceCategory}`);
                }
            }
            
            const upsertQuery = `
                INSERT INTO auction_lots (
                    lot_number, auction_number, coin_description, avers_image_url, avers_image_path,
                    revers_image_url, revers_image_path, winner_login, winning_bid, auction_end_date,
                    currency, source_url, bids_count, lot_status, year, metal, weight, condition,
                    letters, lot_type, category, source_category, parsing_method, parsing_number
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24
                ) 
                ON CONFLICT (lot_number, auction_number) 
                DO UPDATE SET
                    coin_description = EXCLUDED.coin_description,
                    avers_image_url = EXCLUDED.avers_image_url,
                    revers_image_url = EXCLUDED.revers_image_url,
                    winner_login = EXCLUDED.winner_login,
                    winning_bid = EXCLUDED.winning_bid,
                    auction_end_date = EXCLUDED.auction_end_date,
                    source_url = EXCLUDED.source_url,
                    bids_count = EXCLUDED.bids_count,
                    lot_status = EXCLUDED.lot_status,
                    year = EXCLUDED.year,
                    metal = EXCLUDED.metal,
                    weight = EXCLUDED.weight,
                    condition = EXCLUDED.condition,
                    letters = EXCLUDED.letters,
                    lot_type = EXCLUDED.lot_type,
                    -- Обновляем категорию в зависимости от флага updateCategories ($25)
                    -- Если updateCategories = true, всегда перезаписываем категорию
                    -- Если updateCategories = false, обновляем только если категория пустая
                    category = CASE 
                        WHEN $25 = true THEN EXCLUDED.category  -- updateCategories = true: всегда перезаписываем
                        WHEN auction_lots.category IS NULL OR auction_lots.category = '' 
                        THEN EXCLUDED.category  -- updateCategories = false: обновляем только если пустая
                        ELSE auction_lots.category  -- updateCategories = false: сохраняем существующую
                    END,
                    -- source_category обновляем всегда, чтобы знать последний источник
                    source_category = EXCLUDED.source_category,
                    parsing_method = EXCLUDED.parsing_method,
                    parsing_number = EXCLUDED.parsing_number
                RETURNING id, category
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
                this.targetAuctionNumber, // parsing_number - внутренний Wolmar ID
                updateCategories // $25 - флаг обновления категорий
            ];

            const result = await this.dbClient.query(upsertQuery, values);
            const lotId = result.rows[0].id;
            const savedCategory = result.rows[0].category;
            
            // Диагностика для категории "Боны"
            if (lotData.sourceCategory === 'Боны') {
                this.writeLog(`⚠️ После ON CONFLICT: сохраненная category=${savedCategory}, ожидали=${lotData.category}, updateCategories=${updateCategories}`);
                if (savedCategory !== lotData.category) {
                    if (updateCategories) {
                        this.writeLog(`⚠️ ВНИМАНИЕ: updateCategories=true, но категория НЕ была изменена!`);
                        this.writeLog(`⚠️ В БД была "${existingCategory || savedCategory}", мы пытались установить "${lotData.category}"`);
                        this.writeLog(`⚠️ Это ошибка - при updateCategories=true категория должна перезаписываться!`);
                    } else if (existingCategory) {
                        this.writeLog(`⚠️ updateCategories=false: Категория НЕ была изменена. В БД была "${existingCategory}", мы пытались установить "${lotData.category}"`);
                        this.writeLog(`⚠️ Логика ON CONFLICT сохранила существующую категорию "${savedCategory}" (это правильно при updateCategories=false)`);
                    } else {
                        this.writeLog(`⚠️ ВНИМАНИЕ: Категория была изменена с "${lotData.category}" на "${savedCategory}"`);
                        this.writeLog(`⚠️ Это странно, т.к. лот был новым. Возможно, есть триггер или другая логика в БД?`);
                    }
                } else {
                    if (updateCategories && existingCategory && existingCategory !== lotData.category) {
                        this.writeLog(`✅ Категория успешно ПЕРЕЗАПИСАНА с "${existingCategory}" на "${savedCategory}" (updateCategories=true)`);
                    } else {
                        this.writeLog(`✅ Категория успешно сохранена как "${savedCategory}"`);
                    }
                }
            }
            
            // Сохраняем историю ставок, если она есть
            if (lotData.bidHistory && lotData.bidHistory.length > 0) {
                await this.saveBidsToDatabase(lotData.bidHistory, lotId, realAuctionNumber, lotData.lotNumber);
            }
            
            return lotId;

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
                    return await this.saveLotToDatabase(lotData, parseBidsForExistingLots, updateCategories);
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
            updateCategories = false,
            updateBids = false,
            delayBetweenLots = 800,
            testMode = false,
            startFromLot = 1
        } = options;
        
        // Преобразуем новые параметры в старые для совместимости
        const skipExisting = !updateCategories; // Если обновляем категории, не пропускаем существующие
        const includeBids = updateBids; // Если обновляем ставки, парсим их
        const parseBidsForExistingLots = false; // Убираем эту логику

        this.writeLog(`\n🎯 Начинаем парсинг категории: ${categoryName}`);
        this.writeLog(`   URL: ${categoryUrl}`);
        this.writeLog(`   Настройки: maxLots=${maxLots}, updateCategories=${updateCategories}, updateBids=${updateBids}, delay=${delayBetweenLots}ms, testMode=${testMode}`);

        try {
            // Получаем ссылки на лоты в категории
            this.writeLog(`🔍 Получаем список лотов для категории ${categoryName}...`);
            
            // Специальное логирование для категории "Боны"
            if (categoryName === 'Боны') {
                this.writeLog(`⚠️⚠️⚠️ СПЕЦИАЛЬНАЯ ОТЛАДКА ДЛЯ "БОНЫ" ⚠️⚠️⚠️`);
                this.writeLog(`⚠️ URL категории: ${categoryUrl}`);
                this.writeLog(`⚠️ testMode: ${testMode}`);
            }
            
            let lotUrls;
            try {
                lotUrls = await this.getCategoryLotUrls(categoryUrl, testMode);
                
                if (categoryName === 'Боны') {
                    this.writeLog(`⚠️ getCategoryLotUrls вернул результат для "Боны":`);
                    this.writeLog(`⚠️ Тип результата: ${typeof lotUrls}`);
                    this.writeLog(`⚠️ Является массивом: ${Array.isArray(lotUrls)}`);
                    this.writeLog(`⚠️ Количество лотов: ${Array.isArray(lotUrls) ? lotUrls.length : 'N/A'}`);
                }
            } catch (urlError) {
                this.writeLog(`❌ ОШИБКА получения ссылок на лоты для категории ${categoryName}: ${urlError.message}`);
                this.writeLog(`❌ URL категории: ${categoryUrl}`);
                this.writeLog(`❌ Стек ошибки: ${urlError.stack}`);
                
                if (categoryName === 'Боны') {
                    this.writeLog(`⚠️⚠️⚠️ КРИТИЧЕСКАЯ ОШИБКА ДЛЯ "БОНЫ" ⚠️⚠️⚠️`);
                    this.writeLog(`⚠️ Ошибка: ${urlError.message}`);
                    this.writeLog(`⚠️ Стек: ${urlError.stack}`);
                }
                
                this.writeLog(`❌ Продолжаем с следующей категорией...`);
                return; // Пропускаем эту категорию и продолжаем со следующей
            }
            
            // Проверяем, что lotUrls - массив
            if (!Array.isArray(lotUrls)) {
                this.writeLog(`❌ ОШИБКА: getCategoryLotUrls вернул не массив для категории ${categoryName}`);
                this.writeLog(`❌ Тип результата: ${typeof lotUrls}, значение: ${lotUrls}`);
                
                if (categoryName === 'Боны') {
                    this.writeLog(`⚠️⚠️⚠️ КРИТИЧЕСКАЯ ПРОБЛЕМА: "БОНЫ" - getCategoryLotUrls вернул не массив ⚠️⚠️⚠️`);
                }
                
                return;
            }
            
            if (lotUrls.length === 0) {
                this.writeLog(`⚠️ ВНИМАНИЕ: В категории ${categoryName} не найдено лотов (URL: ${categoryUrl})`);
                this.writeLog(`⚠️ Это может означать, что в данной категории нет лотов для данного аукциона`);
                
                if (categoryName === 'Боны') {
                    this.writeLog(`⚠️⚠️⚠️ ВНИМАНИЕ: "БОНЫ" - НЕ НАЙДЕНО ЛОТОВ ⚠️⚠️⚠️`);
                    this.writeLog(`⚠️ URL был: ${categoryUrl}`);
                    this.writeLog(`⚠️ Проверьте, есть ли лоты в этой категории для данного аукциона на сайте`);
                }
                
                // Возвращаем специальный объект, чтобы отследить пропуск категории
                return { skipped: true, reason: 'no_lots' };
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
                    startIndex = lotIndex + 1; // +1 чтобы начать со СЛЕДУЮЩЕГО лота после найденного
                    this.writeLog(`🔍 Найден лот ${startFromLot} в позиции ${lotIndex + 1} из ${lotUrls.length} в категории ${categoryName}`);
                    this.writeLog(`🔄 Начинаем с позиции ${startIndex + 1} (следующий лот после ${startFromLot})`);
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
                    const lotData = await this.parseLotPage(url, null, categoryName, includeBids, parseBidsForExistingLots);
                    
                    if (!lotData) {
                        this.writeLog(`⚠️ Лот не был распарсен: ${url}`);
                        categorySkipped++;
                        continue;
                    }
                    
                    // Присваиваем категорию из URL (не полагаемся на классификатор)
                    lotData.category = this.mapCategoryNameToCode(categoryName);
                    
                    // Логируем категорию для отладки
                    if (categoryName === 'Боны') {
                        this.writeLog(`⚠️ Сохраняем лот с категорией "Боны" (код: ${lotData.category})`);
                        this.writeLog(`⚠️ lot_number: ${lotData.lotNumber}, auction_number: ${lotData.auctionNumber}`);
                    }
                    
                    // Сохранение в БД (INSERT или UPDATE в зависимости от существования)
                    this.writeLog(`   💾 Сохраняем лот в БД...`);
                    const savedId = await this.saveLotToDatabase(lotData, parseBidsForExistingLots, updateCategories);
                    
                    if (categoryName === 'Боны' && savedId) {
                        this.writeLog(`⚠️ Лот сохранен с ID: ${savedId}`);
                        // Проверяем, что категория действительно сохранилась
                        const checkQuery = await this.dbClient.query(
                            'SELECT category, source_category FROM auction_lots WHERE id = $1',
                            [savedId]
                        );
                        if (checkQuery.rows.length > 0) {
                            this.writeLog(`⚠️ Проверка после сохранения: category=${checkQuery.rows[0].category}, source_category=${checkQuery.rows[0].source_category}`);
                        }
                    }
                    if (savedId) {
                        categoryProcessed++;
                        this.processed++;
                        // Обновляем прогресс категории
                        if (!this.categoryProgress[categoryName]) {
                            this.categoryProgress[categoryName] = { processed: 0, total: 0 };
                        }
                        this.categoryProgress[categoryName].processed++;
                        
                        // Сохраняем информацию о последнем обработанном лоте
                        // Сохраняем номер лота Wolmar для корректного возобновления
                        this.lastProcessedLot = lotData.lotNumber; // Номер лота Wolmar
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
            updateCategories = false,
            updateBids = false,
            delayBetweenLots = 800,
            testMode = false,
            resumeFromLastLot = false
        } = options;

        this.writeLog(`🎯 НАЧИНАЕМ ПАРСИНГ АУКЦИОНА: ${auctionNumber}`);
        this.writeLog(`   Стартовый лот: ${startFromLot}`);
        this.writeLog(`   Возобновление с последнего лота: ${resumeFromLastLot}`);
        this.writeLog(`   Обновить категории: ${updateCategories}`);
        this.writeLog(`   Обновить ставки: ${updateBids}`);
        this.writeLog(`   Настройки: maxLots=${maxLots}, updateCategories=${updateCategories}, updateBids=${updateBids}, delay=${delayBetweenLots}ms, testMode=${testMode}`);

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
            this.writeLog(`📋 Порядок обработки категорий (алфавитный):`);
            categories.forEach((cat, index) => {
                this.writeLog(`   ${index + 1}. ${cat.name} -> ${cat.url}`);
            });
            
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
                this.writeLog(`🔍 Ищем категорию для возобновления: "${this.lastProcessedCategory}"`);
                this.writeLog(`🔍 Доступные категории: ${categories.map((c, idx) => `${idx}: ${c.name}`).join(', ')}`);
                
                startCategoryIndex = categories.findIndex(cat => cat.name === this.lastProcessedCategory);
                
                if (startCategoryIndex === -1) {
                    this.writeLog(`⚠️ ВНИМАНИЕ: Категория "${this.lastProcessedCategory}" не найдена в списке!`);
                    this.writeLog(`⚠️ Это может означать, что список категорий изменился или произошла ошибка`);
                    this.writeLog(`⚠️ Начинаем с первой категории (индекс 0)`);
                    startCategoryIndex = 0;
                } else {
                    this.writeLog(`✅ Найдена категория "${this.lastProcessedCategory}" на индексе ${startCategoryIndex}`);
                    this.writeLog(`🔄 Возобновляем с категории ${this.lastProcessedCategory} (индекс ${startCategoryIndex})`);
                }
            } else {
                this.writeLog(`🔍 Нет сохраненной категории для возобновления (resumeFromLastLot=${resumeFromLastLot}, lastProcessedCategory=${this.lastProcessedCategory})`);
                this.writeLog(`🔍 Начинаем с первой категории (индекс 0)`);
            }
            
            // Парсим категории начиная с нужной
            this.writeLog(`🎯 Начинаем парсинг с категории ${startCategoryIndex + 1} из ${categories.length}`);
            this.writeLog(`🎯 Всего категорий для обработки: ${categories.length}`);
            
            let processedCategoriesCount = 0;
            let skippedCategoriesCount = 0;
            let errorCategoriesCount = 0;
            
            for (let i = startCategoryIndex; i < categories.length; i++) {
                const category = categories[i];
                
                // Специальное логирование для категории "Боны"
                if (category.name === 'Боны') {
                    this.writeLog(`\n${'='.repeat(80)}`);
                    this.writeLog(`⚠️⚠️⚠️ ОБРАБОТКА КАТЕГОРИИ "БОНЫ" ⚠️⚠️⚠️`);
                    this.writeLog(`⚠️ Индекс в массиве: ${i}`);
                    this.writeLog(`⚠️ URL: ${category.url}`);
                    this.writeLog(`⚠️ Предыдущая категория: ${i > 0 ? categories[i-1].name : 'нет'}`);
                    this.writeLog(`⚠️ Следующая категория: ${i < categories.length - 1 ? categories[i+1].name : 'нет'}`);
                    this.writeLog(`${'='.repeat(80)}\n`);
                }
                
                // Сохраняем текущую категорию перед началом обработки
                this.lastProcessedCategory = category.name;
                this.lastProcessedCategoryIndex = i;
                this.saveProgress();
                this.writeLog(`💾 Прогресс сохранен: категория ${category.name} (индекс ${i})`);
                
                try {
                    this.writeLog(`\n${'='.repeat(80)}`);
                    this.writeLog(`🔄 [${i + 1}/${categories.length}] Начинаем парсинг категории: ${category.name}`);
                    this.writeLog(`🔄 URL категории: ${category.url}`);
                    this.writeLog(`🔄 Индекс категории в цикле: ${i}, startCategoryIndex: ${startCategoryIndex}`);
                    
                    // Для первой категории при возобновлении используем startFromLot
                    const categoryStartFromLot = (i === startCategoryIndex && resumeFromLastLot) ? startFromLot : 1;
                    this.writeLog(`🔄 Стартовый лот для категории: ${categoryStartFromLot} (resumeFromLastLot=${resumeFromLastLot}, startFromLot=${startFromLot})`);
                    
                    const result = await this.parseCategoryLots(category.url, category.name, {
                        maxLots,
                        updateCategories,
                        updateBids,
                        delayBetweenLots,
                        testMode,
                        startFromLot: categoryStartFromLot
                    });
                    
                    // Проверяем, была ли категория пропущена
                    if (result && result.skipped) {
                        this.writeLog(`⚠️ Категория ${category.name} пропущена: ${result.reason === 'no_lots' ? 'нет лотов' : 'неизвестная причина'}`);
                        skippedCategoriesCount++;
                    } else {
                        this.writeLog(`✅ Категория ${category.name} обработана успешно`);
                        processedCategoriesCount++;
                    }
                    
                    // Обновляем прогресс после успешной обработки категории
                    this.lastProcessedCategory = category.name;
                    this.lastProcessedCategoryIndex = i;
                    this.saveProgress();
                    this.writeLog(`💾 Прогресс обновлен после обработки категории ${category.name}`);
                    
                } catch (categoryError) {
                    this.writeLog(`❌ ОШИБКА при парсинге категории ${category.name}: ${categoryError.message}`);
                    this.writeLog(`❌ URL категории: ${category.url}`);
                    this.writeLog(`❌ Стек ошибки категории: ${categoryError.stack}`);
                    errorCategoriesCount++;
                    
                    // Сохраняем прогресс даже при ошибке, чтобы не начинать заново
                    this.lastProcessedCategory = category.name;
                    this.lastProcessedCategoryIndex = i;
                    this.saveProgress();
                    this.writeLog(`💾 Прогресс сохранен после ошибки в категории ${category.name}`);
                    this.writeLog(`➡️ Продолжаем со следующей категории (индекс ${i + 1})`);
                    // Продолжаем с следующей категорией
                }
            }
            
            this.writeLog(`\n${'='.repeat(80)}`);
            this.writeLog(`📊 СТАТИСТИКА ПО КАТЕГОРИЯМ:`);
            this.writeLog(`   ✅ Успешно обработано: ${processedCategoriesCount}`);
            this.writeLog(`   ⚠️ Пропущено (нет лотов): ${skippedCategoriesCount}`);
            this.writeLog(`   ❌ Ошибок: ${errorCategoriesCount}`);
            this.writeLog(`   📋 Всего категорий: ${categories.length}`);

            this.writeLog(`🎉 ПАРСИНГ АУКЦИОНА ${auctionNumber} ЗАВЕРШЕН!`);
            this.writeLog(`📊 ИТОГОВАЯ СТАТИСТИКА:`);
            this.writeLog(`   ✅ Обработано лотов: ${this.processed}`);
            this.writeLog(`   ❌ Ошибок: ${this.errors}`);
            this.writeLog(`   ⏭️ Пропущено: ${this.skipped}`);
            this.writeLog(`   📋 Обработано категорий: ${processedCategoriesCount}`);
            this.writeLog(`   ⚠️ Пропущено категорий: ${skippedCategoriesCount}`);
            this.writeLog(`   ❌ Ошибок в категориях: ${errorCategoriesCount}`);

            // Очищаем файл прогресса только если все категории обработаны успешно
            if (errorCategoriesCount === 0 && processedCategoriesCount + skippedCategoriesCount === categories.length) {
                this.clearProgress();
                this.writeLog(`🧹 Файл прогресса очищен (все категории обработаны)`);
            } else {
                this.writeLog(`⚠️ Файл прогресса НЕ очищен (есть ошибки или не все категории обработаны)`);
                this.writeLog(`⚠️ Последняя обработанная категория: ${this.lastProcessedCategory} (индекс ${this.lastProcessedCategoryIndex})`);
                this.writeLog(`⚠️ При следующем запуске парсинг возобновится с категории "${this.lastProcessedCategory}"`);
            }

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
            
            // НЕ очищаем файл прогресса при критической ошибке - сохраняем для возобновления
            // Это позволит возобновить парсинг с последней обработанной категории
            this.writeLog(`⚠️ Файл прогресса НЕ очищен из-за критической ошибки`);
            this.writeLog(`⚠️ Последняя обработанная категория: ${this.lastProcessedCategory} (индекс ${this.lastProcessedCategoryIndex})`);
            this.writeLog(`⚠️ При следующем запуске парсинг возобновится с категории "${this.lastProcessedCategory}"`);
            
            // Сохраняем прогресс перед выбросом ошибки
            this.saveProgress();
            
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
                    updateCategories: true,
                    updateBids: false,
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
                    updateCategories,
                    updateBids,
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
            const fs = require('fs');
            if (fs.existsSync(this.progressFile)) {
                this.writeLog('🔍 loadProgress: файл существует');
                const progressData = fs.readFileSync(this.progressFile, 'utf8');
                const progress = JSON.parse(progressData);
                this.writeLog(`📂 Найден сохраненный прогресс Category Parser: обработано ${progress.processed}, ошибок ${progress.errors}, пропущено ${progress.skipped}`);
                this.writeLog(`🔍 loadProgress: categoryProgress: ${JSON.stringify(progress.categoryProgress)}`);
                this.writeLog(`🔍 loadProgress: lastProcessedLot: ${progress.lastProcessedLot}`);
                this.writeLog(`🔍 loadProgress: lastProcessedCategory: ${progress.lastProcessedCategory}`);
                
                this.processed = progress.processed || 0;
                this.errors = progress.errors || 0;
                this.skipped = progress.skipped || 0;
                this.categoryProgress = progress.categoryProgress || {};
                // Загружаем новые поля для возобновления
                this.lastProcessedLot = progress.lastProcessedLot || null;
                this.lastProcessedCategory = progress.lastProcessedCategory || null;
                this.lastProcessedCategoryIndex = progress.lastProcessedCategoryIndex || 0;
                
                this.writeLog(`🔍 loadProgress: после загрузки this.categoryProgress: ${JSON.stringify(this.categoryProgress)}`);
                this.writeLog(`🔍 loadProgress: после загрузки this.lastProcessedLot: ${this.lastProcessedLot}`);
                this.writeLog(`🔍 loadProgress: после загрузки this.lastProcessedCategory: ${this.lastProcessedCategory}`);
                
                return progress;
            } else {
                this.writeLog('🔍 loadProgress: файл не существует');
                this.writeLog(`🔍 loadProgress: this.categoryProgress до загрузки: ${JSON.stringify(this.categoryProgress)}`);
            }
        } catch (error) {
            this.writeLog(`❌ ОШИБКА загрузки прогресса Category Parser: ${error.message}`);
            this.writeLog(`❌ Файл прогресса: ${this.progressFile}`);
            this.writeLog(`❌ Стек ошибки: ${error.stack}`);
        }
        return null;
    }

    /**
     * Очистка файла прогресса
     */
    clearProgress() {
        try {
            const fs = require('fs');
            if (fs.existsSync(this.progressFile)) {
                fs.unlinkSync(this.progressFile);
                this.writeLog(`🧹 Файл прогресса удален: ${this.progressFile}`);
            }
            
            // Сбрасываем внутренние переменные прогресса
            this.lastProcessedLot = null;
            this.lastProcessedCategory = null;
            this.lastProcessedCategoryIndex = 0;
            this.categoryProgress = {};
            
        } catch (error) {
            this.writeLog(`❌ ОШИБКА очистки прогресса: ${error.message}`);
        }
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
            this.writeLog(`🔍 getParsingStatus: this.categoryProgress = ${JSON.stringify(this.categoryProgress)}`);
            if (this.categoryProgress && Object.keys(this.categoryProgress).length > 0) {
                this.writeLog('🔍 getParsingStatus: категории найдены:', Object.keys(this.categoryProgress));
                categories = Object.keys(this.categoryProgress).map(categoryName => {
                    const progress = this.categoryProgress[categoryName];
                    return {
                        category: categoryName,
                        count: progress.total || 0,
                        with_source: progress.processed || 0
                    };
                });
            } else {
                this.writeLog('🔍 getParsingStatus: категории не найдены');
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
            updateCategories = false,
            updateBids = false,
            delayBetweenLots = 800,
            testMode = false
        } = options;

        this.writeLog('🚀 НАЧИНАЕМ ПАРСИНГ ВСЕХ КАТЕГОРИЙ WOLMAR...');
        this.writeLog(`Настройки: maxCategories=${maxCategories}, maxLotsPerCategory=${maxLotsPerCategory}, updateCategories=${updateCategories}, updateBids=${updateBids}, testMode=${testMode}`);

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
                        updateCategories,
                        updateBids,
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
            if (this.browser) {
                await this.browser.close();
            }
            cleanupChromeTempFiles();
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
        const updateBids = args.includes('--include-bids');
        const fromLotIndex = args.indexOf('--from-lot');
        const startFromLot = fromLotIndex !== -1 && args[fromLotIndex + 1] ? parseInt(args[fromLotIndex + 1]) : null;
        
        console.log(`🚀 Wolmar Category Parser - Аукцион ${auctionNumber}`);
        console.log(`📋 Команда: ${command}`);
        console.log(`💰 Обновить ставки: ${updateBids ? 'Да' : 'Нет'}`);
        if (startFromLot) {
            console.log(`🔄 Начать с лота: ${startFromLot}`);
        }
        
        const parser = new WolmarCategoryParser(config.dbConfig, command, auctionNumber);
        
        try {
            await parser.init();
            
            if (command === 'auction') {
                console.log(`📍 Запуск парсинга аукциона ${auctionNumber} по категориям...`);
                await parser.parseSpecificAuction(auctionNumber, 1, {
                    updateCategories: true,
                    updateBids: updateBids,
                    delayBetweenLots: 800
                });
            } else if (command === 'resume') {
                console.log(`📍 Возобновление парсинга аукциона ${auctionNumber}...`);
                await parser.parseSpecificAuction(auctionNumber, startFromLot || 1, {
                    updateCategories: true,
                    updateBids: updateBids,
                    delayBetweenLots: 800,
                    resumeFromLastLot: true  // Всегда пытаемся загрузить из файла прогресса
                });
            } else {
                throw new Error(`Неподдерживаемая команда: ${command}`);
            }
            
            console.log('✅ Парсинг завершен успешно');

            // Автоматическая генерация прогнозных цен сразу после парсинга.
            // Ошибка генерации не должна влиять на успешность самого парсинга.
            try {
                console.log('🔮 Запуск автоматической генерации прогнозов...');
                const ImprovedPredictionsGenerator = require('./improved-predictions-generator');
                const generator = new ImprovedPredictionsGenerator();
                await generator.init();
                await generator.generatePredictionsForAuction(auctionNumber);
                await generator.close();
                console.log('✅ Прогнозы сгенерированы');
            } catch (predictionError) {
                console.error('⚠️ Парсинг успешен, но генерация прогнозов не удалась:', predictionError.message);
            }

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

const puppeteer = require('puppeteer-core');
const { Client, Pool } = require('pg');
const fs = require('fs');
const https = require('https');
const config = require('./config');

class WolmarAuctionParser {
    constructor(dbConfig, auctionNumber) {
        this.dbConfig = dbConfig;
        this.dbClient = null;
        this.dbPool = null;
        this.browser = null;
        this.page = null;
        this.processed = 0;
        this.errors = 0;
        this.skipped = 0;
        this.auctionNumber = auctionNumber;
        this.progressFile = `parser_progress_${auctionNumber}.json`;
        this.retryCount = 0;
        this.maxRetries = config.parserConfig.maxRetries;
    }

    async init() {
        try {
            console.log('🔧 Инициализация парсера...');
            
            // Проверяем доступность базы данных
            await this.testDatabaseConnection();
            
            // Создание таблицы если не существует
            await this.createTable();
            
            // Инициализация браузера
            await this.initBrowser();
            
            console.log('✅ Парсер успешно инициализирован');
        } catch (error) {
            console.error('❌ Ошибка инициализации:', error.message);
            throw error;
        }
    }

    async testDatabaseConnection() {
        console.log('🔍 Проверяем подключение к базе данных...');
        
        try {
            // Создаем временное соединение для теста
            const testClient = new Client(this.dbConfig);
            await testClient.connect();
            
            // Простой тестовый запрос
            await testClient.query('SELECT 1');
            await testClient.end();
            
            console.log('✅ Подключение к базе данных успешно');
            
            // Создаем основной клиент
            this.dbClient = new Client(this.dbConfig);
            await this.dbClient.connect();
            
            // Добавляем обработчик ошибок
            this.dbClient.on('error', async (err) => {
                console.error('❌ Ошибка соединения с БД:', err.message);
                await this.handleDatabaseError(err);
            });
            
        } catch (error) {
            console.error('❌ Не удалось подключиться к базе данных:', error.message);
            
            if (error.code === 'ECONNREFUSED') {
                console.log('💡 Проверьте, что база данных запущена и доступна');
            } else if (error.code === 'ENOTFOUND') {
                console.log('💡 Проверьте правильность хоста базы данных');
            } else if (error.code === 'ECONNRESET') {
                console.log('💡 Соединение сброшено. Возможно, проблемы с сетью или настройками БД');
            }
            
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
            
            this.retryCount = 0; // Сбрасываем счетчик при успешном переподключении
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
            
            // Установка user-agent
            await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
            
            console.log('✅ Браузер инициализирован');
        } catch (error) {
            console.error('❌ Ошибка инициализации браузера:', error.message);
            
            if (error.message.includes('Could not find browser')) {
                console.log('💡 Проверьте, что Chrome установлен по пути:', config.browserConfig.executablePath);
            }
            
            throw error;
        }
    }

    async createTable() {
        try {
            console.log('📋 Создание/проверка таблиц...');
            
            // Создаем таблицу для лотов
            const createLotsTableQuery = `
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
            await this.dbClient.query(createLotsTableQuery);
            
            // Создаем таблицу для ссылок на лоты
            const createUrlsTableQuery = `
                CREATE TABLE IF NOT EXISTS auction_lot_urls (
                    id SERIAL PRIMARY KEY,
                    auction_number VARCHAR(50),
                    lot_url TEXT NOT NULL,
                    lot_number VARCHAR(50),
                    page_number INTEGER,
                    url_index INTEGER,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(auction_number, lot_url)
                );
            `;
            await this.dbClient.query(createUrlsTableQuery);
            
            console.log('✅ Таблицы проверены/созданы');
        } catch (error) {
            console.error('❌ Ошибка создания таблиц:', error.message);
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

    // Проверка доступности базы данных
    async isDatabaseAvailable() {
        try {
            await this.dbClient.query('SELECT 1');
            return true;
        } catch (error) {
            return false;
        }
    }

    // Безопасный запрос к базе данных с автоматическим переподключением
    async safeQuery(query, params = []) {
        try {
            return await this.dbClient.query(query, params);
        } catch (error) {
            if (error.message.includes('Connection terminated') || 
                error.message.includes('connection') || 
                error.message.includes('not queryable')) {
                
                console.log('🔄 Обнаружена ошибка соединения, пытаемся переподключиться...');
                await this.handleDatabaseError(error);
                
                // Повторяем запрос после переподключения
                return await this.dbClient.query(query, params);
            }
            throw error;
        }
    }

    // Основной метод парсинга всего аукциона (упрощенная версия для демонстрации)
    async parseEntireAuction(auctionUrl, options = {}) {
        const {
            maxLots = null,           
            skipExisting = true,      
            delayBetweenLots = 800,  
            batchSize = 50,          
            testMode = false,
            startIndex = 0
        } = options;

        console.log('🚀 Начинаем парсинг всего аукциона...');
        console.log(`Настройки: maxLots=${maxLots}, skipExisting=${skipExisting}, delay=${delayBetweenLots}ms, testMode=${testMode}, startIndex=${startIndex}`);

        try {
            // Проверяем доступность базы данных перед началом
            if (!(await this.isDatabaseAvailable())) {
                throw new Error('База данных недоступна');
            }

            // Получаем дату закрытия аукциона
            const auctionEndDate = await this.getAuctionEndDate(auctionUrl);
            
            // Получаем ссылки на лоты
            const lotUrls = await this.getAllLotUrls(auctionUrl, testMode);
            
            if (lotUrls.length === 0) {
                console.log('❌ Не найдено ссылок на лоты');
                return;
            }

            const totalLots = maxLots ? Math.min(maxLots, lotUrls.length) : lotUrls.length;
            console.log(`📊 Будет обработано лотов: ${totalLots} (начиная с индекса ${startIndex})`);

            // Обработка лотов
            for (let i = startIndex; i < totalLots; i++) {
                const url = lotUrls[i];
                const progress = `${i + 1}/${totalLots}`;
                
                try {
                    console.log(`\n[${progress}] Парсинг: ${url}`);
                    
                    const lotData = await this.parseLotPage(url, auctionEndDate);
                    
                    // Проверка на существование лота
                    if (skipExisting && lotData.auctionNumber && lotData.lotNumber) {
                        const exists = await this.lotExists(lotData.auctionNumber, lotData.lotNumber);
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
                        console.log(`✅ [${progress}] Лот ${lotData.lotNumber}: ${lotData.coinDescription?.substring(0, 50)}...`);
                        console.log(`   💰 ${lotData.winningBid} руб. | 👤 ${lotData.winnerLogin} | 📅 ${lotData.auctionEndDate || 'дата не установлена'}`);
                    } else {
                        console.log(`⚠️ [${progress}] Лот ${lotData.lotNumber} не был сохранен в БД`);
                    }

                    // Задержка между лотами
                    await this.delay(delayBetweenLots);

                } catch (error) {
                    this.errors++;
                    console.error(`❌ [${progress}] Ошибка обработки ${url}:`, error.message);
                    
                    // Если ошибка критическая, прерываем парсинг
                    if (error.message.includes('База данных недоступна')) {
                        console.log('🛑 Парсинг прерван из-за недоступности базы данных');
                        break;
                    }
                    
                    // Продолжаем с следующим лотом
                    continue;
                }
            }

            // Финальная статистика
            console.log(`\n🎉 Парсинг завершен!`);
            console.log(`📊 Итоговая статистика:`);
            console.log(`   ✅ Успешно обработано: ${this.processed}`);
            console.log(`   ⏭️ Пропущено (существующих): ${this.skipped}`);
            console.log(`   ❌ Ошибок: ${this.errors}`);
            console.log(`   📅 Дата закрытия аукциона: ${auctionEndDate}`);

        } catch (error) {
            console.error('💥 Критическая ошибка парсинга аукциона:', error.message);
            throw error;
        }
    }

    // Заглушки для методов, которые нужно реализовать
    async getAuctionEndDate(auctionUrl) {
        // Заглушка - нужно реализовать
        return new Date().toISOString();
    }

    async getAllLotUrls(auctionUrl, testMode = false) {
        // Заглушка - нужно реализовать
        console.log('⚠️ Метод getAllLotUrls не реализован в упрощенной версии');
        return [];
    }

    async parseLotPage(url, auctionEndDate = null) {
        // Заглушка - нужно реализовать
        console.log('⚠️ Метод parseLotPage не реализован в упрощенной версии');
        return {
            lotNumber: '1',
            auctionNumber: this.auctionNumber,
            coinDescription: 'Тестовое описание',
            winningBid: '1000',
            winnerLogin: 'test_user',
            auctionEndDate: auctionEndDate
        };
    }

    async lotExists(auctionNumber, lotNumber) {
        try {
            const query = 'SELECT id FROM auction_lots WHERE auction_number = $1 AND lot_number = $2';
            const result = await this.safeQuery(query, [auctionNumber, lotNumber]);
            return result.rows.length > 0;
        } catch (error) {
            console.error('❌ Ошибка проверки существования лота:', error.message);
            return false;
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
    const parser = new WolmarAuctionParser(config.dbConfig, auctionNumber);
    
    try {
        await parser.init();
        
        const auctionUrl = `https://www.wolmar.ru/auction/${auctionNumber}`;
        await parser.parseEntireAuction(auctionUrl, {
            maxLots: null,
            skipExisting: true,
            delayBetweenLots: config.parserConfig.delayBetweenLots,
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
    const parser = new WolmarAuctionParser(config.dbConfig, auctionNumber);
    
    try {
        await parser.init();
        
        const auctionUrl = `https://www.wolmar.ru/auction/${auctionNumber}`;
        await parser.parseEntireAuction(auctionUrl, {
            maxLots: 3,
            skipExisting: false,
            delayBetweenLots: 1000,
            batchSize: 3,
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

module.exports = WolmarAuctionParser;

// Запуск
if (require.main === module) {
    (async () => {
        const args = process.argv.slice(2);
        
        if (args.length === 0) {
            console.log('🚀 Wolmar Auction Parser v4.0 (Fixed)');
            console.log('Доступные команды:');
            console.log('  main <номер_аукциона>              - Полный парсинг аукциона');
            console.log('  test <номер_аукциона>              - Тестовый запуск (3 лота)');
            console.log('');
            console.log('Примеры:');
            console.log('  node wolmar-parser4-fixed.js main 2122');
            console.log('  node wolmar-parser4-fixed.js test 2122');
            return;
        }

        const command = args[0];
        const auctionNumber = args[1];

        if (!auctionNumber) {
            console.error('❌ Ошибка: Не указан номер аукциона');
            return;
        }

        console.log(`🚀 Wolmar Auction Parser v4.0 (Fixed) - Аукцион ${auctionNumber}`);

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

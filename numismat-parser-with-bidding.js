/**
 * Модифицированный парсер Numismat с поддержкой сбора истории ставок
 * Расширяет функциональность базового парсера для анализа поведения
 */

const puppeteer = require('puppeteer-core');
const { Client } = require('pg');
const fs = require('fs');
const config = require('./config');

class NumismatParserWithBidding {
    constructor(dbConfig, auctionNumber) {
        this.dbConfig = dbConfig;
        this.dbClient = null;
        this.browser = null;
        this.page = null;
        this.processed = 0;
        this.errors = 0;
        this.skipped = 0;
        this.biddingHistoryCollected = 0;
        this.auctionNumber = auctionNumber;
        this.sourceSite = 'numismat.ru';
        this.progressFile = `numismat_bidding_progress_${auctionNumber}.json`;
        this.retryCount = 0;
        this.maxRetries = config.parserConfig.maxRetries;
    }

    async init() {
        try {
            console.log('🔧 Инициализация Numismat парсера с поддержкой истории ставок...');
            
            // Проверяем доступность базы данных
            await this.testDatabaseConnection();
            
            // Создание таблиц
            await this.createTables();
            
            // Инициализация браузера
            await this.initBrowser();
            
            console.log('✅ Numismat парсер с историей ставок успешно инициализирован');
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
        } catch (error) {
            console.error('❌ Ошибка подключения к базе данных:', error.message);
            throw error;
        }
    }

    async createTables() {
        try {
            console.log('📊 Создание таблиц...');
            
            // Основная таблица лотов (расширенная)
            const createLotsTableQuery = `
                CREATE TABLE IF NOT EXISTS auction_lots (
                    id SERIAL PRIMARY KEY,
                    lot_number VARCHAR(50),
                    auction_number VARCHAR(50),
                    source_site VARCHAR(50) DEFAULT 'numismat.ru',
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
                    bidding_history_collected BOOLEAN DEFAULT FALSE,
                    suspicious_activity_score DECIMAL(5,2) DEFAULT 0,
                    manipulation_indicators JSONB DEFAULT '{}'::jsonb,
                    UNIQUE(lot_number, auction_number, source_site)
                );
            `;
            await this.dbClient.query(createLotsTableQuery);
            
            // Таблица истории ставок
            const createBidsTableQuery = `
                CREATE TABLE IF NOT EXISTS auction_bids (
                    id SERIAL PRIMARY KEY,
                    lot_number VARCHAR(50) NOT NULL,
                    auction_number VARCHAR(50) NOT NULL,
                    source_site VARCHAR(50) DEFAULT 'numismat.ru',
                    bidder_login VARCHAR(100) NOT NULL,
                    bid_amount DECIMAL(12, 2) NOT NULL,
                    bid_time TIMESTAMP NOT NULL,
                    bid_type VARCHAR(20) DEFAULT 'manual',
                    is_winning_bid BOOLEAN DEFAULT FALSE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(lot_number, auction_number, source_site, bidder_login, bid_time)
                );
            `;
            await this.dbClient.query(createBidsTableQuery);
            
        // Таблица сессий пользователей
        const createSessionsTableQuery = `
            CREATE TABLE IF NOT EXISTS user_sessions (
                id SERIAL PRIMARY KEY,
                bidder_login VARCHAR(100) NOT NULL,
                source_site VARCHAR(50) DEFAULT 'numismat.ru',
                session_id VARCHAR(100),
                ip_address INET,
                user_agent TEXT,
                first_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                total_bids INTEGER DEFAULT 0,
                is_active BOOLEAN DEFAULT TRUE
            );
        `;
            await this.dbClient.query(createSessionsTableQuery);
            
            // Создаем индексы для оптимизации
            const indexes = [
                'CREATE INDEX IF NOT EXISTS idx_auction_bids_lot_auction ON auction_bids(lot_number, auction_number, source_site)',
                'CREATE INDEX IF NOT EXISTS idx_auction_bids_bidder ON auction_bids(bidder_login)',
                'CREATE INDEX IF NOT EXISTS idx_auction_bids_time ON auction_bids(bid_time)',
                'CREATE INDEX IF NOT EXISTS idx_user_sessions_login ON user_sessions(bidder_login, source_site)',
                'CREATE INDEX IF NOT EXISTS idx_auction_lots_bidding_collected ON auction_lots(bidding_history_collected)'
            ];

            for (const indexQuery of indexes) {
                await this.dbClient.query(indexQuery);
            }
            
            console.log('✅ Таблицы созданы успешно');
        } catch (error) {
            console.error('❌ Ошибка создания таблиц:', error.message);
            throw error;
        }
    }

    async initBrowser() {
        console.log('🌐 Инициализация браузера...');
        
        try {
            this.browser = await puppeteer.launch({
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-gpu'
                ]
            });
            
            this.page = await this.browser.newPage();
            
            // Настройки для обхода защиты
            await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
            await this.page.setViewport({ width: 1920, height: 1080 });
            
            console.log('✅ Браузер инициализирован');
        } catch (error) {
            console.error('❌ Ошибка инициализации браузера:', error.message);
            throw error;
        }
    }

    /**
     * Парсинг лота с полной историей ставок
     */
    async parseLotWithBiddingHistory(lotUrl, auctionEndDate = null) {
        console.log(`🔍 Парсинг лота с историей ставок: ${lotUrl}`);
        
        try {
            await this.page.goto(lotUrl, { waitUntil: 'networkidle2', timeout: 30000 });
            await this.page.waitForTimeout(2000);
            
            // Собираем основную информацию о лоте
            const lotData = await this.page.evaluate(() => {
                const data = {};
                
                // Основная информация
                data.lotNumber = document.querySelector('.lot-number, .lot-id, [class*="lot"]')?.textContent?.trim();
                data.coinDescription = document.querySelector('.lot-description, .coin-description, .description')?.textContent?.trim();
                data.startingBid = document.querySelector('.starting-price, .min-price, .start-price')?.textContent?.replace(/[^\d.,]/g, '')?.replace(',', '.');
                data.winningBid = document.querySelector('.current-price, .highest-bid, .final-price')?.textContent?.replace(/[^\d.,]/g, '')?.replace(',', '.');
                data.winnerLogin = document.querySelector('.winner, .highest-bidder, .bidder')?.textContent?.trim();
                data.bidsCount = document.querySelector('.bids-count, .total-bids, .bid-count')?.textContent?.replace(/[^\d]/g, '');
                data.lotStatus = document.querySelector('.status, .lot-status')?.textContent?.trim();
                
                // Изображения
                const aversImg = document.querySelector('.avers-image, .obverse-image, [class*="avers"] img');
                const reversImg = document.querySelector('.revers-image, .reverse-image, [class*="revers"] img');
                
                data.aversImageUrl = aversImg?.src;
                data.reversImageUrl = reversImg?.src;
                
                // Дополнительные поля
                data.year = document.querySelector('.year, .date')?.textContent?.replace(/[^\d]/g, '');
                data.metal = document.querySelector('.metal, .material')?.textContent?.trim();
                data.condition = document.querySelector('.condition, .grade, .state')?.textContent?.trim();
                
                return data;
            });

            // Собираем историю ставок
            const biddingHistory = await this.page.evaluate(() => {
                const bids = [];
                
                // Различные селекторы для истории ставок
                const selectors = [
                    '.bid-history tr',
                    '.bids-list .bid-item',
                    '.history-item',
                    '.bid-row',
                    '.auction-history tr',
                    '.bidding-history tr',
                    'table tr[class*="bid"]',
                    '.lot-bids tr'
                ];
                
                let bidElements = [];
                for (const selector of selectors) {
                    const elements = document.querySelectorAll(selector);
                    if (elements.length > 0) {
                        bidElements = elements;
                        console.log(`Найдены элементы ставок с селектором: ${selector}`);
                        break;
                    }
                }
                
                if (bidElements.length === 0) {
                    console.log('История ставок не найдена');
                    return bids;
                }
                
                bidElements.forEach((element, index) => {
                    try {
                        const bidderElement = element.querySelector('.bidder, .user, .login, .bidder-name, td:nth-child(1)');
                        const amountElement = element.querySelector('.amount, .price, .bid-amount, .bid-value, td:nth-child(2)');
                        const timeElement = element.querySelector('.time, .date, .timestamp, .bid-time, td:nth-child(3)');
                        
                        if (bidderElement && amountElement) {
                            const bidder = bidderElement.textContent.trim();
                            const amount = amountElement.textContent.replace(/[^\d.,]/g, '').replace(',', '.');
                            const time = timeElement ? timeElement.textContent.trim() : new Date().toISOString();
                            
                            if (bidder && amount && !isNaN(parseFloat(amount))) {
                                bids.push({
                                    bidder: bidder,
                                    amount: parseFloat(amount),
                                    time: time,
                                    index: index
                                });
                            }
                        }
                    } catch (error) {
                        console.warn('Ошибка парсинга ставки:', error);
                    }
                });
                
                return bids;
            });

            // Сохраняем основную информацию о лоте
            await this.saveLotData(lotData, lotUrl, auctionEndDate);

            // Сохраняем историю ставок
            if (biddingHistory.length > 0) {
                await this.saveBiddingHistory(biddingHistory, lotData.lotNumber);
                this.biddingHistoryCollected++;
                console.log(`✅ Сохранено ${biddingHistory.length} ставок для лота ${lotData.lotNumber}`);
            } else {
                console.log(`⚠️ История ставок не найдена для лота ${lotData.lotNumber}`);
            }

            // Анализируем подозрительные паттерны
            if (biddingHistory.length > 0) {
                await this.analyzeLotSuspiciousPatterns(lotData.lotNumber, biddingHistory);
            }

            this.processed++;
            return lotData;

        } catch (error) {
            console.error(`❌ Ошибка парсинга лота: ${error.message}`);
            this.errors++;
            throw error;
        }
    }

    /**
     * Сохранение данных о лоте
     */
    async saveLotData(lotData, lotUrl, auctionEndDate) {
        const insertQuery = `
            INSERT INTO auction_lots (
                lot_number, auction_number, source_site, coin_description, 
                avers_image_url, revers_image_url,
                winner_login, winning_bid, starting_bid, auction_end_date, source_url,
                bids_count, lot_status, year, metal, condition,
                bidding_history_collected
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
            ON CONFLICT (lot_number, auction_number, source_site) 
            DO UPDATE SET
                coin_description = EXCLUDED.coin_description,
                winner_login = EXCLUDED.winner_login,
                winning_bid = EXCLUDED.winning_bid,
                starting_bid = EXCLUDED.starting_bid,
                auction_end_date = EXCLUDED.auction_end_date,
                bids_count = EXCLUDED.bids_count,
                lot_status = EXCLUDED.lot_status,
                year = EXCLUDED.year,
                metal = EXCLUDED.metal,
                condition = EXCLUDED.condition,
                bidding_history_collected = EXCLUDED.bidding_history_collected,
                parsed_at = CURRENT_TIMESTAMP
            RETURNING id;
        `;

        const values = [
            lotData.lotNumber || null,
            this.auctionNumber || null,
            this.sourceSite,
            lotData.coinDescription || null,
            lotData.aversImageUrl || null,
            lotData.reversImageUrl || null,
            lotData.winnerLogin || null,
            lotData.winningBid ? parseFloat(lotData.winningBid) : null,
            lotData.startingBid ? parseFloat(lotData.startingBid) : null,
            auctionEndDate || null,
            lotUrl || null,
            lotData.bidsCount ? parseInt(lotData.bidsCount) : null,
            lotData.lotStatus || null,
            lotData.year ? parseInt(lotData.year) : null,
            lotData.metal || null,
            lotData.condition || null,
            true // bidding_history_collected
        ];

        try {
            const result = await this.dbClient.query(insertQuery, values);
            return result.rows[0]?.id;
        } catch (error) {
            console.error('Ошибка сохранения данных лота:', error.message);
            throw error;
        }
    }

    /**
     * Сохранение истории ставок
     */
    async saveBiddingHistory(biddingHistory, lotNumber) {
        const insertQuery = `
            INSERT INTO auction_bids (
                lot_number, auction_number, source_site, bidder_login, 
                bid_amount, bid_time, bid_type, is_winning_bid
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (lot_number, auction_number, source_site, bidder_login, bid_time) 
            DO NOTHING
        `;

        for (const bid of biddingHistory) {
            try {
                await this.dbClient.query(insertQuery, [
                    lotNumber,
                    this.auctionNumber,
                    this.sourceSite,
                    bid.bidder,
                    bid.amount,
                    new Date(bid.time),
                    'manual', // По умолчанию
                    false // is_winning_bid - будет обновлено отдельно
                ]);
            } catch (error) {
                console.warn(`Ошибка сохранения ставки:`, error.message);
            }
        }

        // Отмечаем победившую ставку
        if (biddingHistory.length > 0) {
            const winningBid = biddingHistory[biddingHistory.length - 1];
            const updateWinningQuery = `
                UPDATE auction_bids 
                SET is_winning_bid = TRUE 
                WHERE lot_number = $1 AND auction_number = $2 AND source_site = $3 
                AND bidder_login = $4 AND bid_amount = $5
            `;
            
            try {
                await this.dbClient.query(updateWinningQuery, [
                    lotNumber,
                    this.auctionNumber,
                    this.sourceSite,
                    winningBid.bidder,
                    winningBid.amount
                ]);
            } catch (error) {
                console.warn('Ошибка обновления победившей ставки:', error.message);
            }
        }
    }

    /**
     * Анализ подозрительных паттернов для конкретного лота
     */
    async analyzeLotSuspiciousPatterns(lotNumber, biddingHistory) {
        if (biddingHistory.length < 3) return;

        const patterns = [];
        let suspicionScore = 0;

        // 1. Анализ скорости ставок
        const timeBetweenBids = [];
        for (let i = 1; i < biddingHistory.length; i++) {
            const timeDiff = new Date(biddingHistory[i].time) - new Date(biddingHistory[i-1].time);
            timeBetweenBids.push(timeDiff);
        }

        const avgTimeBetweenBids = timeBetweenBids.reduce((a, b) => a + b, 0) / timeBetweenBids.length;
        
        if (avgTimeBetweenBids < 10000) { // Менее 10 секунд
            suspicionScore += 20;
            patterns.push({
                type: 'rapid_bidding',
                description: `Быстрые ставки (среднее время: ${(avgTimeBetweenBids/1000).toFixed(1)}с)`,
                confidence: 20
            });
        }

        // 2. Анализ повторяющихся участников
        const bidderCounts = {};
        biddingHistory.forEach(bid => {
            bidderCounts[bid.bidder] = (bidderCounts[bid.bidder] || 0) + 1;
        });

        const maxBidsByOneUser = Math.max(...Object.values(bidderCounts));
        const totalBids = biddingHistory.length;
        
        if (maxBidsByOneUser / totalBids > 0.5) {
            suspicionScore += 30;
            patterns.push({
                type: 'dominant_bidder',
                description: `Доминирующий участник (${(maxBidsByOneUser/totalBids*100).toFixed(1)}% ставок)`,
                confidence: 30
            });
        }

        // 3. Анализ паттерна цен
        const prices = biddingHistory.map(bid => bid.amount);
        const priceIncreases = [];
        
        for (let i = 1; i < prices.length; i++) {
            const increase = (prices[i] - prices[i-1]) / prices[i-1] * 100;
            priceIncreases.push(increase);
        }

        const avgPriceIncrease = priceIncreases.reduce((a, b) => a + b, 0) / priceIncreases.length;
        
        if (avgPriceIncrease > 20) {
            suspicionScore += 25;
            patterns.push({
                type: 'aggressive_price_increase',
                description: `Агрессивный рост цен (${avgPriceIncrease.toFixed(1)}% за ставку)`,
                confidence: 25
            });
        }

        // Сохраняем результаты анализа
        if (patterns.length > 0) {
            await this.saveLotAnalysisResults(lotNumber, patterns, suspicionScore);
        }
    }

    /**
     * Сохранение результатов анализа лота
     */
    async saveLotAnalysisResults(lotNumber, patterns, suspicionScore) {
        const updateQuery = `
            UPDATE auction_lots 
            SET 
                suspicious_activity_score = $1,
                manipulation_indicators = $2
            WHERE lot_number = $3 AND auction_number = $4 AND source_site = $5
        `;

        try {
            await this.dbClient.query(updateQuery, [
                suspicionScore,
                JSON.stringify(patterns),
                lotNumber,
                this.auctionNumber,
                this.sourceSite
            ]);
        } catch (error) {
            console.error('Ошибка сохранения результатов анализа:', error.message);
        }
    }

    /**
     * Полный парсинг аукциона с историей ставок
     */
    async parseAuctionWithBiddingHistory() {
        console.log(`🚀 Начинаем парсинг аукциона ${this.auctionNumber} с историей ставок...`);
        
        try {
            // Подключение к БД
            this.dbClient = new Client(this.dbConfig);
            await this.dbClient.connect();
            
            // Получаем список лотов аукциона
            const auctionUrl = `https://www.numismat.ru/auction/${this.auctionNumber}`;
            await this.page.goto(auctionUrl, { waitUntil: 'networkidle2', timeout: 30000 });
            
            // Извлекаем ссылки на лоты
            const lotUrls = await this.page.evaluate(() => {
                const links = [];
                const lotLinks = document.querySelectorAll('a[href*="/lot/"], a[href*="/auction/"]');
                
                lotLinks.forEach(link => {
                    const href = link.getAttribute('href');
                    if (href && href.includes('/lot/')) {
                        links.push(href.startsWith('http') ? href : `https://www.numismat.ru${href}`);
                    }
                });
                
                return links;
            });

            console.log(`📋 Найдено ${lotUrls.length} лотов для парсинга`);

            // Парсим каждый лот
            for (let i = 0; i < lotUrls.length; i++) {
                const lotUrl = lotUrls[i];
                const lotNumber = lotUrl.split('/').pop();
                
                console.log(`\n📦 Парсинг лота ${i + 1}/${lotUrls.length}: ${lotNumber}`);
                
                try {
                    await this.parseLotWithBiddingHistory(lotUrl);
                    
                    // Задержка между запросами
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    
                } catch (error) {
                    console.error(`❌ Ошибка парсинга лота ${lotNumber}:`, error.message);
                    this.errors++;
                }
            }

            console.log('\n🎯 РЕЗУЛЬТАТЫ ПАРСИНГА:');
            console.log(`✅ Обработано лотов: ${this.processed}`);
            console.log(`📊 Собрано историй ставок: ${this.biddingHistoryCollected}`);
            console.log(`❌ Ошибок: ${this.errors}`);

            return {
                auctionNumber: this.auctionNumber,
                totalLots: lotUrls.length,
                processed: this.processed,
                biddingHistoryCollected: this.biddingHistoryCollected,
                errors: this.errors
            };

        } catch (error) {
            console.error(`❌ Ошибка парсинга аукциона ${this.auctionNumber}:`, error.message);
            throw error;
        } finally {
            if (this.dbClient) {
                await this.dbClient.end();
            }
        }
    }

    async close() {
        if (this.browser) {
            await this.browser.close();
        }
        console.log('🔒 Браузер закрыт');
    }
}

module.exports = NumismatParserWithBidding;

// Пример использования
if (require.main === module) {
    const dbConfig = {
        user: 'postgres.xkwgspqwebfeteoblayu',
        host: 'aws-0-eu-north-1.pooler.supabase.com',
        database: 'postgres',
        password: 'Gopapopa326+',
        port: 6543,
        ssl: { rejectUnauthorized: false }
    };

    async function runParserWithBidding() {
        const auctionNumber = process.argv[2] || '2133';
        const parser = new NumismatParserWithBidding(dbConfig, auctionNumber);
        
        try {
            await parser.init();
            const results = await parser.parseAuctionWithBiddingHistory();
            
            console.log('\n🎉 ПАРСИНГ ЗАВЕРШЕН УСПЕШНО!');
            console.log('Теперь можно запустить полный анализ поведения:');
            console.log('node enhanced-behavior-analyzer.js');
            
        } catch (error) {
            console.error('❌ Ошибка парсинга:', error.message);
        } finally {
            await parser.close();
        }
    }

    runParserWithBidding();
}

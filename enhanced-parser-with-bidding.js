/**
 * Улучшенный парсер с отслеживанием истории ставок
 * Интегрирует сбор полной истории ставок в существующий процесс парсинга
 */

const BiddingHistoryTracker = require('./bidding-history-tracker');
const { Pool } = require('pg');
const puppeteer = require('puppeteer');

class EnhancedParserWithBidding {
    constructor(dbConfig, auctionNumber) {
        this.dbConfig = dbConfig;
        this.auctionNumber = auctionNumber;
        this.db = new Pool(dbConfig);
        this.biddingTracker = new BiddingHistoryTracker(dbConfig);
        this.browser = null;
        this.page = null;
    }

    async init() {
        console.log(`🚀 Инициализация улучшенного парсера для аукциона ${this.auctionNumber}...`);
        
        await this.biddingTracker.init();
        await this.initBrowser();
        await this.createEnhancedTables();
    }

    async initBrowser() {
        console.log('🌐 Инициализация браузера...');
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
        
        await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        await this.page.setViewport({ width: 1920, height: 1080 });
        
        console.log('✅ Браузер инициализирован');
    }

    async createEnhancedTables() {
        console.log('📊 Создание улучшенных таблиц...');
        
        // Добавляем поля в существующую таблицу auction_lots
        const alterLotsTable = `
            ALTER TABLE auction_lots 
            ADD COLUMN IF NOT EXISTS bidding_history_collected BOOLEAN DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS suspicious_activity_score DECIMAL(5,2) DEFAULT 0,
            ADD COLUMN IF NOT EXISTS manipulation_indicators JSONB DEFAULT '{}'::jsonb;
        `;

        // Таблица для отслеживания прогресса сбора истории ставок
        const createProgressTable = `
            CREATE TABLE IF NOT EXISTS bidding_collection_progress (
                id SERIAL PRIMARY KEY,
                auction_number VARCHAR(50) NOT NULL,
                lot_number VARCHAR(50) NOT NULL,
                lot_url TEXT NOT NULL,
                bidding_history_collected BOOLEAN DEFAULT FALSE,
                bids_count INTEGER DEFAULT 0,
                collection_attempts INTEGER DEFAULT 0,
                last_attempt TIMESTAMP,
                error_message TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(auction_number, lot_number)
            );
        `;

        try {
            await this.db.query(alterLotsTable);
            await this.db.query(createProgressTable);
            console.log('✅ Улучшенные таблицы созданы');
        } catch (error) {
            console.error('❌ Ошибка создания таблиц:', error.message);
            throw error;
        }
    }

    /**
     * Парсинг лота с полной историей ставок
     */
    async parseLotWithBiddingHistory(lotUrl, lotNumber) {
        console.log(`🔍 Парсинг лота ${lotNumber} с историей ставок...`);
        
        try {
            // Проверяем, не собирали ли мы уже историю для этого лота
            const progressQuery = `
                SELECT bidding_history_collected, collection_attempts 
                FROM bidding_collection_progress 
                WHERE auction_number = $1 AND lot_number = $2
            `;
            
            const progressResult = await this.db.query(progressQuery, [this.auctionNumber, lotNumber]);
            
            if (progressResult.rows.length > 0 && progressResult.rows[0].bidding_history_collected) {
                console.log(`⏭️ История ставок для лота ${lotNumber} уже собрана`);
                return;
            }

            // Переходим на страницу лота
            await this.page.goto(lotUrl, { waitUntil: 'networkidle2', timeout: 30000 });
            await this.page.waitForTimeout(2000);

            // Собираем основную информацию о лоте
            const lotData = await this.page.evaluate(() => {
                const data = {};
                
                // Основная информация
                data.lotNumber = document.querySelector('.lot-number, .lot-id')?.textContent?.trim();
                data.description = document.querySelector('.lot-description, .coin-description')?.textContent?.trim();
                data.startingPrice = document.querySelector('.starting-price, .min-price')?.textContent?.replace(/[^\d.,]/g, '')?.replace(',', '.');
                data.currentPrice = document.querySelector('.current-price, .highest-bid')?.textContent?.replace(/[^\d.,]/g, '')?.replace(',', '.');
                data.winner = document.querySelector('.winner, .highest-bidder')?.textContent?.trim();
                data.bidsCount = document.querySelector('.bids-count, .total-bids')?.textContent?.replace(/[^\d]/g, '');
                
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
                    '.auction-history tr'
                ];
                
                let bidElements = [];
                for (const selector of selectors) {
                    const elements = document.querySelectorAll(selector);
                    if (elements.length > 0) {
                        bidElements = elements;
                        break;
                    }
                }
                
                bidElements.forEach((element, index) => {
                    try {
                        const bidderElement = element.querySelector('.bidder, .user, .login, .bidder-name');
                        const amountElement = element.querySelector('.amount, .price, .bid-amount, .bid-value');
                        const timeElement = element.querySelector('.time, .date, .timestamp, .bid-time');
                        
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
            await this.saveLotData(lotData, lotUrl);

            // Сохраняем историю ставок
            if (biddingHistory.length > 0) {
                await this.biddingTracker.saveBiddingHistory(biddingHistory, this.auctionNumber, lotNumber);
                console.log(`✅ Сохранено ${biddingHistory.length} ставок для лота ${lotNumber}`);
            }

            // Обновляем прогресс
            await this.updateCollectionProgress(lotNumber, lotUrl, true, biddingHistory.length);

            // Анализируем подозрительные паттерны для этого лота
            await this.analyzeLotSuspiciousPatterns(lotNumber, biddingHistory);

        } catch (error) {
            console.error(`❌ Ошибка парсинга лота ${lotNumber}:`, error.message);
            await this.updateCollectionProgress(lotNumber, lotUrl, false, 0, error.message);
        }
    }

    /**
     * Сохранение данных о лоте
     */
    async saveLotData(lotData, lotUrl) {
        const upsertQuery = `
            INSERT INTO auction_lots (
                lot_number, auction_number, coin_description, 
                starting_price, final_price, winner_login, 
                bids_count, source_url, bidding_history_collected
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (lot_number, auction_number) 
            DO UPDATE SET
                coin_description = EXCLUDED.coin_description,
                starting_price = EXCLUDED.starting_price,
                final_price = EXCLUDED.final_price,
                winner_login = EXCLUDED.winner_login,
                bids_count = EXCLUDED.bids_count,
                source_url = EXCLUDED.source_url,
                bidding_history_collected = EXCLUDED.bidding_history_collected,
                parsed_at = CURRENT_TIMESTAMP
        `;

        try {
            await this.db.query(upsertQuery, [
                lotData.lotNumber,
                this.auctionNumber,
                lotData.description,
                lotData.startingPrice ? parseFloat(lotData.startingPrice) : null,
                lotData.currentPrice ? parseFloat(lotData.currentPrice) : null,
                lotData.winner,
                lotData.bidsCount ? parseInt(lotData.bidsCount) : null,
                lotUrl,
                true
            ]);
        } catch (error) {
            console.error('Ошибка сохранения данных лота:', error.message);
        }
    }

    /**
     * Обновление прогресса сбора истории ставок
     */
    async updateCollectionProgress(lotNumber, lotUrl, success, bidsCount, errorMessage = null) {
        const upsertQuery = `
            INSERT INTO bidding_collection_progress (
                auction_number, lot_number, lot_url, 
                bidding_history_collected, bids_count, 
                collection_attempts, last_attempt, error_message
            ) VALUES ($1, $2, $3, $4, $5, 1, CURRENT_TIMESTAMP, $6)
            ON CONFLICT (auction_number, lot_number) 
            DO UPDATE SET
                bidding_history_collected = EXCLUDED.bidding_history_collected,
                bids_count = EXCLUDED.bids_count,
                collection_attempts = bidding_collection_progress.collection_attempts + 1,
                last_attempt = CURRENT_TIMESTAMP,
                error_message = EXCLUDED.error_message
        `;

        try {
            await this.db.query(upsertQuery, [
                this.auctionNumber,
                lotNumber,
                lotUrl,
                success,
                bidsCount,
                errorMessage
            ]);
        } catch (error) {
            console.error('Ошибка обновления прогресса:', error.message);
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
        
        // Если среднее время между ставками менее 10 секунд - подозрительно
        if (avgTimeBetweenBids < 10000) {
            suspicionScore += 20;
            patterns.push({
                type: 'rapid_bidding',
                description: `Быстрые ставки (среднее время: ${(avgTimeBetweenBids/1000).toFixed(1)}с)`,
                confidence: Math.min(20, suspicionScore)
            });
        }

        // 2. Анализ повторяющихся участников
        const bidderCounts = {};
        biddingHistory.forEach(bid => {
            bidderCounts[bid.bidder] = (bidderCounts[bid.bidder] || 0) + 1;
        });

        const maxBidsByOneUser = Math.max(...Object.values(bidderCounts));
        const totalBids = biddingHistory.length;
        
        // Если один пользователь сделал более 50% ставок - подозрительно
        if (maxBidsByOneUser / totalBids > 0.5) {
            suspicionScore += 30;
            patterns.push({
                type: 'dominant_bidder',
                description: `Доминирующий участник (${(maxBidsByOneUser/totalBids*100).toFixed(1)}% ставок)`,
                confidence: Math.min(30, suspicionScore)
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
        
        // Если средний рост цены более 20% за ставку - подозрительно
        if (avgPriceIncrease > 20) {
            suspicionScore += 25;
            patterns.push({
                type: 'aggressive_price_increase',
                description: `Агрессивный рост цен (${avgPriceIncrease.toFixed(1)}% за ставку)`,
                confidence: Math.min(25, suspicionScore)
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
            WHERE lot_number = $3 AND auction_number = $4
        `;

        try {
            await this.db.query(updateQuery, [
                suspicionScore,
                JSON.stringify(patterns),
                lotNumber,
                this.auctionNumber
            ]);
        } catch (error) {
            console.error('Ошибка сохранения результатов анализа:', error.message);
        }
    }

    /**
     * Полный парсинг аукциона с историей ставок
     */
    async parseAuctionWithBiddingHistory() {
        console.log(`🚀 Начинаем полный парсинг аукциона ${this.auctionNumber} с историей ставок...`);
        
        try {
            // Получаем список лотов аукциона
            const auctionUrl = `https://www.wolmar.ru/auction/${this.auctionNumber}`;
            await this.page.goto(auctionUrl, { waitUntil: 'networkidle2', timeout: 30000 });
            
            // Извлекаем ссылки на лоты
            const lotUrls = await this.page.evaluate(() => {
                const links = [];
                const lotLinks = document.querySelectorAll('a[href*="/lot/"], a[href*="/auction/"]');
                
                lotLinks.forEach(link => {
                    const href = link.getAttribute('href');
                    if (href && href.includes('/lot/')) {
                        links.push(href.startsWith('http') ? href : `https://www.wolmar.ru${href}`);
                    }
                });
                
                return links;
            });

            console.log(`📋 Найдено ${lotUrls.length} лотов для парсинга`);

            // Парсим каждый лот
            let successCount = 0;
            let errorCount = 0;

            for (let i = 0; i < lotUrls.length; i++) {
                const lotUrl = lotUrls[i];
                const lotNumber = lotUrl.split('/').pop();
                
                console.log(`\n📦 Парсинг лота ${i + 1}/${lotUrls.length}: ${lotNumber}`);
                
                try {
                    await this.parseLotWithBiddingHistory(lotUrl, lotNumber);
                    successCount++;
                } catch (error) {
                    console.error(`❌ Ошибка парсинга лота ${lotNumber}:`, error.message);
                    errorCount++;
                }

                // Задержка между запросами
                await new Promise(resolve => setTimeout(resolve, 2000));
            }

            // Финальный анализ подозрительных паттернов
            console.log('\n🔍 Запуск финального анализа подозрительных паттернов...');
            const suspiciousPatterns = await this.biddingTracker.analyzeSuspiciousPatterns(this.auctionNumber);
            
            // Генерируем отчет
            await this.biddingTracker.generateSuspiciousActivityReport(this.auctionNumber);

            console.log('\n🎯 РЕЗУЛЬТАТЫ ПАРСИНГА:');
            console.log(`✅ Успешно обработано: ${successCount} лотов`);
            console.log(`❌ Ошибок: ${errorCount} лотов`);
            console.log(`🔍 Подозрительных паттернов: ${suspiciousPatterns.length}`);

            return {
                auctionNumber: this.auctionNumber,
                totalLots: lotUrls.length,
                successCount,
                errorCount,
                suspiciousPatterns
            };

        } catch (error) {
            console.error(`❌ Ошибка парсинга аукциона ${this.auctionNumber}:`, error.message);
            throw error;
        }
    }

    async close() {
        if (this.browser) {
            await this.browser.close();
        }
        await this.db.end();
        await this.biddingTracker.close();
        console.log('🔒 Все соединения закрыты');
    }
}

module.exports = EnhancedParserWithBidding;

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

    async function runEnhancedParsing() {
        const auctionNumber = process.argv[2] || '2133';
        const parser = new EnhancedParserWithBidding(dbConfig, auctionNumber);
        
        try {
            await parser.init();
            const results = await parser.parseAuctionWithBiddingHistory();
            
            console.log('\n🎉 ПАРСИНГ ЗАВЕРШЕН УСПЕШНО!');
            console.log('Теперь можно запустить полный анализ поведения:');
            console.log('node run-auction-analysis.js');
            
        } catch (error) {
            console.error('❌ Ошибка парсинга:', error.message);
        } finally {
            await parser.close();
        }
    }

    runEnhancedParsing();
}

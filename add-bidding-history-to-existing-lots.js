/**
 * Скрипт для добавления истории ставок к уже существующим лотам в базе данных
 * Обрабатывает лоты, которые были спарсены без истории ставок
 */

const { Pool } = require('pg');
const puppeteer = require('puppeteer');

class BiddingHistoryRetroactiveCollector {
    constructor(dbConfig) {
        this.db = new Pool(dbConfig);
        this.browser = null;
        this.page = null;
        this.stats = {
            totalLots: 0,
            processed: 0,
            biddingHistoryCollected: 0,
            errors: 0,
            skipped: 0
        };
    }

    async init() {
        console.log('🔧 Инициализация коллектора истории ставок...');
        await this.checkDatabaseConnection();
        await this.createBiddingTables();
        await this.initBrowser();
    }

    async checkDatabaseConnection() {
        try {
            const result = await this.db.query('SELECT NOW()');
            console.log('✅ Подключение к БД установлено:', result.rows[0].now);
        } catch (error) {
            console.error('❌ Ошибка подключения к БД:', error.message);
            throw error;
        }
    }

    async createBiddingTables() {
        console.log('📊 Создание таблиц для истории ставок...');
        
        // Таблица истории ставок
        const createBidsTable = `
            CREATE TABLE IF NOT EXISTS auction_bids (
                id SERIAL PRIMARY KEY,
                lot_number VARCHAR(50) NOT NULL,
                auction_number VARCHAR(50) NOT NULL,
                source_site VARCHAR(50) DEFAULT 'wolmar.ru',
                bidder_login VARCHAR(100) NOT NULL,
                bid_amount DECIMAL(12, 2) NOT NULL,
                bid_time TIMESTAMP NOT NULL,
                bid_type VARCHAR(20) DEFAULT 'manual',
                is_winning_bid BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(lot_number, auction_number, source_site, bidder_login, bid_time)
            );
        `;

        // Таблица сессий пользователей
        const createSessionsTable = `
            CREATE TABLE IF NOT EXISTS user_sessions (
                id SERIAL PRIMARY KEY,
                user_login VARCHAR(100) NOT NULL,
                source_site VARCHAR(50) DEFAULT 'wolmar.ru',
                session_id VARCHAR(100),
                ip_address INET,
                user_agent TEXT,
                first_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                total_bids INTEGER DEFAULT 0,
                is_active BOOLEAN DEFAULT TRUE
            );
        `;

        // Добавляем поля в существующую таблицу auction_lots
        const alterLotsTable = `
            ALTER TABLE auction_lots 
            ADD COLUMN IF NOT EXISTS bidding_history_collected BOOLEAN DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS suspicious_activity_score DECIMAL(5,2) DEFAULT 0,
            ADD COLUMN IF NOT EXISTS manipulation_indicators JSONB DEFAULT '{}'::jsonb;
        `;

        // Таблица для отслеживания прогресса
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
            await this.db.query(createBidsTable);
            await this.db.query(createSessionsTable);
            await this.db.query(alterLotsTable);
            await this.db.query(createProgressTable);
            
            // Создаем индексы
            const indexes = [
                'CREATE INDEX IF NOT EXISTS idx_auction_bids_lot_auction ON auction_bids(lot_number, auction_number, source_site)',
                'CREATE INDEX IF NOT EXISTS idx_auction_bids_bidder ON auction_bids(bidder_login)',
                'CREATE INDEX IF NOT EXISTS idx_auction_bids_time ON auction_bids(bid_time)',
                'CREATE INDEX IF NOT EXISTS idx_user_sessions_login ON user_sessions(user_login, source_site)',
                'CREATE INDEX IF NOT EXISTS idx_auction_lots_bidding_collected ON auction_lots(bidding_history_collected)'
            ];

            for (const indexQuery of indexes) {
                await this.db.query(indexQuery);
            }
            
            console.log('✅ Таблицы для истории ставок созданы');
        } catch (error) {
            console.error('❌ Ошибка создания таблиц:', error.message);
            throw error;
        }
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

    /**
     * Получение списка лотов без истории ставок
     */
    async getLotsWithoutBiddingHistory(limit = 100, offset = 0) {
        const query = `
            SELECT 
                lot_number,
                auction_number,
                source_url,
                source_site,
                winner_login,
                winning_bid,
                bids_count
            FROM auction_lots 
            WHERE source_url IS NOT NULL 
            AND (bidding_history_collected IS NULL OR bidding_history_collected = FALSE)
            AND source_url LIKE '%wolmar.ru%'
            ORDER BY auction_number DESC, lot_number
            LIMIT $1 OFFSET $2
        `;

        const result = await this.db.query(query, [limit, offset]);
        return result.rows;
    }

    /**
     * Парсинг истории ставок для конкретного лота
     */
    async parseLotBiddingHistory(lotUrl, auctionNumber, lotNumber, sourceSite = 'wolmar.ru') {
        console.log(`🔍 Парсинг истории ставок для лота ${lotNumber}...`);
        
        try {
            // Проверяем, не собирали ли мы уже историю для этого лота
            const progressQuery = `
                SELECT bidding_history_collected, collection_attempts 
                FROM bidding_collection_progress 
                WHERE auction_number = $1 AND lot_number = $2
            `;
            
            const progressResult = await this.db.query(progressQuery, [auctionNumber, lotNumber]);
            
            if (progressResult.rows.length > 0 && progressResult.rows[0].bidding_history_collected) {
                console.log(`⏭️ История ставок для лота ${lotNumber} уже собрана`);
                this.stats.skipped++;
                return { success: true, bidsCount: 0, skipped: true };
            }

            await this.page.goto(lotUrl, { waitUntil: 'networkidle2', timeout: 30000 });
            await this.page.waitForTimeout(2000);
            
            // Извлекаем историю ставок
            const biddingHistory = await this.page.evaluate(() => {
                const bids = [];
                
                // Различные селекторы для истории ставок на Wolmar
                const selectors = [
                    '.bid-history tr',
                    '.bids-list .bid-item',
                    '.history-item',
                    '.bid-row',
                    '.auction-history tr',
                    '.bidding-history tr',
                    'table tr[class*="bid"]',
                    '.lot-bids tr',
                    '.bids-table tr',
                    '.auction-bids tr'
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

            // Сохраняем ставки в базу данных
            let bidsCount = 0;
            if (biddingHistory.length > 0) {
                bidsCount = await this.saveBiddingHistory(biddingHistory, auctionNumber, lotNumber, sourceSite);
                this.stats.biddingHistoryCollected++;
                console.log(`✅ Сохранено ${bidsCount} ставок для лота ${lotNumber}`);
            } else {
                console.log(`⚠️ История ставок не найдена для лота ${lotNumber}`);
            }

            // Обновляем прогресс
            await this.updateCollectionProgress(auctionNumber, lotNumber, lotUrl, true, bidsCount);

            // Обновляем флаг в основной таблице
            await this.updateLotBiddingFlag(auctionNumber, lotNumber, true);

            this.stats.processed++;
            return { success: true, bidsCount, skipped: false };

        } catch (error) {
            console.error(`❌ Ошибка парсинга истории ставок для лота ${lotNumber}:`, error.message);
            await this.updateCollectionProgress(auctionNumber, lotNumber, lotUrl, false, 0, error.message);
            this.stats.errors++;
            return { success: false, error: error.message };
        }
    }

    /**
     * Сохранение истории ставок в базу данных
     */
    async saveBiddingHistory(biddingHistory, auctionNumber, lotNumber, sourceSite) {
        const insertQuery = `
            INSERT INTO auction_bids (
                lot_number, auction_number, source_site, bidder_login, 
                bid_amount, bid_time, bid_type, is_winning_bid
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (lot_number, auction_number, source_site, bidder_login, bid_time) 
            DO NOTHING
        `;

        let savedCount = 0;
        for (const bid of biddingHistory) {
            try {
                await this.db.query(insertQuery, [
                    lotNumber,
                    auctionNumber,
                    sourceSite,
                    bid.bidder,
                    bid.amount,
                    new Date(bid.time),
                    'manual', // По умолчанию
                    false // is_winning_bid - будет обновлено отдельно
                ]);
                savedCount++;
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
                await this.db.query(updateWinningQuery, [
                    lotNumber,
                    auctionNumber,
                    sourceSite,
                    winningBid.bidder,
                    winningBid.amount
                ]);
            } catch (error) {
                console.warn('Ошибка обновления победившей ставки:', error.message);
            }
        }

        return savedCount;
    }

    /**
     * Обновление прогресса сбора истории ставок
     */
    async updateCollectionProgress(auctionNumber, lotNumber, lotUrl, success, bidsCount, errorMessage = null) {
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
                auctionNumber,
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
     * Обновление флага сбора истории ставок в основной таблице
     */
    async updateLotBiddingFlag(auctionNumber, lotNumber, collected) {
        const updateQuery = `
            UPDATE auction_lots 
            SET bidding_history_collected = $1
            WHERE auction_number = $2 AND lot_number = $3
        `;

        try {
            await this.db.query(updateQuery, [collected, auctionNumber, lotNumber]);
        } catch (error) {
            console.error('Ошибка обновления флага:', error.message);
        }
    }

    /**
     * Массовый сбор истории ставок для существующих лотов
     */
    async collectBiddingHistoryForExistingLots(batchSize = 50, maxLots = 1000) {
        console.log(`🚀 Начинаем сбор истории ставок для существующих лотов...`);
        console.log(`📊 Параметры: batchSize=${batchSize}, maxLots=${maxLots}`);
        
        let offset = 0;
        let totalProcessed = 0;

        while (totalProcessed < maxLots) {
            console.log(`\n📦 Обработка батча ${Math.floor(offset/batchSize) + 1}...`);
            
            const lots = await this.getLotsWithoutBiddingHistory(batchSize, offset);
            
            if (lots.length === 0) {
                console.log('✅ Все лоты обработаны!');
                break;
            }

            console.log(`📋 Найдено ${lots.length} лотов для обработки`);

            for (const lot of lots) {
                console.log(`\n🔍 Обработка лота ${lot.lot_number} (аукцион ${lot.auction_number})`);
                
                try {
                    const result = await this.parseLotBiddingHistory(
                        lot.source_url,
                        lot.auction_number,
                        lot.lot_number,
                        lot.source_site || 'wolmar.ru'
                    );

                    if (result.success && !result.skipped) {
                        console.log(`✅ Лот ${lot.lot_number}: собрано ${result.bidsCount} ставок`);
                    } else if (result.skipped) {
                        console.log(`⏭️ Лот ${lot.lot_number}: уже обработан`);
                    }

                    // Задержка между запросами
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    
                } catch (error) {
                    console.error(`❌ Ошибка обработки лота ${lot.lot_number}:`, error.message);
                }
            }

            offset += batchSize;
            totalProcessed += lots.length;

            // Показываем статистику
            console.log(`\n📊 Текущая статистика:`);
            console.log(`   Обработано лотов: ${this.stats.processed}`);
            console.log(`   Собрано историй ставок: ${this.stats.biddingHistoryCollected}`);
            console.log(`   Пропущено: ${this.stats.skipped}`);
            console.log(`   Ошибок: ${this.stats.errors}`);
        }

        return this.stats;
    }

    /**
     * Получение статистики по сбору истории ставок
     */
    async getCollectionStatistics() {
        const statsQuery = `
            SELECT 
                COUNT(*) as total_lots,
                COUNT(CASE WHEN bidding_history_collected = TRUE THEN 1 END) as with_bidding_history,
                COUNT(CASE WHEN bidding_history_collected = FALSE OR bidding_history_collected IS NULL THEN 1 END) as without_bidding_history
            FROM auction_lots
            WHERE source_url IS NOT NULL
        `;

        const progressQuery = `
            SELECT 
                COUNT(*) as total_attempts,
                COUNT(CASE WHEN bidding_history_collected = TRUE THEN 1 END) as successful_attempts,
                COUNT(CASE WHEN bidding_history_collected = FALSE THEN 1 END) as failed_attempts,
                AVG(bids_count) as avg_bids_per_lot
            FROM bidding_collection_progress
        `;

        const [statsResult, progressResult] = await Promise.all([
            this.db.query(statsQuery),
            this.db.query(progressQuery)
        ]);

        return {
            lots: statsResult.rows[0],
            progress: progressResult.rows[0]
        };
    }

    async close() {
        if (this.browser) {
            await this.browser.close();
        }
        await this.db.end();
        console.log('🔒 Соединения закрыты');
    }
}

module.exports = BiddingHistoryRetroactiveCollector;

// Запуск скрипта
if (require.main === module) {
    const dbConfig = {
        user: 'postgres.xkwgspqwebfeteoblayu',
        host: 'aws-0-eu-north-1.pooler.supabase.com',
        database: 'postgres',
        password: 'Gopapopa326+',
        port: 6543,
        ssl: { rejectUnauthorized: false }
    };

    async function runRetroactiveCollection() {
        const collector = new BiddingHistoryRetroactiveCollector(dbConfig);
        
        try {
            await collector.init();
            
            // Получаем параметры из командной строки
            const batchSize = parseInt(process.argv[2]) || 50;
            const maxLots = parseInt(process.argv[3]) || 1000;
            
            console.log(`🚀 Запуск сбора истории ставок для существующих лотов`);
            console.log(`📊 Параметры: batchSize=${batchSize}, maxLots=${maxLots}`);
            
            // Показываем текущую статистику
            const currentStats = await collector.getCollectionStatistics();
            console.log('\n📊 Текущая статистика:');
            console.log(`   Всего лотов: ${currentStats.lots.total_lots}`);
            console.log(`   С историей ставок: ${currentStats.lots.with_bidding_history}`);
            console.log(`   Без истории ставок: ${currentStats.lots.without_bidding_history}`);
            
            // Запускаем сбор
            const results = await collector.collectBiddingHistoryForExistingLots(batchSize, maxLots);
            
            // Показываем финальную статистику
            const finalStats = await collector.getCollectionStatistics();
            console.log('\n🎯 ФИНАЛЬНАЯ СТАТИСТИКА:');
            console.log(`   Обработано лотов: ${results.processed}`);
            console.log(`   Собрано историй ставок: ${results.biddingHistoryCollected}`);
            console.log(`   Пропущено: ${results.skipped}`);
            console.log(`   Ошибок: ${results.errors}`);
            console.log(`\n📊 Общая статистика в БД:`);
            console.log(`   Всего лотов: ${finalStats.lots.total_lots}`);
            console.log(`   С историей ставок: ${finalStats.lots.with_bidding_history}`);
            console.log(`   Без истории ставок: ${finalStats.lots.without_bidding_history}`);
            
            console.log('\n🎉 СБОР ИСТОРИИ СТАВОК ЗАВЕРШЕН!');
            console.log('Теперь можно запустить полный анализ поведения:');
            console.log('node enhanced-behavior-analyzer.js');
            
        } catch (error) {
            console.error('❌ Ошибка сбора истории ставок:', error.message);
        } finally {
            await collector.close();
        }
    }

    runRetroactiveCollection();
}

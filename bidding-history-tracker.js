/**
 * Система отслеживания истории ставок для анализа поведения на аукционе
 * Собирает полную историю всех ставок для выявления манипуляций
 */

const { Pool } = require('pg');
const puppeteer = require('puppeteer');

class BiddingHistoryTracker {
    constructor(dbConfig) {
        this.db = new Pool(dbConfig);
        this.browser = null;
        this.page = null;
    }

    async init() {
        console.log('🔍 Инициализация системы отслеживания ставок...');
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

    /**
     * Создание таблиц для хранения истории ставок
     */
    async createBiddingTables() {
        console.log('📊 Создание таблиц для истории ставок...');
        
        // Таблица истории ставок
        const createBidsTable = `
            CREATE TABLE IF NOT EXISTS auction_bids (
                id SERIAL PRIMARY KEY,
                lot_number VARCHAR(50) NOT NULL,
                auction_number VARCHAR(50) NOT NULL,
                bidder_login VARCHAR(100) NOT NULL,
                bid_amount DECIMAL(12, 2) NOT NULL,
                bid_time TIMESTAMP NOT NULL,
                bid_type VARCHAR(20) DEFAULT 'manual', -- manual, auto, sniper
                ip_address INET,
                user_agent TEXT,
                is_winning_bid BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(lot_number, auction_number, bidder_login, bid_time)
            );
        `;

        // Таблица сессий пользователей
        const createSessionsTable = `
            CREATE TABLE IF NOT EXISTS user_sessions (
                id SERIAL PRIMARY KEY,
                bidder_login VARCHAR(100) NOT NULL,
                session_id VARCHAR(100) NOT NULL,
                ip_address INET NOT NULL,
                user_agent TEXT,
                first_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                total_bids INTEGER DEFAULT 0,
                is_active BOOLEAN DEFAULT TRUE
            );
        `;

        // Таблица подозрительной активности
        const createSuspiciousActivityTable = `
            CREATE TABLE IF NOT EXISTS suspicious_activity (
                id SERIAL PRIMARY KEY,
                activity_type VARCHAR(50) NOT NULL, -- multiple_accounts, price_manipulation, etc.
                user_login VARCHAR(100),
                lot_number VARCHAR(50),
                auction_number VARCHAR(50),
                description TEXT,
                confidence_score DECIMAL(5, 2), -- 0-100
                evidence JSONB,
                detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                is_resolved BOOLEAN DEFAULT FALSE
            );
        `;

        try {
            await this.db.query(createBidsTable);
            await this.db.query(createSessionsTable);
            await this.db.query(createSuspiciousActivityTable);
            
            // Создаем индексы для оптимизации
            const indexes = [
                'CREATE INDEX IF NOT EXISTS idx_auction_bids_lot_auction ON auction_bids(lot_number, auction_number)',
                'CREATE INDEX IF NOT EXISTS idx_auction_bids_bidder ON auction_bids(bidder_login)',
                'CREATE INDEX IF NOT EXISTS idx_auction_bids_time ON auction_bids(bid_time)',
                'CREATE INDEX IF NOT EXISTS idx_user_sessions_login ON user_sessions(bidder_login)',
                'CREATE INDEX IF NOT EXISTS idx_user_sessions_ip ON user_sessions(ip_address)',
                'CREATE INDEX IF NOT EXISTS idx_suspicious_activity_type ON suspicious_activity(activity_type)'
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
        
        // Настройки для обхода защиты
        await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        await this.page.setViewport({ width: 1920, height: 1080 });
        
        console.log('✅ Браузер инициализирован');
    }

    /**
     * Парсинг истории ставок для конкретного лота
     */
    async parseLotBiddingHistory(lotUrl, auctionNumber, lotNumber) {
        console.log(`🔍 Парсинг истории ставок для лота ${lotNumber}...`);
        
        try {
            await this.page.goto(lotUrl, { waitUntil: 'networkidle2', timeout: 30000 });
            
            // Ждем загрузки страницы
            await this.page.waitForTimeout(2000);
            
            // Извлекаем историю ставок
            const biddingHistory = await this.page.evaluate(() => {
                const bids = [];
                
                // Ищем таблицу или список ставок
                const bidElements = document.querySelectorAll('.bid-history tr, .bids-list .bid-item, .history-item');
                
                bidElements.forEach((element, index) => {
                    try {
                        const bidderElement = element.querySelector('.bidder, .user, .login');
                        const amountElement = element.querySelector('.amount, .price, .bid-amount');
                        const timeElement = element.querySelector('.time, .date, .timestamp');
                        
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
            if (biddingHistory.length > 0) {
                await this.saveBiddingHistory(biddingHistory, auctionNumber, lotNumber);
                console.log(`✅ Сохранено ${biddingHistory.length} ставок для лота ${lotNumber}`);
            } else {
                console.log(`⚠️ История ставок не найдена для лота ${lotNumber}`);
            }

            return biddingHistory;

        } catch (error) {
            console.error(`❌ Ошибка парсинга истории ставок для лота ${lotNumber}:`, error.message);
            return [];
        }
    }

    /**
     * Сохранение истории ставок в базу данных
     */
    async saveBiddingHistory(bids, auctionNumber, lotNumber) {
        const insertQuery = `
            INSERT INTO auction_bids (
                lot_number, auction_number, bidder_login, bid_amount, bid_time, bid_type
            ) VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (lot_number, auction_number, bidder_login, bid_time) 
            DO NOTHING
        `;

        for (const bid of bids) {
            try {
                await this.db.query(insertQuery, [
                    lotNumber,
                    auctionNumber,
                    bid.bidder,
                    bid.amount,
                    new Date(bid.time),
                    'manual' // По умолчанию, можно улучшить детекцию
                ]);
            } catch (error) {
                console.warn(`Ошибка сохранения ставки:`, error.message);
            }
        }
    }

    /**
     * Анализ подозрительных паттернов в истории ставок
     */
    async analyzeSuspiciousPatterns(auctionNumber) {
        console.log(`🔍 Анализ подозрительных паттернов для аукциона ${auctionNumber}...`);
        
        const patterns = [];

        // 1. Анализ множественных аккаунтов (одинаковые IP)
        const multipleAccountsQuery = `
            WITH ip_analysis AS (
                SELECT 
                    ip_address,
                    COUNT(DISTINCT bidder_login) as unique_users,
                    COUNT(*) as total_bids
                FROM auction_bids ab
                JOIN user_sessions us ON ab.bidder_login = us.bidder_login
                WHERE ab.auction_number = $1
                GROUP BY ip_address
                HAVING COUNT(DISTINCT bidder_login) > 1
            )
            SELECT 
                ip_address,
                unique_users,
                total_bids,
                STRING_AGG(DISTINCT bidder_login, ', ') as users
            FROM ip_analysis
            WHERE unique_users >= 2
            ORDER BY unique_users DESC, total_bids DESC
        `;

        const multipleAccounts = await this.db.query(multipleAccountsQuery, [auctionNumber]);
        
        for (const account of multipleAccounts.rows) {
            patterns.push({
                type: 'multiple_accounts',
                description: `Множественные аккаунты с IP ${account.ip_address}`,
                users: account.users,
                confidence: Math.min(account.unique_users * 25, 100),
                evidence: {
                    ip_address: account.ip_address,
                    user_count: account.unique_users,
                    total_bids: account.total_bids
                }
            });
        }

        // 2. Анализ синхронных ставок
        const synchronousBidsQuery = `
            WITH bid_times AS (
                SELECT 
                    lot_number,
                    bidder_login,
                    bid_time,
                    LAG(bid_time) OVER (PARTITION BY lot_number ORDER BY bid_time) as prev_bid_time
                FROM auction_bids
                WHERE auction_number = $1
            )
            SELECT 
                lot_number,
                bidder_login,
                bid_time,
                prev_bid_time,
                EXTRACT(EPOCH FROM (bid_time - prev_bid_time)) as time_diff_seconds
            FROM bid_times
            WHERE prev_bid_time IS NOT NULL
            AND EXTRACT(EPOCH FROM (bid_time - prev_bid_time)) < 5 -- Менее 5 секунд
            ORDER BY time_diff_seconds ASC
        `;

        const synchronousBids = await this.db.query(synchronousBidsQuery, [auctionNumber]);
        
        if (synchronousBids.rows.length > 0) {
            patterns.push({
                type: 'synchronous_bidding',
                description: `Синхронные ставки (${synchronousBids.rows.length} случаев)`,
                confidence: Math.min(synchronousBids.rows.length * 10, 100),
                evidence: {
                    synchronous_count: synchronousBids.rows.length,
                    examples: synchronousBids.rows.slice(0, 5)
                }
            });
        }

        // 3. Анализ тактики "приманки"
        const baitingTacticsQuery = `
            WITH user_lot_stats AS (
                SELECT 
                    bidder_login,
                    lot_number,
                    COUNT(*) as bid_count,
                    MIN(bid_amount) as min_bid,
                    MAX(bid_amount) as max_bid,
                    AVG(bid_amount) as avg_bid
                FROM auction_bids
                WHERE auction_number = $1
                GROUP BY bidder_login, lot_number
                HAVING COUNT(*) >= 3
            )
            SELECT 
                bidder_login,
                lot_number,
                bid_count,
                min_bid,
                max_bid,
                avg_bid,
                (max_bid - min_bid) / min_bid * 100 as price_increase_pct
            FROM user_lot_stats
            WHERE (max_bid - min_bid) / min_bid * 100 > 200 -- Цена выросла более чем в 3 раза
            ORDER BY price_increase_pct DESC
        `;

        const baitingTactics = await this.db.query(baitingTacticsQuery, [auctionNumber]);
        
        for (const tactic of baitingTactics.rows) {
            patterns.push({
                type: 'baiting_tactics',
                description: `Тактика "приманки" - цена выросла на ${tactic.price_increase_pct.toFixed(1)}%`,
                user: tactic.bidder_login,
                lot: tactic.lot_number,
                confidence: Math.min(tactic.price_increase_pct / 5, 100),
                evidence: {
                    bid_count: tactic.bid_count,
                    min_bid: tactic.min_bid,
                    max_bid: tactic.max_bid,
                    price_increase_pct: tactic.price_increase_pct
                }
            });
        }

        // Сохраняем найденные паттерны
        await this.saveSuspiciousPatterns(patterns, auctionNumber);

        return patterns;
    }

    /**
     * Сохранение подозрительных паттернов
     */
    async saveSuspiciousPatterns(patterns, auctionNumber) {
        const insertQuery = `
            INSERT INTO suspicious_activity (
                activity_type, user_login, lot_number, auction_number, 
                description, confidence_score, evidence
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        `;

        for (const pattern of patterns) {
            try {
                await this.db.query(insertQuery, [
                    pattern.type,
                    pattern.user || null,
                    pattern.lot || null,
                    auctionNumber,
                    pattern.description,
                    pattern.confidence,
                    JSON.stringify(pattern.evidence)
                ]);
            } catch (error) {
                console.warn(`Ошибка сохранения паттерна:`, error.message);
            }
        }
    }

    /**
     * Полный анализ аукциона с историей ставок
     */
    async analyzeAuctionWithBiddingHistory(auctionNumber) {
        console.log(`🚀 Полный анализ аукциона ${auctionNumber} с историей ставок...`);
        
        try {
            // Получаем список лотов аукциона
            const lotsQuery = `
                SELECT lot_number, source_url 
                FROM auction_lots 
                WHERE auction_number = $1 
                AND source_url IS NOT NULL
            `;
            
            const lots = await this.db.query(lotsQuery, [auctionNumber]);
            console.log(`📋 Найдено ${lots.rows.length} лотов для анализа`);

            // Парсим историю ставок для каждого лота
            let totalBids = 0;
            for (const lot of lots.rows) {
                const bids = await this.parseLotBiddingHistory(
                    lot.source_url, 
                    auctionNumber, 
                    lot.lot_number
                );
                totalBids += bids.length;
                
                // Небольшая задержка между запросами
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            console.log(`✅ Всего собрано ${totalBids} ставок`);

            // Анализируем подозрительные паттерны
            const suspiciousPatterns = await this.analyzeSuspiciousPatterns(auctionNumber);
            
            console.log(`🔍 Найдено ${suspiciousPatterns.length} подозрительных паттернов`);

            return {
                auctionNumber,
                totalLots: lots.rows.length,
                totalBids,
                suspiciousPatterns
            };

        } catch (error) {
            console.error(`❌ Ошибка анализа аукциона ${auctionNumber}:`, error.message);
            throw error;
        }
    }

    /**
     * Генерация отчета по подозрительной активности
     */
    async generateSuspiciousActivityReport(auctionNumber) {
        const reportQuery = `
            SELECT 
                activity_type,
                COUNT(*) as pattern_count,
                AVG(confidence_score) as avg_confidence,
                MAX(confidence_score) as max_confidence
            FROM suspicious_activity
            WHERE auction_number = $1
            GROUP BY activity_type
            ORDER BY avg_confidence DESC
        `;

        const report = await this.db.query(reportQuery, [auctionNumber]);
        
        console.log(`\n📊 ОТЧЕТ ПО ПОДОЗРИТЕЛЬНОЙ АКТИВНОСТИ - АУКЦИОН ${auctionNumber}`);
        console.log('='.repeat(60));
        
        for (const row of report.rows) {
            console.log(`\n🔍 ${row.activity_type.toUpperCase()}:`);
            console.log(`   Количество случаев: ${row.pattern_count}`);
            console.log(`   Средняя уверенность: ${row.avg_confidence.toFixed(1)}%`);
            console.log(`   Максимальная уверенность: ${row.max_confidence.toFixed(1)}%`);
        }

        return report.rows;
    }

    async close() {
        if (this.browser) {
            await this.browser.close();
        }
        await this.db.end();
        console.log('🔒 Соединение с БД и браузер закрыты');
    }
}

module.exports = BiddingHistoryTracker;

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

    async function runBiddingAnalysis() {
        const tracker = new BiddingHistoryTracker(dbConfig);
        
        try {
            await tracker.init();
            
            // Анализ конкретного аукциона
            const auctionNumber = '2133'; // Замените на нужный номер
            const results = await tracker.analyzeAuctionWithBiddingHistory(auctionNumber);
            
            console.log('\n🎯 РЕЗУЛЬТАТЫ АНАЛИЗА:');
            console.log(`Аукцион: ${results.auctionNumber}`);
            console.log(`Лотов проанализировано: ${results.totalLots}`);
            console.log(`Ставок собрано: ${results.totalBids}`);
            console.log(`Подозрительных паттернов: ${results.suspiciousPatterns.length}`);
            
            // Генерируем отчет
            await tracker.generateSuspiciousActivityReport(auctionNumber);
            
        } catch (error) {
            console.error('❌ Ошибка анализа:', error.message);
        } finally {
            await tracker.close();
        }
    }

    runBiddingAnalysis();
}

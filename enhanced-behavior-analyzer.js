/**
 * Улучшенный анализатор поведения с поддержкой истории ставок
 * Может анализировать все 7 гипотез Анатолия QGL при наличии полных данных
 */

const { Pool } = require('pg');
const fs = require('fs').promises;

class EnhancedBehaviorAnalyzer {
    constructor(dbConfig) {
        this.db = new Pool(dbConfig);
        this.results = {
            // Основные гипотезы (работают с текущими данными)
            suspiciousSellers: [],
            priceManipulation: [],
            repeatedPurchases: [],
            
            // Расширенные гипотезы (требуют истории ставок)
            multipleAccounts: [],
            baitingTactics: [],
            synchronousBidding: [],
            autobidProbing: [],
            
            summary: {}
        };
    }

    async init() {
        console.log('🔍 Инициализация улучшенного анализатора поведения...');
        await this.checkDatabaseConnection();
        await this.checkDataAvailability();
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

    async checkDataAvailability() {
        console.log('📊 Проверка доступности данных...');
        
        // Проверяем наличие истории ставок
        const bidsCheck = await this.db.query('SELECT COUNT(*) as count FROM auction_bids LIMIT 1');
        const hasBiddingHistory = bidsCheck.rows[0].count > 0;
        
        // Проверяем наличие основных данных
        const lotsCheck = await this.db.query('SELECT COUNT(*) as count FROM auction_lots LIMIT 1');
        const hasLotsData = lotsCheck.rows[0].count > 0;
        
        console.log(`📋 Данные о лотах: ${hasLotsData ? '✅' : '❌'}`);
        console.log(`📊 История ставок: ${hasBiddingHistory ? '✅' : '❌'}`);
        
        if (hasBiddingHistory) {
            console.log('🎉 Полный анализ доступен - все 7 гипотез можно проверить!');
        } else {
            console.log('⚠️ Ограниченный анализ - доступны только 3 из 7 гипотез');
        }
        
        return { hasBiddingHistory, hasLotsData };
    }

    /**
     * 1. Анализ подозрительных продавцов (базовый)
     */
    async analyzeSuspiciousSellers() {
        console.log('\n📊 Анализ подозрительных продавцов...');
        
        const query = `
            WITH seller_stats AS (
                SELECT 
                    winner_nick,
                    COUNT(*) as total_wins,
                    AVG(final_price) as avg_price,
                    COUNT(DISTINCT auction_id) as auctions_participated,
                    COUNT(DISTINCT lot_category) as categories_bought,
                    ROUND(
                        COUNT(CASE WHEN final_price >= starting_price * 10 THEN 1 END) * 100.0 / COUNT(*), 2
                    ) as high_price_percentage
                FROM auction_lots 
                WHERE winner_nick IS NOT NULL 
                AND final_price > 0
                GROUP BY winner_nick
                HAVING COUNT(*) >= 10
            )
            SELECT 
                winner_nick,
                total_wins,
                ROUND(avg_price::numeric, 2) as avg_price,
                auctions_participated,
                categories_bought,
                high_price_percentage,
                CASE 
                    WHEN high_price_percentage > 70 AND categories_bought <= 3 THEN 'VERY_SUSPICIOUS'
                    WHEN high_price_percentage > 50 AND categories_bought <= 5 THEN 'SUSPICIOUS'
                    ELSE 'NORMAL'
                END as suspicion_level
            FROM seller_stats
            ORDER BY high_price_percentage DESC, total_wins DESC
            LIMIT 50;
        `;

        const result = await this.db.query(query);
        this.results.suspiciousSellers = result.rows;
        
        console.log(`✅ Найдено ${result.rows.length} подозрительных продавцов`);
        return result.rows;
    }

    /**
     * 2. Анализ манипуляций с ценами (базовый)
     */
    async analyzePriceManipulation() {
        console.log('\n💰 Анализ манипуляций с ценами...');
        
        const query = `
            WITH price_patterns AS (
                SELECT 
                    lot_id,
                    auction_id,
                    starting_price,
                    final_price,
                    winner_nick,
                    seller_nick,
                    ROUND((final_price::numeric / starting_price::numeric), 2) as price_multiplier
                FROM auction_lots
                WHERE final_price > starting_price * 5
                AND final_price > 100
            )
            SELECT 
                seller_nick,
                COUNT(*) as manipulated_lots,
                ROUND(AVG(price_multiplier)::numeric, 2) as avg_multiplier,
                ROUND(MAX(price_multiplier)::numeric, 2) as max_multiplier,
                COUNT(DISTINCT winner_nick) as unique_winners,
                CASE 
                    WHEN AVG(price_multiplier) > 20 AND COUNT(DISTINCT winner_nick) <= 3 THEN 'VERY_SUSPICIOUS'
                    WHEN AVG(price_multiplier) > 10 AND COUNT(DISTINCT winner_nick) <= 5 THEN 'SUSPICIOUS'
                    ELSE 'NORMAL'
                END as manipulation_level
            FROM price_patterns
            GROUP BY seller_nick
            HAVING COUNT(*) >= 5
            ORDER BY avg_multiplier DESC, manipulated_lots DESC
            LIMIT 30;
        `;

        const result = await this.db.query(query);
        this.results.priceManipulation = result.rows;
        
        console.log(`✅ Найдено ${result.rows.length} продавцов с подозрительной накруткой цен`);
        return result.rows;
    }

    /**
     * 3. Анализ повторных покупок (базовый)
     */
    async analyzeRepeatedPurchases() {
        console.log('\n🔄 Анализ повторных покупок...');
        
        const query = `
            WITH repeated_purchases AS (
                SELECT 
                    winner_nick,
                    lot_description,
                    lot_category,
                    COUNT(*) as purchase_count,
                    COUNT(DISTINCT auction_id) as auctions_participated,
                    AVG(final_price) as avg_price,
                    MIN(final_price) as min_price,
                    MAX(final_price) as max_price,
                    STRING_AGG(DISTINCT seller_nick, ', ') as sellers
                FROM auction_lots
                WHERE winner_nick IS NOT NULL
                AND lot_description IS NOT NULL
                AND final_price > 0
                GROUP BY winner_nick, lot_description, lot_category
                HAVING COUNT(*) >= 3
            )
            SELECT 
                winner_nick,
                lot_description,
                lot_category,
                purchase_count,
                auctions_participated,
                ROUND(avg_price::numeric, 2) as avg_price,
                ROUND(min_price::numeric, 2) as min_price,
                ROUND(max_price::numeric, 2) as max_price,
                sellers,
                CASE 
                    WHEN purchase_count >= 5 AND sellers LIKE '%,%' = false THEN 'VERY_SUSPICIOUS'
                    WHEN purchase_count >= 3 AND sellers LIKE '%,%' = false THEN 'SUSPICIOUS'
                    ELSE 'NORMAL'
                END as repetition_level
            FROM repeated_purchases
            ORDER BY purchase_count DESC, avg_price DESC
            LIMIT 50;
        `;

        const result = await this.db.query(query);
        this.results.repeatedPurchases = result.rows;
        
        console.log(`✅ Найдено ${result.rows.length} случаев повторных покупок`);
        return result.rows;
    }

    /**
     * 4. Анализ множественных аккаунтов (требует истории ставок)
     */
    async analyzeMultipleAccounts() {
        console.log('\n👥 Анализ множественных аккаунтов...');
        
        const query = `
            WITH ip_analysis AS (
                SELECT 
                    us.ip_address,
                    COUNT(DISTINCT ab.bidder_login) as unique_users,
                    COUNT(*) as total_bids,
                    STRING_AGG(DISTINCT ab.bidder_login, ', ') as users,
                    COUNT(DISTINCT ab.auction_number) as auctions_participated
                FROM auction_bids ab
                JOIN user_sessions us ON ab.bidder_login = us.bidder_login
                WHERE ab.bid_time >= NOW() - INTERVAL '6 months'
                GROUP BY us.ip_address
                HAVING COUNT(DISTINCT ab.bidder_login) > 1
            )
            SELECT 
                ip_address,
                unique_users,
                total_bids,
                users,
                auctions_participated,
                CASE 
                    WHEN unique_users >= 5 THEN 'VERY_SUSPICIOUS'
                    WHEN unique_users >= 3 THEN 'SUSPICIOUS'
                    ELSE 'NORMAL'
                END as suspicion_level
            FROM ip_analysis
            ORDER BY unique_users DESC, total_bids DESC
            LIMIT 50;
        `;

        try {
            const result = await this.db.query(query);
            this.results.multipleAccounts = result.rows;
            
            console.log(`✅ Найдено ${result.rows.length} подозрительных IP-адресов`);
            return result.rows;
        } catch (error) {
            console.log('⚠️ История ставок недоступна - пропускаем анализ множественных аккаунтов');
            return [];
        }
    }

    /**
     * 5. Анализ тактики "приманки" (требует истории ставок)
     */
    async analyzeBaitingTactics() {
        console.log('\n🎣 Анализ тактики "приманки"...');
        
        const query = `
            WITH user_lot_bidding AS (
                SELECT 
                    ab.bidder_login,
                    ab.lot_number,
                    ab.auction_number,
                    COUNT(*) as bid_count,
                    MIN(ab.bid_amount) as min_bid,
                    MAX(ab.bid_amount) as max_bid,
                    AVG(ab.bid_amount) as avg_bid,
                    MIN(ab.bid_time) as first_bid,
                    MAX(ab.bid_time) as last_bid
                FROM auction_bids ab
                WHERE ab.bid_time >= NOW() - INTERVAL '6 months'
                GROUP BY ab.bidder_login, ab.lot_number, ab.auction_number
                HAVING COUNT(*) >= 3
            )
            SELECT 
                bidder_login,
                lot_number,
                auction_number,
                bid_count,
                ROUND(min_bid::numeric, 2) as min_bid,
                ROUND(max_bid::numeric, 2) as max_bid,
                ROUND(avg_bid::numeric, 2) as avg_bid,
                ROUND((max_bid - min_bid) / min_bid * 100, 2) as price_increase_pct,
                first_bid,
                last_bid,
                CASE 
                    WHEN (max_bid - min_bid) / min_bid * 100 > 500 THEN 'VERY_SUSPICIOUS'
                    WHEN (max_bid - min_bid) / min_bid * 100 > 200 THEN 'SUSPICIOUS'
                    ELSE 'NORMAL'
                END as baiting_level
            FROM user_lot_bidding
            WHERE (max_bid - min_bid) / min_bid * 100 > 100
            ORDER BY price_increase_pct DESC
            LIMIT 50;
        `;

        try {
            const result = await this.db.query(query);
            this.results.baitingTactics = result.rows;
            
            console.log(`✅ Найдено ${result.rows.length} случаев тактики "приманки"`);
            return result.rows;
        } catch (error) {
            console.log('⚠️ История ставок недоступна - пропускаем анализ тактики "приманки"');
            return [];
        }
    }

    /**
     * 6. Анализ синхронных ставок (требует истории ставок)
     */
    async analyzeSynchronousBidding() {
        console.log('\n⏰ Анализ синхронных ставок...');
        
        const query = `
            WITH synchronous_bids AS (
                SELECT 
                    ab1.lot_number,
                    ab1.auction_number,
                    ab1.bidder_login as bidder1,
                    ab2.bidder_login as bidder2,
                    ab1.bid_time as time1,
                    ab2.bid_time as time2,
                    EXTRACT(EPOCH FROM (ab2.bid_time - ab1.bid_time)) as time_diff_seconds
                FROM auction_bids ab1
                JOIN auction_bids ab2 ON ab1.lot_number = ab2.lot_number 
                    AND ab1.auction_number = ab2.auction_number
                    AND ab1.bidder_login != ab2.bidder_login
                WHERE ab2.bid_time > ab1.bid_time
                AND EXTRACT(EPOCH FROM (ab2.bid_time - ab1.bid_time)) < 10
                AND ab1.bid_time >= NOW() - INTERVAL '6 months'
            )
            SELECT 
                lot_number,
                auction_number,
                bidder1,
                bidder2,
                time1,
                time2,
                ROUND(time_diff_seconds::numeric, 2) as time_diff_seconds,
                CASE 
                    WHEN time_diff_seconds < 2 THEN 'VERY_SUSPICIOUS'
                    WHEN time_diff_seconds < 5 THEN 'SUSPICIOUS'
                    ELSE 'NORMAL'
                END as sync_level
            FROM synchronous_bids
            ORDER BY time_diff_seconds ASC
            LIMIT 100;
        `;

        try {
            const result = await this.db.query(query);
            this.results.synchronousBidding = result.rows;
            
            console.log(`✅ Найдено ${result.rows.length} случаев синхронных ставок`);
            return result.rows;
        } catch (error) {
            console.log('⚠️ История ставок недоступна - пропускаем анализ синхронных ставок');
            return [];
        }
    }

    /**
     * 7. Анализ прощупывания автобидов (требует истории ставок)
     */
    async analyzeAutobidProbing() {
        console.log('\n🎯 Анализ прощупывания автобидов...');
        
        const query = `
            WITH autobid_patterns AS (
                SELECT 
                    ab.lot_number,
                    ab.auction_number,
                    ab.bidder_login,
                    ab.bid_amount,
                    ab.bid_time,
                    LAG(ab.bid_amount) OVER (PARTITION BY ab.lot_number, ab.auction_number ORDER BY ab.bid_time) as prev_bid,
                    LEAD(ab.bid_amount) OVER (PARTITION BY ab.lot_number, ab.auction_number ORDER BY ab.bid_time) as next_bid
                FROM auction_bids ab
                WHERE ab.bid_time >= NOW() - INTERVAL '6 months'
            )
            SELECT 
                lot_number,
                auction_number,
                bidder_login,
                ROUND(bid_amount::numeric, 2) as bid_amount,
                bid_time,
                ROUND(prev_bid::numeric, 2) as prev_bid,
                ROUND(next_bid::numeric, 2) as next_bid,
                CASE 
                    WHEN next_bid IS NOT NULL AND (next_bid - bid_amount) / bid_amount * 100 > 50 THEN 'VERY_SUSPICIOUS'
                    WHEN next_bid IS NOT NULL AND (next_bid - bid_amount) / bid_amount * 100 > 20 THEN 'SUSPICIOUS'
                    ELSE 'NORMAL'
                END as probing_level
            FROM autobid_patterns
            WHERE next_bid IS NOT NULL
            AND (next_bid - bid_amount) / bid_amount * 100 > 10
            ORDER BY (next_bid - bid_amount) / bid_amount * 100 DESC
            LIMIT 50;
        `;

        try {
            const result = await this.db.query(query);
            this.results.autobidProbing = result.rows;
            
            console.log(`✅ Найдено ${result.rows.length} случаев прощупывания автобидов`);
            return result.rows;
        } catch (error) {
            console.log('⚠️ История ставок недоступна - пропускаем анализ прощупывания автобидов');
            return [];
        }
    }

    /**
     * Комплексный анализ всех гипотез
     */
    async runComprehensiveAnalysis() {
        console.log('\n🚀 Запуск комплексного анализа поведения...');
        
        // Проверяем доступность данных
        const { hasBiddingHistory } = await this.checkDataAvailability();
        
        // Базовые анализы (всегда доступны)
        await this.analyzeSuspiciousSellers();
        await this.analyzePriceManipulation();
        await this.analyzeRepeatedPurchases();
        
        // Расширенные анализы (требуют истории ставок)
        if (hasBiddingHistory) {
            await this.analyzeMultipleAccounts();
            await this.analyzeBaitingTactics();
            await this.analyzeSynchronousBidding();
            await this.analyzeAutobidProbing();
        }

        // Создаем сводку
        this.results.summary = {
            analysisDate: new Date().toISOString(),
            hasBiddingHistory,
            hypotheses: {
                suspiciousSellers: this.results.suspiciousSellers.filter(s => s.suspicion_level !== 'NORMAL').length > 0 ? 'CONFIRMED' : 'NOT_CONFIRMED',
                priceManipulation: this.results.priceManipulation.filter(p => p.manipulation_level !== 'NORMAL').length > 0 ? 'CONFIRMED' : 'NOT_CONFIRMED',
                repeatedPurchases: this.results.repeatedPurchases.filter(r => r.repetition_level !== 'NORMAL').length > 0 ? 'CONFIRMED' : 'NOT_CONFIRMED',
                multipleAccounts: hasBiddingHistory ? (this.results.multipleAccounts.filter(m => m.suspicion_level !== 'NORMAL').length > 0 ? 'CONFIRMED' : 'NOT_CONFIRMED') : 'NO_DATA',
                baitingTactics: hasBiddingHistory ? (this.results.baitingTactics.filter(b => b.baiting_level !== 'NORMAL').length > 0 ? 'CONFIRMED' : 'NOT_CONFIRMED') : 'NO_DATA',
                synchronousBidding: hasBiddingHistory ? (this.results.synchronousBidding.filter(s => s.sync_level !== 'NORMAL').length > 0 ? 'CONFIRMED' : 'NOT_CONFIRMED') : 'NO_DATA',
                autobidProbing: hasBiddingHistory ? (this.results.autobidProbing.filter(a => a.probing_level !== 'NORMAL').length > 0 ? 'CONFIRMED' : 'NOT_CONFIRMED') : 'NO_DATA'
            },
            statistics: {
                suspiciousSellers: this.results.suspiciousSellers.length,
                priceManipulators: this.results.priceManipulation.length,
                repeatedPurchases: this.results.repeatedPurchases.length,
                multipleAccounts: this.results.multipleAccounts.length,
                baitingCases: this.results.baitingTactics.length,
                synchronousBids: this.results.synchronousBidding.length,
                autobidProbing: this.results.autobidProbing.length
            }
        };

        // Сохраняем результаты
        await this.saveResults();
        
        return this.results;
    }

    async saveResults() {
        const filename = `enhanced-behavior-analysis-${new Date().toISOString().split('T')[0]}.json`;
        await fs.writeFile(filename, JSON.stringify(this.results, null, 2));
        console.log(`💾 Результаты сохранены в файл: ${filename}`);
    }

    async close() {
        await this.db.end();
        console.log('🔒 Соединение с БД закрыто');
    }
}

module.exports = EnhancedBehaviorAnalyzer;

// Запуск анализа
if (require.main === module) {
    const dbConfig = {
        user: 'postgres.xkwgspqwebfeteoblayu',
        host: 'sup.begemot26.ru',
        database: 'postgres',
        password: 'Gopapopa326+',
        port: 6543,
        ssl: { rejectUnauthorized: false }
    };

    async function runEnhancedAnalysis() {
        const analyzer = new EnhancedBehaviorAnalyzer(dbConfig);
        
        try {
            await analyzer.init();
            const results = await analyzer.runComprehensiveAnalysis();
            
            console.log('\n🎯 РЕЗУЛЬТАТЫ УЛУЧШЕННОГО АНАЛИЗА:');
            console.log('=====================================');
            
            console.log('\n📊 СТАТУС ГИПОТЕЗ АНАТОЛИЯ QGL:');
            Object.entries(results.summary.hypotheses).forEach(([hypothesis, status]) => {
                const emoji = status === 'CONFIRMED' ? '✅' : status === 'NOT_CONFIRMED' ? '❌' : '⚠️';
                console.log(`${emoji} ${hypothesis}: ${status}`);
            });
            
            console.log('\n📈 СТАТИСТИКА:');
            Object.entries(results.summary.statistics).forEach(([metric, count]) => {
                console.log(`   ${metric}: ${count}`);
            });
            
        } catch (error) {
            console.error('❌ Ошибка анализа:', error.message);
        } finally {
            await analyzer.close();
        }
    }

    runEnhancedAnalysis();
}

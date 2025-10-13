/**
 * Исправленный анализатор поведения аукциона
 * Использует правильные названия полей из реальной структуры таблицы
 */

const { Pool } = require('pg');

class AuctionBehaviorAnalyzer {
    constructor(dbConfig) {
        this.db = new Pool(dbConfig);
    }

    async init() {
        console.log('🔍 Инициализация анализатора поведения аукциона...');
        await this.checkDatabaseConnection();
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
     * 1. Анализ подозрительных продавцов
     */
    async analyzeSuspiciousSellers() {
        console.log('\n📊 Анализ подозрительных продавцов...');
        
        const query = `
            WITH seller_stats AS (
                SELECT 
                    winner_login,
                    COUNT(*) as total_wins,
                    AVG(winning_bid) as avg_price,
                    COUNT(DISTINCT auction_number) as auctions_participated,
                    COUNT(DISTINCT metal) as categories_bought,
                    -- Процент лотов, купленных по максимальной цене
                    ROUND(
                        COUNT(CASE WHEN winning_bid >= 1000 THEN 1 END) * 100.0 / COUNT(*), 2
                    ) as high_price_percentage
                FROM auction_lots 
                WHERE winner_login IS NOT NULL 
                AND winning_bid > 0
                GROUP BY winner_login
                HAVING COUNT(*) >= 10  -- Минимум 10 покупок для анализа
            )
            SELECT 
                winner_login,
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
        console.log(`✅ Найдено ${result.rows.length} подозрительных продавцов`);
        return result.rows;
    }

    /**
     * 2. Анализ манипуляций с ценами
     */
    async analyzePriceManipulation() {
        console.log('\n💰 Анализ манипуляций с ценами...');
        
        const query = `
            WITH price_patterns AS (
                SELECT 
                    lot_number,
                    auction_number,
                    winning_bid,
                    winner_login,
                    -- Время последней ставки (если есть данные)
                    parsed_at
                FROM auction_lots
                WHERE winning_bid > 1000  -- Высокая цена
                AND winning_bid > 100  -- Минимум 100 рублей
            )
            SELECT 
                winner_login,
                COUNT(*) as manipulated_lots,
                ROUND(AVG(winning_bid)::numeric, 2) as avg_price,
                ROUND(MAX(winning_bid)::numeric, 2) as max_price,
                COUNT(DISTINCT auction_number) as unique_auctions,
                CASE 
                    WHEN AVG(winning_bid) > 5000 AND COUNT(DISTINCT auction_number) <= 3 THEN 'VERY_SUSPICIOUS'
                    WHEN AVG(winning_bid) > 2000 AND COUNT(DISTINCT auction_number) <= 5 THEN 'SUSPICIOUS'
                    ELSE 'NORMAL'
                END as manipulation_level
            FROM price_patterns
            GROUP BY winner_login
            HAVING COUNT(*) >= 5
            ORDER BY avg_price DESC, manipulated_lots DESC
            LIMIT 30;
        `;

        const result = await this.db.query(query);
        console.log(`✅ Найдено ${result.rows.length} продавцов с подозрительной накруткой цен`);
        return result.rows;
    }

    /**
     * 3. Анализ повторных покупок
     */
    async analyzeRepeatedPurchases() {
        console.log('\n🔄 Анализ повторных покупок...');
        
        const query = `
            WITH repeated_purchases AS (
                SELECT 
                    winner_login,
                    coin_description,
                    metal,
                    COUNT(*) as purchase_count,
                    COUNT(DISTINCT auction_number) as auctions_participated,
                    AVG(winning_bid) as avg_price,
                    MIN(winning_bid) as min_price,
                    MAX(winning_bid) as max_price
                FROM auction_lots
                WHERE winner_login IS NOT NULL
                AND coin_description IS NOT NULL
                AND winning_bid > 0
                GROUP BY winner_login, coin_description, metal
                HAVING COUNT(*) >= 3  -- Минимум 3 покупки одинакового лота
            )
            SELECT 
                winner_login,
                coin_description,
                metal,
                purchase_count,
                auctions_participated,
                ROUND(avg_price::numeric, 2) as avg_price,
                ROUND(min_price::numeric, 2) as min_price,
                ROUND(max_price::numeric, 2) as max_price,
                CASE 
                    WHEN purchase_count >= 5 THEN 'VERY_SUSPICIOUS'
                    WHEN purchase_count >= 3 THEN 'SUSPICIOUS'
                    ELSE 'NORMAL'
                END as repetition_level
            FROM repeated_purchases
            ORDER BY purchase_count DESC, avg_price DESC
            LIMIT 50;
        `;

        const result = await this.db.query(query);
        console.log(`✅ Найдено ${result.rows.length} случаев повторных покупок`);
        return result.rows;
    }

    /**
     * 4. Анализ доминирующих покупателей
     */
    async analyzeDominantBuyers() {
        console.log('\n🏆 Анализ доминирующих покупателей...');
        
        const query = `
            WITH buyer_patterns AS (
                SELECT 
                    winner_login,
                    COUNT(*) as total_purchases,
                    AVG(winning_bid) as avg_purchase_price,
                    COUNT(DISTINCT auction_number) as auctions_participated,
                    COUNT(DISTINCT metal) as categories_bought,
                    -- Вариация цен (стандартное отклонение)
                    ROUND(
                        STDDEV(winning_bid) / AVG(winning_bid) * 100, 2
                    ) as price_variation_percent
                FROM auction_lots
                WHERE winner_login IS NOT NULL
                AND winning_bid > 0
                GROUP BY winner_login
                HAVING COUNT(*) >= 5  -- Минимум 5 покупок
            )
            SELECT 
                winner_login,
                total_purchases,
                ROUND(avg_purchase_price::numeric, 2) as avg_purchase_price,
                auctions_participated,
                categories_bought,
                price_variation_percent,
                CASE 
                    WHEN total_purchases >= 50 AND price_variation_percent < 20 THEN 'VERY_SUSPICIOUS'
                    WHEN total_purchases >= 20 AND price_variation_percent < 30 THEN 'SUSPICIOUS'
                    ELSE 'NORMAL'
                END as dominance_level
            FROM buyer_patterns
            ORDER BY total_purchases DESC, avg_purchase_price DESC
            LIMIT 30;
        `;

        const result = await this.db.query(query);
        console.log(`✅ Найдено ${result.rows.length} доминирующих покупателей`);
        return result.rows;
    }

    /**
     * Комплексный анализ всех паттернов
     */
    async runComprehensiveAnalysis() {
        console.log('\n🚀 Запуск комплексного анализа поведения...');
        
        const results = {
            suspiciousSellers: await this.analyzeSuspiciousSellers(),
            priceManipulation: await this.analyzePriceManipulation(),
            repeatedPurchases: await this.analyzeRepeatedPurchases(),
            dominantBuyers: await this.analyzeDominantBuyers(),
            summary: {}
        };

        // Создаем сводку
        results.summary = {
            analysisDate: new Date().toISOString(),
            suspiciousSellers: results.suspiciousSellers.filter(s => s.suspicion_level !== 'NORMAL').length,
            priceManipulators: results.priceManipulation.filter(p => p.manipulation_level !== 'NORMAL').length,
            repeatedPurchases: results.repeatedPurchases.filter(r => r.repetition_level !== 'NORMAL').length,
            dominantBuyers: results.dominantBuyers.filter(d => d.dominance_level !== 'NORMAL').length
        };

        console.log('\n🎯 РЕЗУЛЬТАТЫ АНАЛИЗА:');
        console.log(`   Подозрительных продавцов: ${results.summary.suspiciousSellers}`);
        console.log(`   Манипуляторов цен: ${results.summary.priceManipulators}`);
        console.log(`   Повторных покупок: ${results.summary.repeatedPurchases}`);
        console.log(`   Доминирующих покупателей: ${results.summary.dominantBuyers}`);

        return results;
    }

    async close() {
        await this.db.end();
        console.log('🔒 Соединение с БД закрыто');
    }
}

module.exports = AuctionBehaviorAnalyzer;

// Запуск анализа
if (require.main === module) {
    const dbConfig = {
        user: 'postgres.xkwgspqwebfeteoblayu',
        host: 'aws-0-eu-north-1.pooler.supabase.com',
        database: 'postgres',
        password: 'Gopapopa326+',
        port: 6543,
        ssl: { rejectUnauthorized: false }
    };

    async function runAnalysis() {
        const analyzer = new AuctionBehaviorAnalyzer(dbConfig);
        
        try {
            await analyzer.init();
            const results = await analyzer.runComprehensiveAnalysis();
            
            console.log('\n🎉 АНАЛИЗ ЗАВЕРШЕН!');
            
        } catch (error) {
            console.error('❌ Ошибка анализа:', error.message);
        } finally {
            await analyzer.close();
        }
    }

    runAnalysis();
}

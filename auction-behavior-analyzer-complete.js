/**
 * Полный анализатор поведения аукциона
 * Использует ВСЕ доступные поля из реальной структуры таблицы
 */

const { Pool } = require('pg');

class CompleteAuctionBehaviorAnalyzer {
    constructor(dbConfig) {
        this.db = new Pool(dbConfig);
    }

    async init() {
        console.log('🔍 Инициализация полного анализатора поведения аукциона...');
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
     * 1. Анализ подозрительных покупателей (доминирующие победители)
     */
    async analyzeSuspiciousBuyers() {
        console.log('\n📊 Анализ подозрительных покупателей...');
        
        const query = `
            WITH buyer_stats AS (
                SELECT 
                    winner_login,
                    COUNT(*) as total_wins,
                    AVG(winning_bid) as avg_price,
                    COUNT(DISTINCT auction_number) as auctions_participated,
                    COUNT(DISTINCT category) as categories_bought,
                    COUNT(DISTINCT metal) as metals_bought,
                    -- Процент лотов с высокой ценой
                    ROUND(
                        COUNT(CASE WHEN winning_bid >= 5000 THEN 1 END) * 100.0 / COUNT(*), 2
                    ) as high_price_percentage,
                    -- Процент лотов с высокой конкуренцией
                    ROUND(
                        COUNT(CASE WHEN bids_count >= 10 THEN 1 END) * 100.0 / COUNT(*), 2
                    ) as high_competition_percentage
                FROM auction_lots 
                WHERE winner_login IS NOT NULL 
                AND winning_bid > 0
                AND bidding_history_collected = false  -- Только лоты без истории ставок
                GROUP BY winner_login
                HAVING COUNT(*) >= 10  -- Минимум 10 покупок для анализа
            )
            SELECT 
                winner_login,
                total_wins,
                ROUND(avg_price::numeric, 2) as avg_price,
                auctions_participated,
                categories_bought,
                metals_bought,
                high_price_percentage,
                high_competition_percentage,
                CASE 
                    WHEN high_price_percentage > 70 AND categories_bought <= 3 THEN 'VERY_SUSPICIOUS'
                    WHEN high_price_percentage > 50 AND categories_bought <= 5 THEN 'SUSPICIOUS'
                    WHEN total_wins >= 50 AND high_competition_percentage < 30 THEN 'DOMINANT_BUYER'
                    ELSE 'NORMAL'
                END as suspicion_level
            FROM buyer_stats
            ORDER BY high_price_percentage DESC, total_wins DESC
            LIMIT 50;
        `;

        const result = await this.db.query(query);
        console.log(`✅ Найдено ${result.rows.length} подозрительных покупателей`);
        return result.rows;
    }

    /**
     * 2. Анализ манипуляций с ценами (если есть starting_bid)
     */
    async analyzePriceManipulation() {
        console.log('\n💰 Анализ манипуляций с ценами...');
        
        const query = `
            WITH price_patterns AS (
                SELECT 
                    lot_number,
                    auction_number,
                    winner_login,
                    starting_bid,
                    winning_bid,
                    bids_count,
                    category,
                    metal,
                    -- Коэффициент накрутки
                    CASE 
                        WHEN starting_bid > 0 THEN ROUND((winning_bid / starting_bid)::numeric, 2)
                        ELSE NULL
                    END as price_multiplier
                FROM auction_lots
                WHERE winner_login IS NOT NULL
                AND winning_bid > 0
                AND starting_bid IS NOT NULL
                AND starting_bid > 0
                AND winning_bid > starting_bid * 3  -- Цена выросла в 3+ раз
            )
            SELECT 
                winner_login,
                COUNT(*) as manipulated_lots,
                ROUND(AVG(price_multiplier)::numeric, 2) as avg_multiplier,
                ROUND(MAX(price_multiplier)::numeric, 2) as max_multiplier,
                ROUND(AVG(winning_bid)::numeric, 2) as avg_final_price,
                ROUND(AVG(bids_count)::numeric, 1) as avg_competition,
                COUNT(DISTINCT category) as categories_manipulated,
                CASE 
                    WHEN AVG(price_multiplier) > 10 AND COUNT(DISTINCT category) <= 2 THEN 'VERY_SUSPICIOUS'
                    WHEN AVG(price_multiplier) > 5 AND COUNT(DISTINCT category) <= 3 THEN 'SUSPICIOUS'
                    ELSE 'NORMAL'
                END as manipulation_level
            FROM price_patterns
            GROUP BY winner_login
            HAVING COUNT(*) >= 3
            ORDER BY avg_multiplier DESC, manipulated_lots DESC
            LIMIT 30;
        `;

        const result = await this.db.query(query);
        console.log(`✅ Найдено ${result.rows.length} случаев манипуляций с ценами`);
        return result.rows;
    }

    /**
     * 3. Анализ повторных покупок одинаковых монет
     */
    async analyzeRepeatedPurchases() {
        console.log('\n🔄 Анализ повторных покупок...');
        
        const query = `
            WITH repeated_purchases AS (
                SELECT 
                    winner_login,
                    coin_description,
                    category,
                    metal,
                    year,
                    COUNT(*) as purchase_count,
                    COUNT(DISTINCT auction_number) as auctions_participated,
                    AVG(winning_bid) as avg_price,
                    MIN(winning_bid) as min_price,
                    MAX(winning_bid) as max_price,
                    AVG(bids_count) as avg_competition,
                    -- Временной промежуток между покупками
                    MIN(auction_end_date) as first_purchase,
                    MAX(auction_end_date) as last_purchase
                FROM auction_lots
                WHERE winner_login IS NOT NULL
                AND coin_description IS NOT NULL
                AND winning_bid > 0
                GROUP BY winner_login, coin_description, category, metal, year
                HAVING COUNT(*) >= 3  -- Минимум 3 покупки одинакового лота
            )
            SELECT 
                winner_login,
                coin_description,
                category,
                metal,
                year,
                purchase_count,
                auctions_participated,
                ROUND(avg_price::numeric, 2) as avg_price,
                ROUND(min_price::numeric, 2) as min_price,
                ROUND(max_price::numeric, 2) as max_price,
                ROUND(avg_competition::numeric, 1) as avg_competition,
                first_purchase,
                last_purchase,
                -- Разброс цен
                ROUND(((max_price - min_price) / min_price * 100)::numeric, 1) as price_variation_pct,
                CASE 
                    WHEN purchase_count >= 5 AND avg_competition < 5 THEN 'VERY_SUSPICIOUS'
                    WHEN purchase_count >= 3 AND avg_competition < 8 THEN 'SUSPICIOUS'
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
     * 4. Анализ доминирующих покупателей по категориям
     */
    async analyzeCategoryDominance() {
        console.log('\n🏆 Анализ доминирования по категориям...');
        
        const query = `
            WITH category_dominance AS (
                SELECT 
                    winner_login,
                    category,
                    COUNT(*) as purchases_in_category,
                    AVG(winning_bid) as avg_price_in_category,
                    COUNT(DISTINCT auction_number) as auctions_in_category,
                    AVG(bids_count) as avg_competition,
                    -- Общее количество покупок покупателя
                    SUM(COUNT(*)) OVER (PARTITION BY winner_login) as total_purchases
                FROM auction_lots
                WHERE winner_login IS NOT NULL
                AND category IS NOT NULL
                AND winning_bid > 0
                GROUP BY winner_login, category
                HAVING COUNT(*) >= 5  -- Минимум 5 покупок в категории
            )
            SELECT 
                winner_login,
                category,
                purchases_in_category,
                ROUND(avg_price_in_category::numeric, 2) as avg_price_in_category,
                auctions_in_category,
                ROUND(avg_competition::numeric, 1) as avg_competition,
                total_purchases,
                -- Процент покупок в этой категории
                ROUND((purchases_in_category::numeric / total_purchases * 100)::numeric, 1) as category_percentage,
                CASE 
                    WHEN (purchases_in_category::numeric / total_purchases * 100) > 80 AND avg_competition < 5 THEN 'VERY_SUSPICIOUS'
                    WHEN (purchases_in_category::numeric / total_purchases * 100) > 60 AND avg_competition < 8 THEN 'SUSPICIOUS'
                    ELSE 'NORMAL'
                END as dominance_level
            FROM category_dominance
            ORDER BY category_percentage DESC, purchases_in_category DESC
            LIMIT 30;
        `;

        const result = await this.db.query(query);
        console.log(`✅ Найдено ${result.rows.length} случаев доминирования по категориям`);
        return result.rows;
    }

    /**
     * 5. Анализ временных паттернов покупок
     */
    async analyzeTemporalPatterns() {
        console.log('\n⏰ Анализ временных паттернов...');
        
        const query = `
            WITH temporal_patterns AS (
                SELECT 
                    winner_login,
                    EXTRACT(HOUR FROM auction_end_date) as hour_of_day,
                    EXTRACT(DOW FROM auction_end_date) as day_of_week,
                    COUNT(*) as purchases_count,
                    AVG(winning_bid) as avg_price,
                    AVG(bids_count) as avg_competition
                FROM auction_lots
                WHERE winner_login IS NOT NULL
                AND auction_end_date IS NOT NULL
                AND winning_bid > 0
                GROUP BY winner_login, EXTRACT(HOUR FROM auction_end_date), EXTRACT(DOW FROM auction_end_date)
                HAVING COUNT(*) >= 3
            )
            SELECT 
                winner_login,
                hour_of_day,
                day_of_week,
                purchases_count,
                ROUND(avg_price::numeric, 2) as avg_price,
                ROUND(avg_competition::numeric, 1) as avg_competition,
                CASE 
                    WHEN purchases_count >= 10 AND avg_competition < 5 THEN 'VERY_SUSPICIOUS'
                    WHEN purchases_count >= 5 AND avg_competition < 8 THEN 'SUSPICIOUS'
                    ELSE 'NORMAL'
                END as pattern_level
            FROM temporal_patterns
            ORDER BY purchases_count DESC, avg_competition ASC
            LIMIT 30;
        `;

        const result = await this.db.query(query);
        console.log(`✅ Найдено ${result.rows.length} подозрительных временных паттернов`);
        return result.rows;
    }

    /**
     * 6. Анализ лотов с низкой конкуренцией
     */
    async analyzeLowCompetitionLots() {
        console.log('\n🎯 Анализ лотов с низкой конкуренцией...');
        
        const query = `
            WITH low_competition AS (
                SELECT 
                    winner_login,
                    COUNT(*) as low_competition_wins,
                    AVG(winning_bid) as avg_price,
                    COUNT(DISTINCT category) as categories,
                    COUNT(DISTINCT auction_number) as auctions,
                    AVG(bids_count) as avg_bids_count
                FROM auction_lots
                WHERE winner_login IS NOT NULL
                AND winning_bid > 0
                AND bids_count <= 3  -- Низкая конкуренция
                AND winning_bid >= 1000  -- Но высокая цена
                GROUP BY winner_login
                HAVING COUNT(*) >= 5
            )
            SELECT 
                winner_login,
                low_competition_wins,
                ROUND(avg_price::numeric, 2) as avg_price,
                categories,
                auctions,
                ROUND(avg_bids_count::numeric, 1) as avg_bids_count,
                CASE 
                    WHEN low_competition_wins >= 20 AND avg_bids_count <= 2 THEN 'VERY_SUSPICIOUS'
                    WHEN low_competition_wins >= 10 AND avg_bids_count <= 3 THEN 'SUSPICIOUS'
                    ELSE 'NORMAL'
                END as suspicion_level
            FROM low_competition
            ORDER BY low_competition_wins DESC, avg_price DESC
            LIMIT 30;
        `;

        const result = await this.db.query(query);
        console.log(`✅ Найдено ${result.rows.length} покупателей с подозрительно низкой конкуренцией`);
        return result.rows;
    }

    /**
     * Комплексный анализ всех паттернов
     */
    async runComprehensiveAnalysis() {
        console.log('\n🚀 Запуск комплексного анализа поведения...');
        
        const results = {
            suspiciousBuyers: await this.analyzeSuspiciousBuyers(),
            priceManipulation: await this.analyzePriceManipulation(),
            repeatedPurchases: await this.analyzeRepeatedPurchases(),
            categoryDominance: await this.analyzeCategoryDominance(),
            temporalPatterns: await this.analyzeTemporalPatterns(),
            lowCompetition: await this.analyzeLowCompetitionLots(),
            summary: {}
        };

        // Создаем сводку
        results.summary = {
            analysisDate: new Date().toISOString(),
            suspiciousBuyers: results.suspiciousBuyers.filter(s => s.suspicion_level !== 'NORMAL').length,
            priceManipulators: results.priceManipulation.filter(p => p.manipulation_level !== 'NORMAL').length,
            repeatedPurchases: results.repeatedPurchases.filter(r => r.repetition_level !== 'NORMAL').length,
            categoryDominators: results.categoryDominance.filter(d => d.dominance_level !== 'NORMAL').length,
            temporalPatterns: results.temporalPatterns.filter(t => t.pattern_level !== 'NORMAL').length,
            lowCompetition: results.lowCompetition.filter(l => l.suspicion_level !== 'NORMAL').length
        };

        console.log('\n🎯 РЕЗУЛЬТАТЫ КОМПЛЕКСНОГО АНАЛИЗА:');
        console.log(`   Подозрительных покупателей: ${results.summary.suspiciousBuyers}`);
        console.log(`   Манипуляторов цен: ${results.summary.priceManipulators}`);
        console.log(`   Повторных покупок: ${results.summary.repeatedPurchases}`);
        console.log(`   Доминирующих по категориям: ${results.summary.categoryDominators}`);
        console.log(`   Подозрительных временных паттернов: ${results.summary.temporalPatterns}`);
        console.log(`   Лотов с низкой конкуренцией: ${results.summary.lowCompetition}`);

        return results;
    }

    async close() {
        await this.db.end();
        console.log('🔒 Соединение с БД закрыто');
    }
}

module.exports = CompleteAuctionBehaviorAnalyzer;

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

    async function runCompleteAnalysis() {
        const analyzer = new CompleteAuctionBehaviorAnalyzer(dbConfig);
        
        try {
            await analyzer.init();
            const results = await analyzer.runComprehensiveAnalysis();
            
            console.log('\n🎉 КОМПЛЕКСНЫЙ АНАЛИЗ ЗАВЕРШЕН!');
            console.log('\n📊 ТОП ПОДОЗРИТЕЛЬНЫХ ПОКУПАТЕЛЕЙ:');
            results.suspiciousBuyers.slice(0, 10).forEach((buyer, index) => {
                console.log(`${index + 1}. ${buyer.winner_login}: ${buyer.total_wins} покупок, ${buyer.suspicion_level}`);
            });
            
        } catch (error) {
            console.error('❌ Ошибка анализа:', error.message);
        } finally {
            await analyzer.close();
        }
    }

    runCompleteAnalysis();
}

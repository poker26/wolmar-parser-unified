/**
 * Анализатор поведения аукциона для ВСЕЙ базы данных
 * Анализирует ВСЕ 114,821 записей в таблице auction_lots
 */

const { Pool } = require('pg');

class FullDatabaseAuctionAnalyzer {
    constructor(dbConfig) {
        this.db = new Pool(dbConfig);
    }

    async init() {
        console.log('🔍 Инициализация анализатора для ВСЕЙ базы данных...');
        await this.checkDatabaseConnection();
        await this.getDatabaseStats();
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

    async getDatabaseStats() {
        console.log('\n📊 Статистика базы данных:');
        
        // Общее количество записей
        const totalResult = await this.db.query('SELECT COUNT(*) as total FROM auction_lots');
        console.log(`   Всего лотов: ${totalResult.rows[0].total}`);
        
        // Лоты с победителями
        const winnersResult = await this.db.query('SELECT COUNT(*) as with_winners FROM auction_lots WHERE winner_login IS NOT NULL');
        console.log(`   Лотов с победителями: ${winnersResult.rows[0].with_winners}`);
        
        // Лоты с ценами
        const pricesResult = await this.db.query('SELECT COUNT(*) as with_prices FROM auction_lots WHERE winning_bid > 0');
        console.log(`   Лотов с ценами: ${pricesResult.rows[0].with_prices}`);
        
        // Лоты с историей ставок
        const historyResult = await this.db.query('SELECT COUNT(*) as with_history FROM auction_lots WHERE bidding_history_collected = true');
        console.log(`   Лотов с историей ставок: ${historyResult.rows[0].with_history}`);
        
        // Уникальные покупатели
        const buyersResult = await this.db.query('SELECT COUNT(DISTINCT winner_login) as unique_buyers FROM auction_lots WHERE winner_login IS NOT NULL');
        console.log(`   Уникальных покупателей: ${buyersResult.rows[0].unique_buyers}`);
        
        // Уникальные аукционы
        const auctionsResult = await this.db.query('SELECT COUNT(DISTINCT auction_number) as unique_auctions FROM auction_lots WHERE auction_number IS NOT NULL');
        console.log(`   Уникальных аукционов: ${auctionsResult.rows[0].unique_auctions}`);
    }

    /**
     * 1. Анализ подозрительных покупателей (ВСЯ база данных)
     */
    async analyzeSuspiciousBuyers() {
        console.log('\n📊 Анализ подозрительных покупателей (ВСЯ БД)...');
        
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
                    ) as high_competition_percentage,
                    -- Общая сумма потраченных денег
                    SUM(winning_bid) as total_spent
                FROM auction_lots 
                WHERE winner_login IS NOT NULL 
                AND winning_bid > 0
                GROUP BY winner_login
                HAVING COUNT(*) >= 5  -- Минимум 5 покупок для анализа
            )
            SELECT 
                winner_login,
                total_wins,
                ROUND(avg_price::numeric, 2) as avg_price,
                ROUND(total_spent::numeric, 2) as total_spent,
                auctions_participated,
                categories_bought,
                metals_bought,
                high_price_percentage,
                high_competition_percentage,
                CASE 
                    WHEN high_price_percentage > 70 AND categories_bought <= 3 THEN 'VERY_SUSPICIOUS'
                    WHEN high_price_percentage > 50 AND categories_bought <= 5 THEN 'SUSPICIOUS'
                    WHEN total_wins >= 100 AND high_competition_percentage < 30 THEN 'DOMINANT_BUYER'
                    WHEN total_spent > 1000000 THEN 'HIGH_VALUE_BUYER'
                    ELSE 'NORMAL'
                END as suspicion_level
            FROM buyer_stats
            ORDER BY total_spent DESC, high_price_percentage DESC
            LIMIT 100;
        `;

        const result = await this.db.query(query);
        console.log(`✅ Проанализировано ${result.rows.length} покупателей из ВСЕЙ базы данных`);
        return result.rows;
    }

    /**
     * 2. Анализ манипуляций с ценами (ВСЯ база данных)
     */
    async analyzePriceManipulation() {
        console.log('\n💰 Анализ манипуляций с ценами (ВСЯ БД)...');
        
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
                AND winning_bid > starting_bid * 2  -- Цена выросла в 2+ раз
            )
            SELECT 
                winner_login,
                COUNT(*) as manipulated_lots,
                ROUND(AVG(price_multiplier)::numeric, 2) as avg_multiplier,
                ROUND(MAX(price_multiplier)::numeric, 2) as max_multiplier,
                ROUND(AVG(winning_bid)::numeric, 2) as avg_final_price,
                ROUND(AVG(bids_count)::numeric, 1) as avg_competition,
                COUNT(DISTINCT category) as categories_manipulated,
                ROUND(SUM(winning_bid)::numeric, 2) as total_spent_on_manipulated
            FROM price_patterns
            GROUP BY winner_login
            HAVING COUNT(*) >= 3
            ORDER BY avg_multiplier DESC, manipulated_lots DESC
            LIMIT 50;
        `;

        const result = await this.db.query(query);
        console.log(`✅ Найдено ${result.rows.length} случаев манипуляций с ценами из ВСЕЙ базы данных`);
        return result.rows;
    }

    /**
     * 3. Анализ повторных покупок (ВСЯ база данных)
     */
    async analyzeRepeatedPurchases() {
        console.log('\n🔄 Анализ повторных покупок (ВСЯ БД)...');
        
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
                    MAX(auction_end_date) as last_purchase,
                    SUM(winning_bid) as total_spent_on_item
                FROM auction_lots
                WHERE winner_login IS NOT NULL
                AND coin_description IS NOT NULL
                AND winning_bid > 0
                GROUP BY winner_login, coin_description, category, metal, year
                HAVING COUNT(*) >= 2  -- Минимум 2 покупки одинакового лота
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
                ROUND(total_spent_on_item::numeric, 2) as total_spent_on_item,
                ROUND(avg_competition::numeric, 1) as avg_competition,
                first_purchase,
                last_purchase,
                -- Разброс цен
                ROUND(((max_price - min_price) / min_price * 100)::numeric, 1) as price_variation_pct
            FROM repeated_purchases
            ORDER BY purchase_count DESC, total_spent_on_item DESC
            LIMIT 100;
        `;

        const result = await this.db.query(query);
        console.log(`✅ Найдено ${result.rows.length} случаев повторных покупок из ВСЕЙ базы данных`);
        return result.rows;
    }

    /**
     * 4. Анализ доминирующих покупателей по категориям (ВСЯ база данных)
     */
    async analyzeCategoryDominance() {
        console.log('\n🏆 Анализ доминирования по категориям (ВСЯ БД)...');
        
        const query = `
            WITH category_dominance AS (
                SELECT 
                    winner_login,
                    category,
                    COUNT(*) as purchases_in_category,
                    AVG(winning_bid) as avg_price_in_category,
                    COUNT(DISTINCT auction_number) as auctions_in_category,
                    AVG(bids_count) as avg_competition,
                    SUM(winning_bid) as total_spent_in_category,
                    -- Общее количество покупок покупателя
                    SUM(COUNT(*)) OVER (PARTITION BY winner_login) as total_purchases
                FROM auction_lots
                WHERE winner_login IS NOT NULL
                AND category IS NOT NULL
                AND winning_bid > 0
                GROUP BY winner_login, category
                HAVING COUNT(*) >= 3  -- Минимум 3 покупки в категории
            )
            SELECT 
                winner_login,
                category,
                purchases_in_category,
                ROUND(avg_price_in_category::numeric, 2) as avg_price_in_category,
                ROUND(total_spent_in_category::numeric, 2) as total_spent_in_category,
                auctions_in_category,
                ROUND(avg_competition::numeric, 1) as avg_competition,
                total_purchases,
                -- Процент покупок в этой категории
                ROUND((purchases_in_category::numeric / total_purchases * 100)::numeric, 1) as category_percentage
            FROM category_dominance
            ORDER BY category_percentage DESC, purchases_in_category DESC
            LIMIT 50;
        `;

        const result = await this.db.query(query);
        console.log(`✅ Найдено ${result.rows.length} случаев доминирования по категориям из ВСЕЙ базы данных`);
        return result.rows;
    }

    /**
     * 5. Анализ временных паттернов (ВСЯ база данных)
     */
    async analyzeTemporalPatterns() {
        console.log('\n⏰ Анализ временных паттернов (ВСЯ БД)...');
        
        const query = `
            WITH temporal_patterns AS (
                SELECT 
                    winner_login,
                    EXTRACT(HOUR FROM auction_end_date) as hour_of_day,
                    EXTRACT(DOW FROM auction_end_date) as day_of_week,
                    COUNT(*) as purchases_count,
                    AVG(winning_bid) as avg_price,
                    AVG(bids_count) as avg_competition,
                    SUM(winning_bid) as total_spent
                FROM auction_lots
                WHERE winner_login IS NOT NULL
                AND auction_end_date IS NOT NULL
                AND winning_bid > 0
                GROUP BY winner_login, EXTRACT(HOUR FROM auction_end_date), EXTRACT(DOW FROM auction_end_date)
                HAVING COUNT(*) >= 2
            )
            SELECT 
                winner_login,
                hour_of_day,
                day_of_week,
                purchases_count,
                ROUND(avg_price::numeric, 2) as avg_price,
                ROUND(total_spent::numeric, 2) as total_spent,
                ROUND(avg_competition::numeric, 1) as avg_competition
            FROM temporal_patterns
            ORDER BY purchases_count DESC, total_spent DESC
            LIMIT 50;
        `;

        const result = await this.db.query(query);
        console.log(`✅ Найдено ${result.rows.length} временных паттернов из ВСЕЙ базы данных`);
        return result.rows;
    }

    /**
     * 6. Анализ лотов с низкой конкуренцией (ВСЯ база данных)
     */
    async analyzeLowCompetitionLots() {
        console.log('\n🎯 Анализ лотов с низкой конкуренцией (ВСЯ БД)...');
        
        const query = `
            WITH low_competition AS (
                SELECT 
                    winner_login,
                    COUNT(*) as low_competition_wins,
                    AVG(winning_bid) as avg_price,
                    COUNT(DISTINCT category) as categories,
                    COUNT(DISTINCT auction_number) as auctions,
                    AVG(bids_count) as avg_bids_count,
                    SUM(winning_bid) as total_spent_low_competition
                FROM auction_lots
                WHERE winner_login IS NOT NULL
                AND winning_bid > 0
                AND bids_count <= 3  -- Низкая конкуренция
                AND winning_bid >= 500  -- Но приличная цена
                GROUP BY winner_login
                HAVING COUNT(*) >= 3
            )
            SELECT 
                winner_login,
                low_competition_wins,
                ROUND(avg_price::numeric, 2) as avg_price,
                ROUND(total_spent_low_competition::numeric, 2) as total_spent_low_competition,
                categories,
                auctions,
                ROUND(avg_bids_count::numeric, 1) as avg_bids_count
            FROM low_competition
            ORDER BY low_competition_wins DESC, total_spent_low_competition DESC
            LIMIT 50;
        `;

        const result = await this.db.query(query);
        console.log(`✅ Найдено ${result.rows.length} покупателей с низкой конкуренцией из ВСЕЙ базы данных`);
        return result.rows;
    }

    /**
     * Комплексный анализ ВСЕЙ базы данных
     */
    async runFullDatabaseAnalysis() {
        console.log('\n🚀 Запуск анализа ВСЕЙ базы данных (114,821 записей)...');
        
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
            totalBuyersAnalyzed: results.suspiciousBuyers.length,
            priceManipulators: results.priceManipulation.length,
            repeatedPurchases: results.repeatedPurchases.length,
            categoryDominators: results.categoryDominance.length,
            temporalPatterns: results.temporalPatterns.length,
            lowCompetition: results.lowCompetition.length
        };

        console.log('\n🎯 РЕЗУЛЬТАТЫ АНАЛИЗА ВСЕЙ БАЗЫ ДАННЫХ:');
        console.log(`   Проанализировано покупателей: ${results.summary.totalBuyersAnalyzed}`);
        console.log(`   Случаев манипуляций с ценами: ${results.summary.priceManipulators}`);
        console.log(`   Повторных покупок: ${results.summary.repeatedPurchases}`);
        console.log(`   Доминирования по категориям: ${results.summary.categoryDominators}`);
        console.log(`   Временных паттернов: ${results.summary.temporalPatterns}`);
        console.log(`   Лотов с низкой конкуренцией: ${results.summary.lowCompetition}`);

        return results;
    }

    async close() {
        await this.db.end();
        console.log('🔒 Соединение с БД закрыто');
    }
}

module.exports = FullDatabaseAuctionAnalyzer;

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

    async function runFullAnalysis() {
        const analyzer = new FullDatabaseAuctionAnalyzer(dbConfig);
        
        try {
            await analyzer.init();
            const results = await analyzer.runFullDatabaseAnalysis();
            
            console.log('\n🎉 АНАЛИЗ ВСЕЙ БАЗЫ ДАННЫХ ЗАВЕРШЕН!');
            console.log('\n📊 ТОП-10 ПОДОЗРИТЕЛЬНЫХ ПОКУПАТЕЛЕЙ:');
            results.suspiciousBuyers.slice(0, 10).forEach((buyer, index) => {
                console.log(`${index + 1}. ${buyer.winner_login}: ${buyer.total_wins} покупок, ${buyer.total_spent}₽, ${buyer.suspicion_level}`);
            });
            
        } catch (error) {
            console.error('❌ Ошибка анализа:', error.message);
        } finally {
            await analyzer.close();
        }
    }

    runFullAnalysis();
}


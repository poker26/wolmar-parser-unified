/**
 * Анализатор поведения на аукционе Wolmar
 * Проверяет гипотезы о манипуляциях продавцов
 */

const { Pool } = require('pg');
const fs = require('fs').promises;

class AuctionBehaviorAnalyzer {
    constructor(dbConfig) {
        this.db = new Pool(dbConfig);
        this.results = {
            suspiciousSellers: [],
            priceManipulation: [],
            multipleAccounts: [],
            baitingTactics: [],
            repeatedPurchases: [],
            summary: {}
        };
    }

    async init() {
        console.log('🔍 Инициализация анализатора поведения на аукционе...');
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
     * Проверяет гипотезу о том, что продавцы разгоняют цены
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
                    -- Процент лотов, купленных по максимальной цене
                    ROUND(
                        COUNT(CASE WHEN final_price >= starting_price * 10 THEN 1 END) * 100.0 / COUNT(*), 2
                    ) as high_price_percentage
                FROM auction_lots 
                WHERE winner_login IS NOT NULL 
                AND winning_bid > 0
                GROUP BY winner_login
                HAVING COUNT(*) >= 10  -- Минимум 10 покупок для анализа
            )
            SELECT 
                winner_nick,
                total_wins,
                ROUND(avg_price::numeric, 2) as avg_price,
                auctions_participated,
                categories_bought,
                high_price_percentage,
                -- Подозрительность: высокая цена + много покупок + узкая специализация
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
     * 2. Анализ манипуляций с ценами
     * Проверяет паттерны накрутки цен
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
                    -- Коэффициент накрутки
                    ROUND((final_price::numeric / starting_price::numeric), 2) as price_multiplier,
                    -- Время последней ставки (если есть данные)
                    created_at
                FROM auction_lots
                WHERE final_price > starting_price * 5  -- Цена выросла в 5+ раз
                AND final_price > 100  -- Минимум 100 рублей
            )
            SELECT 
                seller_nick,
                COUNT(*) as manipulated_lots,
                ROUND(AVG(price_multiplier)::numeric, 2) as avg_multiplier,
                ROUND(MAX(price_multiplier)::numeric, 2) as max_multiplier,
                COUNT(DISTINCT winner_nick) as unique_winners,
                -- Подозрительность: высокая накрутка + мало уникальных победителей
                CASE 
                    WHEN AVG(price_multiplier) > 20 AND COUNT(DISTINCT winner_nick) <= 3 THEN 'VERY_SUSPICIOUS'
                    WHEN AVG(price_multiplier) > 10 AND COUNT(DISTINCT winner_nick) <= 5 THEN 'SUSPICIOUS'
                    ELSE 'NORMAL'
                END as manipulation_level
            FROM price_patterns
            GROUP BY seller_nick
            HAVING COUNT(*) >= 5  -- Минимум 5 лотов с накруткой
            ORDER BY avg_multiplier DESC, manipulated_lots DESC
            LIMIT 30;
        `;

        const result = await this.db.query(query);
        this.results.priceManipulation = result.rows;
        
        console.log(`✅ Найдено ${result.rows.length} продавцов с подозрительной накруткой цен`);
        return result.rows;
    }

    /**
     * 3. Поиск множественных аккаунтов
     * Проверяет гипотезу о том, что один продавец использует несколько ников
     */
    async analyzeMultipleAccounts() {
        console.log('\n👥 Анализ множественных аккаунтов...');
        
        const query = `
            WITH account_patterns AS (
                SELECT 
                    winner_nick,
                    seller_nick,
                    COUNT(*) as interactions,
                    AVG(final_price) as avg_price,
                    COUNT(DISTINCT auction_id) as auctions_together
                FROM auction_lots
                WHERE winner_nick IS NOT NULL 
                AND seller_nick IS NOT NULL
                AND winner_nick != seller_nick
                GROUP BY winner_nick, seller_nick
                HAVING COUNT(*) >= 3  -- Минимум 3 взаимодействия
            ),
            suspicious_pairs AS (
                SELECT 
                    winner_nick,
                    seller_nick,
                    interactions,
                    ROUND(avg_price::numeric, 2) as avg_price,
                    auctions_together,
                    -- Подозрительность: много взаимодействий + стабильные цены
                    CASE 
                        WHEN interactions >= 10 AND auctions_together >= 5 THEN 'VERY_SUSPICIOUS'
                        WHEN interactions >= 5 AND auctions_together >= 3 THEN 'SUSPICIOUS'
                        ELSE 'NORMAL'
                    END as suspicion_level
                FROM account_patterns
            )
            SELECT * FROM suspicious_pairs
            WHERE suspicion_level != 'NORMAL'
            ORDER BY interactions DESC, auctions_together DESC
            LIMIT 50;
        `;

        const result = await this.db.query(query);
        this.results.multipleAccounts = result.rows;
        
        console.log(`✅ Найдено ${result.rows.length} подозрительных пар аккаунтов`);
        return result.rows;
    }

    /**
     * 4. Анализ тактики "приманки"
     * Проверяет гипотезу о том, что продавцы держат покупателей на дешевых ставках
     */
    async analyzeBaitingTactics() {
        console.log('\n🎣 Анализ тактики "приманки"...');
        
        const query = `
            WITH buyer_patterns AS (
                SELECT 
                    winner_nick,
                    COUNT(*) as total_purchases,
                    AVG(final_price) as avg_purchase_price,
                    MIN(final_price) as min_purchase_price,
                    MAX(final_price) as max_purchase_price,
                    -- Разброс цен (коэффициент вариации)
                    ROUND(
                        (STDDEV(final_price) / AVG(final_price)) * 100, 2
                    ) as price_variation_percent,
                    COUNT(DISTINCT seller_nick) as unique_sellers
                FROM auction_lots
                WHERE winner_nick IS NOT NULL
                AND final_price > 0
                GROUP BY winner_nick
                HAVING COUNT(*) >= 5  -- Минимум 5 покупок
            )
            SELECT 
                winner_nick,
                total_purchases,
                ROUND(avg_purchase_price::numeric, 2) as avg_purchase_price,
                ROUND(min_purchase_price::numeric, 2) as min_purchase_price,
                ROUND(max_purchase_price::numeric, 2) as max_purchase_price,
                price_variation_percent,
                unique_sellers,
                -- Подозрительность: большой разброс цен + мало продавцов
                CASE 
                    WHEN price_variation_percent > 200 AND unique_sellers <= 3 THEN 'VERY_SUSPICIOUS'
                    WHEN price_variation_percent > 100 AND unique_sellers <= 5 THEN 'SUSPICIOUS'
                    ELSE 'NORMAL'
                END as baiting_level
            FROM buyer_patterns
            WHERE price_variation_percent > 50  -- Минимальный разброс для анализа
            ORDER BY price_variation_percent DESC, total_purchases DESC
            LIMIT 30;
        `;

        const result = await this.db.query(query);
        this.results.baitingTactics = result.rows;
        
        console.log(`✅ Найдено ${result.rows.length} покупателей с подозрительными паттернами`);
        return result.rows;
    }

    /**
     * 5. Анализ повторных покупок
     * Проверяет гипотезу о том, что продавцы покупают одни и те же монеты многократно
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
                HAVING COUNT(*) >= 3  -- Минимум 3 покупки одинакового лота
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
                -- Подозрительность: много покупок + один продавец
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
     * 6. Комплексный анализ и генерация отчета
     */
    async generateComprehensiveReport() {
        console.log('\n📋 Генерация комплексного отчета...');
        
        // Выполняем все анализы
        await this.analyzeSuspiciousSellers();
        await this.analyzePriceManipulation();
        await this.analyzeMultipleAccounts();
        await this.analyzeBaitingTactics();
        await this.analyzeRepeatedPurchases();

        // Создаем сводку
        this.results.summary = {
            totalSuspiciousSellers: this.results.suspiciousSellers.filter(s => s.suspicion_level !== 'NORMAL').length,
            totalPriceManipulators: this.results.priceManipulation.filter(p => p.manipulation_level !== 'NORMAL').length,
            totalMultipleAccounts: this.results.multipleAccounts.length,
            totalBaitingCases: this.results.baitingTactics.filter(b => b.baiting_level !== 'NORMAL').length,
            totalRepeatedPurchases: this.results.repeatedPurchases.filter(r => r.repetition_level !== 'NORMAL').length,
            analysisDate: new Date().toISOString(),
            hypotheses: {
                priceManipulation: this.results.priceManipulation.length > 0 ? 'CONFIRMED' : 'NOT_CONFIRMED',
                multipleAccounts: this.results.multipleAccounts.length > 0 ? 'CONFIRMED' : 'NOT_CONFIRMED',
                baitingTactics: this.results.baitingTactics.filter(b => b.baiting_level !== 'NORMAL').length > 0 ? 'CONFIRMED' : 'NOT_CONFIRMED',
                repeatedPurchases: this.results.repeatedPurchases.filter(r => r.repetition_level !== 'NORMAL').length > 0 ? 'CONFIRMED' : 'NOT_CONFIRMED'
            }
        };

        // Сохраняем результаты
        await this.saveResults();
        
        return this.results;
    }

    /**
     * Сохранение результатов в файл
     */
    async saveResults() {
        const filename = `auction-behavior-analysis-${new Date().toISOString().split('T')[0]}.json`;
        await fs.writeFile(filename, JSON.stringify(this.results, null, 2));
        console.log(`💾 Результаты сохранены в файл: ${filename}`);
    }

    /**
     * Закрытие соединения с БД
     */
    async close() {
        await this.db.end();
        console.log('🔒 Соединение с БД закрыто');
    }
}

// Экспорт для использования в других модулях
module.exports = AuctionBehaviorAnalyzer;

// Запуск анализа, если файл выполняется напрямую
if (require.main === module) {
    const dbConfig = {
        user: 'postgres.xkwgspqwebfeteoblayu',
        host: 'sup.begemot26.ru',
        database: 'postgres',
        password: 'Gopapopa326+',
        port: 6543,
        ssl: { rejectUnauthorized: false }
    };

    async function runAnalysis() {
        const analyzer = new AuctionBehaviorAnalyzer(dbConfig);
        
        try {
            await analyzer.init();
            const results = await analyzer.generateComprehensiveReport();
            
            console.log('\n🎯 РЕЗУЛЬТАТЫ АНАЛИЗА:');
            console.log('====================');
            console.log(`📊 Подозрительных продавцов: ${results.summary.totalSuspiciousSellers}`);
            console.log(`💰 Манипуляторов ценами: ${results.summary.totalPriceManipulators}`);
            console.log(`👥 Множественных аккаунтов: ${results.summary.totalMultipleAccounts}`);
            console.log(`🎣 Случаев "приманки": ${results.summary.totalBaitingCases}`);
            console.log(`🔄 Повторных покупок: ${results.summary.totalRepeatedPurchases}`);
            
            console.log('\n🔍 СТАТУС ГИПОТЕЗ:');
            console.log('==================');
            Object.entries(results.summary.hypotheses).forEach(([hypothesis, status]) => {
                const emoji = status === 'CONFIRMED' ? '✅' : '❌';
                console.log(`${emoji} ${hypothesis}: ${status}`);
            });
            
        } catch (error) {
            console.error('❌ Ошибка анализа:', error.message);
        } finally {
            await analyzer.close();
        }
    }

    runAnalysis();
}

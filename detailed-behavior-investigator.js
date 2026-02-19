/**
 * Детальный исследователь поведения на аукционе
 * Углубленный анализ конкретных случаев и паттернов
 */

const { Pool } = require('pg');
const fs = require('fs').promises;

class DetailedBehaviorInvestigator {
    constructor(dbConfig) {
        this.db = new Pool(dbConfig);
    }

    async init() {
        console.log('🔬 Инициализация детального исследователя...');
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
     * Анализ конкретного продавца
     */
    async investigateSeller(sellerNick) {
        console.log(`\n🔍 Детальное расследование продавца: ${sellerNick}`);
        
        const queries = {
            // Общая статистика продавца
            sellerStats: `
                SELECT 
                    seller_nick,
                    COUNT(*) as total_lots,
                    COUNT(DISTINCT auction_id) as auctions_participated,
                    AVG(final_price) as avg_final_price,
                    AVG(starting_price) as avg_starting_price,
                    ROUND(AVG(final_price::numeric / starting_price::numeric), 2) as avg_price_multiplier,
                    COUNT(DISTINCT winner_nick) as unique_winners,
                    COUNT(CASE WHEN final_price > starting_price * 10 THEN 1 END) as high_multiplier_lots
                FROM auction_lots 
                WHERE seller_nick = $1
                GROUP BY seller_nick
            `,
            
            // Топ покупатели этого продавца
            topBuyers: `
                SELECT 
                    winner_nick,
                    COUNT(*) as purchases_count,
                    AVG(final_price) as avg_purchase_price,
                    MIN(final_price) as min_purchase_price,
                    MAX(final_price) as max_purchase_price,
                    COUNT(DISTINCT auction_id) as auctions_participated
                FROM auction_lots 
                WHERE seller_nick = $1 AND winner_nick IS NOT NULL
                GROUP BY winner_nick
                ORDER BY purchases_count DESC, avg_purchase_price DESC
                LIMIT 20
            `,
            
            // Лоты с наибольшей накруткой
            highMultiplierLots: `
                SELECT 
                    lot_id,
                    auction_id,
                    lot_description,
                    starting_price,
                    final_price,
                    winner_nick,
                    ROUND((final_price::numeric / starting_price::numeric), 2) as price_multiplier,
                    created_at
                FROM auction_lots 
                WHERE seller_nick = $1
                AND final_price > starting_price * 5
                ORDER BY (final_price::numeric / starting_price::numeric) DESC
                LIMIT 20
            `,
            
            // Временные паттерны (если есть данные о времени)
            temporalPatterns: `
                SELECT 
                    EXTRACT(HOUR FROM created_at) as hour_of_day,
                    EXTRACT(DOW FROM created_at) as day_of_week,
                    COUNT(*) as lots_count,
                    AVG(final_price) as avg_price
                FROM auction_lots 
                WHERE seller_nick = $1
                AND created_at IS NOT NULL
                GROUP BY EXTRACT(HOUR FROM created_at), EXTRACT(DOW FROM created_at)
                ORDER BY lots_count DESC
            `
        };

        const results = {};
        
        for (const [queryName, query] of Object.entries(queries)) {
            try {
                const result = await this.db.query(query, [sellerNick]);
                results[queryName] = result.rows;
            } catch (error) {
                console.error(`❌ Ошибка в запросе ${queryName}:`, error.message);
                results[queryName] = [];
            }
        }

        return results;
    }

    /**
     * Анализ конкретного покупателя
     */
    async investigateBuyer(buyerNick) {
        console.log(`\n🛒 Детальное расследование покупателя: ${buyerNick}`);
        
        const queries = {
            // Общая статистика покупателя
            buyerStats: `
                SELECT 
                    winner_nick,
                    COUNT(*) as total_purchases,
                    COUNT(DISTINCT seller_nick) as unique_sellers,
                    COUNT(DISTINCT auction_id) as auctions_participated,
                    AVG(final_price) as avg_purchase_price,
                    MIN(final_price) as min_purchase_price,
                    MAX(final_price) as max_purchase_price,
                    SUM(final_price) as total_spent
                FROM auction_lots 
                WHERE winner_nick = $1
                GROUP BY winner_nick
            `,
            
            // Топ продавцы, у которых покупает
            topSellers: `
                SELECT 
                    seller_nick,
                    COUNT(*) as purchases_count,
                    AVG(final_price) as avg_purchase_price,
                    MIN(final_price) as min_purchase_price,
                    MAX(final_price) as max_purchase_price,
                    ROUND(STDDEV(final_price) / AVG(final_price) * 100, 2) as price_variation_percent
                FROM auction_lots 
                WHERE winner_nick = $1
                GROUP BY seller_nick
                ORDER BY purchases_count DESC, avg_purchase_price DESC
                LIMIT 20
            `,
            
            // Анализ ценовых паттернов
            pricePatterns: `
                SELECT 
                    lot_category,
                    COUNT(*) as category_purchases,
                    AVG(final_price) as avg_price,
                    MIN(final_price) as min_price,
                    MAX(final_price) as max_price,
                    ROUND(STDDEV(final_price) / AVG(final_price) * 100, 2) as price_variation_percent
                FROM auction_lots 
                WHERE winner_nick = $1
                GROUP BY lot_category
                ORDER BY category_purchases DESC
            `,
            
            // Хронология покупок
            purchaseTimeline: `
                SELECT 
                    auction_id,
                    lot_id,
                    lot_description,
                    final_price,
                    seller_nick,
                    created_at
                FROM auction_lots 
                WHERE winner_nick = $1
                ORDER BY created_at DESC
                LIMIT 50
            `
        };

        const results = {};
        
        for (const [queryName, query] of Object.entries(queries)) {
            try {
                const result = await this.db.query(query, [buyerNick]);
                results[queryName] = result.rows;
            } catch (error) {
                console.error(`❌ Ошибка в запросе ${queryName}:`, error.message);
                results[queryName] = [];
            }
        }

        return results;
    }

    /**
     * Анализ подозрительных взаимодействий между продавцом и покупателем
     */
    async investigateSellerBuyerInteraction(sellerNick, buyerNick) {
        console.log(`\n🤝 Анализ взаимодействия: ${sellerNick} ↔ ${buyerNick}`);
        
        const query = `
            SELECT 
                lot_id,
                auction_id,
                lot_description,
                starting_price,
                final_price,
                ROUND((final_price::numeric / starting_price::numeric), 2) as price_multiplier,
                created_at,
                -- Время между лотами (если есть данные)
                LAG(created_at) OVER (ORDER BY created_at) as previous_lot_time
            FROM auction_lots 
            WHERE seller_nick = $1 AND winner_nick = $2
            ORDER BY created_at
        `;

        const result = await this.db.query(query, [sellerNick, buyerNick]);
        
        // Анализ паттернов
        const analysis = {
            totalInteractions: result.rows.length,
            avgPriceMultiplier: result.rows.reduce((sum, row) => sum + parseFloat(row.price_multiplier), 0) / result.rows.length,
            maxPriceMultiplier: Math.max(...result.rows.map(row => parseFloat(row.price_multiplier))),
            minPriceMultiplier: Math.min(...result.rows.map(row => parseFloat(row.price_multiplier))),
            suspiciousPatterns: []
        };

        // Поиск подозрительных паттернов
        if (analysis.avgPriceMultiplier > 10) {
            analysis.suspiciousPatterns.push('Высокая средняя накрутка цен');
        }
        
        if (analysis.maxPriceMultiplier > 50) {
            analysis.suspiciousPatterns.push('Экстремальная накрутка цен');
        }
        
        if (result.rows.length > 10) {
            analysis.suspiciousPatterns.push('Частые взаимодействия');
        }

        return {
            interactions: result.rows,
            analysis: analysis
        };
    }

    /**
     * Поиск синхронных паттернов ставок
     */
    async findSynchronousBiddingPatterns() {
        console.log('\n⏰ Поиск синхронных паттернов ставок...');
        
        const query = `
            WITH bidding_patterns AS (
                SELECT 
                    seller_nick,
                    winner_nick,
                    COUNT(*) as interaction_count,
                    AVG(final_price) as avg_price,
                    COUNT(DISTINCT auction_id) as auctions_together,
                    -- Анализ временных интервалов (если есть данные)
                    MIN(created_at) as first_interaction,
                    MAX(created_at) as last_interaction
                FROM auction_lots
                WHERE seller_nick IS NOT NULL 
                AND winner_nick IS NOT NULL
                AND seller_nick != winner_nick
                GROUP BY seller_nick, winner_nick
                HAVING COUNT(*) >= 3
            )
            SELECT 
                seller_nick,
                winner_nick,
                interaction_count,
                ROUND(avg_price::numeric, 2) as avg_price,
                auctions_together,
                first_interaction,
                last_interaction,
                -- Подозрительность: много взаимодействий + стабильные цены
                CASE 
                    WHEN interaction_count >= 10 AND auctions_together >= 5 THEN 'VERY_SUSPICIOUS'
                    WHEN interaction_count >= 5 AND auctions_together >= 3 THEN 'SUSPICIOUS'
                    ELSE 'NORMAL'
                END as suspicion_level
            FROM bidding_patterns
            ORDER BY interaction_count DESC, avg_price DESC
            LIMIT 50;
        `;

        const result = await this.db.query(query);
        return result.rows;
    }

    /**
     * Анализ "мертвых" лотов (лоты, которые не продались)
     */
    async analyzeDeadLots() {
        console.log('\n💀 Анализ "мертвых" лотов...');
        
        const query = `
            WITH dead_lots AS (
                SELECT 
                    seller_nick,
                    COUNT(*) as dead_lots_count,
                    AVG(starting_price) as avg_starting_price,
                    COUNT(DISTINCT auction_id) as auctions_with_dead_lots
                FROM auction_lots
                WHERE winner_nick IS NULL 
                OR final_price = 0
                OR final_price = starting_price
                GROUP BY seller_nick
                HAVING COUNT(*) >= 5
            )
            SELECT 
                seller_nick,
                dead_lots_count,
                ROUND(avg_starting_price::numeric, 2) as avg_starting_price,
                auctions_with_dead_lots,
                -- Подозрительность: много мертвых лотов
                CASE 
                    WHEN dead_lots_count >= 20 THEN 'VERY_SUSPICIOUS'
                    WHEN dead_lots_count >= 10 THEN 'SUSPICIOUS'
                    ELSE 'NORMAL'
                END as suspicion_level
            FROM dead_lots
            ORDER BY dead_lots_count DESC
            LIMIT 30;
        `;

        const result = await this.db.query(query);
        return result.rows;
    }

    /**
     * Генерация детального отчета по конкретному случаю
     */
    async generateDetailedReport(targetNick, targetType = 'seller') {
        console.log(`\n📋 Генерация детального отчета для ${targetType}: ${targetNick}`);
        
        let investigation;
        if (targetType === 'seller') {
            investigation = await this.investigateSeller(targetNick);
        } else {
            investigation = await this.investigateBuyer(targetNick);
        }

        const report = {
            target: targetNick,
            type: targetType,
            investigation: investigation,
            timestamp: new Date().toISOString(),
            recommendations: this.generateRecommendations(investigation, targetType)
        };

        // Сохраняем отчет
        const filename = `detailed-report-${targetNick}-${new Date().toISOString().split('T')[0]}.json`;
        await fs.writeFile(filename, JSON.stringify(report, null, 2));
        console.log(`💾 Детальный отчет сохранен: ${filename}`);

        return report;
    }

    /**
     * Генерация рекомендаций на основе анализа
     */
    generateRecommendations(investigation, targetType) {
        const recommendations = [];

        if (targetType === 'seller') {
            const stats = investigation.sellerStats[0];
            if (stats) {
                if (stats.avg_price_multiplier > 10) {
                    recommendations.push('⚠️ Высокая средняя накрутка цен - требует внимания');
                }
                if (stats.unique_winners < 5 && stats.total_lots > 20) {
                    recommendations.push('⚠️ Мало уникальных покупателей - возможна схема');
                }
                if (stats.high_multiplier_lots > stats.total_lots * 0.5) {
                    recommendations.push('⚠️ Более 50% лотов с высокой накруткой - подозрительно');
                }
            }
        } else {
            const stats = investigation.buyerStats[0];
            if (stats) {
                if (stats.unique_sellers < 3 && stats.total_purchases > 10) {
                    recommendations.push('⚠️ Покупает у малого количества продавцов - возможна связь');
                }
                const priceVariation = (stats.max_purchase_price - stats.min_purchase_price) / stats.avg_purchase_price;
                if (priceVariation > 5) {
                    recommendations.push('⚠️ Большой разброс цен - возможна тактика "приманки"');
                }
            }
        }

        return recommendations;
    }

    async close() {
        await this.db.end();
        console.log('🔒 Соединение с БД закрыто');
    }
}

module.exports = DetailedBehaviorInvestigator;

// Пример использования
if (require.main === module) {
    const dbConfig = {
        user: 'postgres.xkwgspqwebfeteoblayu',
        host: 'sup.begemot26.ru',
        database: 'postgres',
        password: 'Gopapopa326+',
        port: 6543,
        ssl: { rejectUnauthorized: false }
    };

    async function runDetailedInvestigation() {
        const investigator = new DetailedBehaviorInvestigator(dbConfig);
        
        try {
            await investigator.init();
            
            // Пример: расследование конкретного продавца
            // const sellerReport = await investigator.generateDetailedReport('example_seller', 'seller');
            
            // Поиск синхронных паттернов
            const syncPatterns = await investigator.findSynchronousBiddingPatterns();
            console.log(`\n⏰ Найдено ${syncPatterns.length} синхронных паттернов`);
            
            // Анализ мертвых лотов
            const deadLots = await investigator.analyzeDeadLots();
            console.log(`💀 Найдено ${deadLots.length} продавцов с мертвыми лотами`);
            
        } catch (error) {
            console.error('❌ Ошибка детального расследования:', error.message);
        } finally {
            await investigator.close();
        }
    }

    runDetailedInvestigation();
}

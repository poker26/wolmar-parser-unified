/**
 * Анализ исторических данных о ценах лотов
 * Изучаем корреляции между ценами и различными факторами
 */

const { Client } = require('pg');
const config = require('./config');

class PriceDataAnalyzer {
    constructor() {
        this.dbConfig = config.dbConfig;
        this.dbClient = new Client(this.dbConfig);
    }

    async init() {
        await this.dbClient.connect();
        console.log('🔗 Подключение к базе данных установлено');
    }

    async analyzePriceCorrelations() {
        console.log('\n📊 АНАЛИЗ КОРРЕЛЯЦИЙ ЦЕН С РАЗЛИЧНЫМИ ФАКТОРАМИ:');
        
        // 1. Анализ корреляции цен с состояниями
        console.log('\n1️⃣ Корреляция цен с состояниями:');
        const conditionStats = await this.dbClient.query(`
            SELECT 
                condition,
                COUNT(*) as lots_count,
                AVG(winning_bid) as avg_price,
                MIN(winning_bid) as min_price,
                MAX(winning_bid) as max_price,
                PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY winning_bid) as median_price
            FROM auction_lots 
            WHERE winning_bid IS NOT NULL 
                AND winning_bid > 0
                AND condition IS NOT NULL
            GROUP BY condition
            HAVING COUNT(*) >= 10
            ORDER BY avg_price DESC
            LIMIT 20;
        `);
        
        console.log('📋 Топ-20 состояний по средней цене:');
        conditionStats.rows.forEach((row, index) => {
            console.log(`  ${index + 1}. "${row.condition}": ${row.lots_count} лотов, средняя цена: ${Math.round(row.avg_price).toLocaleString()}₽`);
        });
        
        // 2. Анализ корреляции цен с металлами
        console.log('\n2️⃣ Корреляция цен с металлами:');
        const metalStats = await this.dbClient.query(`
            SELECT 
                metal,
                COUNT(*) as lots_count,
                AVG(winning_bid) as avg_price,
                AVG(weight) as avg_weight,
                AVG(winning_bid / NULLIF(weight, 0)) as avg_price_per_gram
            FROM auction_lots 
            WHERE winning_bid IS NOT NULL 
                AND winning_bid > 0
                AND metal IS NOT NULL
                AND weight IS NOT NULL
                AND weight > 0
            GROUP BY metal
            HAVING COUNT(*) >= 5
            ORDER BY avg_price DESC;
        `);
        
        console.log('📋 Статистика по металлам:');
        metalStats.rows.forEach((row, index) => {
            console.log(`  ${index + 1}. ${row.metal}: ${row.lots_count} лотов, средняя цена: ${Math.round(row.avg_price).toLocaleString()}₽, цена за грамм: ${Math.round(row.avg_price_per_gram).toLocaleString()}₽/г`);
        });
        
        // 3. Анализ корреляции цен с годами
        console.log('\n3️⃣ Корреляция цен с годами:');
        const yearStats = await this.dbClient.query(`
            SELECT 
                year,
                COUNT(*) as lots_count,
                AVG(winning_bid) as avg_price
            FROM auction_lots 
            WHERE winning_bid IS NOT NULL 
                AND winning_bid > 0
                AND year IS NOT NULL
                AND year ~ '^[0-9]+$'
                AND CAST(year AS INTEGER) BETWEEN 1800 AND 2025
            GROUP BY year
            HAVING COUNT(*) >= 5
            ORDER BY CAST(year AS INTEGER) DESC
            LIMIT 15;
        `);
        
        console.log('📋 Статистика по годам (последние 15):');
        yearStats.rows.forEach((row, index) => {
            console.log(`  ${index + 1}. ${row.year}: ${row.lots_count} лотов, средняя цена: ${Math.round(row.avg_price).toLocaleString()}₽`);
        });
        
        // 4. Анализ нумизматических наценок
        console.log('\n4️⃣ Анализ нумизматических наценок:');
        
        // Для золотых монет
        const goldPremium = await this.dbClient.query(`
            SELECT 
                condition,
                COUNT(*) as lots_count,
                AVG(winning_bid) as avg_price,
                AVG(weight * 0.9 * 5000) as estimated_metal_value, -- Примерная цена Au
                AVG(winning_bid / NULLIF(weight * 0.9 * 5000, 0)) as numismatic_premium
            FROM auction_lots 
            WHERE winning_bid IS NOT NULL 
                AND winning_bid > 0
                AND metal = 'Au'
                AND weight IS NOT NULL
                AND weight > 0
                AND condition IS NOT NULL
            GROUP BY condition
            HAVING COUNT(*) >= 3
            ORDER BY numismatic_premium DESC;
        `);
        
        console.log('📋 Нумизматические наценки для золотых монет:');
        goldPremium.rows.forEach((row, index) => {
            const premium = Math.round(row.numismatic_premium * 100) / 100;
            console.log(`  ${index + 1}. ${row.condition}: ${row.lots_count} лотов, наценка: ${premium}x (${Math.round((premium - 1) * 100)}%)`);
        });
        
        // 5. Анализ влияния веса на цену
        console.log('\n5️⃣ Влияние веса на цену:');
        const weightStats = await this.dbClient.query(`
            SELECT 
                CASE 
                    WHEN weight <= 1 THEN '≤1г'
                    WHEN weight <= 5 THEN '1-5г'
                    WHEN weight <= 10 THEN '5-10г'
                    WHEN weight <= 20 THEN '10-20г'
                    ELSE '>20г'
                END as weight_category,
                COUNT(*) as lots_count,
                AVG(winning_bid) as avg_price,
                AVG(winning_bid / NULLIF(weight, 0)) as avg_price_per_gram
            FROM auction_lots 
            WHERE winning_bid IS NOT NULL 
                AND winning_bid > 0
                AND weight IS NOT NULL
                AND weight > 0
            GROUP BY weight_category
            ORDER BY 
                CASE 
                    WHEN weight <= 1 THEN 1
                    WHEN weight <= 5 THEN 2
                    WHEN weight <= 10 THEN 3
                    WHEN weight <= 20 THEN 4
                    ELSE 5
                END;
        `);
        
        console.log('📋 Статистика по весовым категориям:');
        weightStats.rows.forEach((row, index) => {
            console.log(`  ${index + 1}. ${row.weight_category}: ${row.lots_count} лотов, средняя цена: ${Math.round(row.avg_price).toLocaleString()}₽, цена за грамм: ${Math.round(row.avg_price_per_gram).toLocaleString()}₽/г`);
        });
    }

    async analyzeMarketTrends() {
        console.log('\n📈 АНАЛИЗ РЫНОЧНЫХ ТРЕНДОВ:');
        
        // Анализ трендов по аукционам
        const auctionTrends = await this.dbClient.query(`
            SELECT 
                auction_number,
                COUNT(*) as lots_count,
                AVG(winning_bid) as avg_price,
                MIN(auction_end_date) as start_date,
                MAX(auction_end_date) as end_date
            FROM auction_lots 
            WHERE winning_bid IS NOT NULL 
                AND winning_bid > 0
                AND auction_end_date IS NOT NULL
            GROUP BY auction_number
            ORDER BY auction_number DESC
            LIMIT 10;
        `);
        
        console.log('📋 Тренды по последним 10 аукционам:');
        auctionTrends.rows.forEach((row, index) => {
            const date = new Date(row.start_date).toLocaleDateString('ru-RU');
            console.log(`  ${index + 1}. Аукцион ${row.auction_number} (${date}): ${row.lots_count} лотов, средняя цена: ${Math.round(row.avg_price).toLocaleString()}₽`);
        });
    }

    async generateInsights() {
        console.log('\n💡 КЛЮЧЕВЫЕ ИНСАЙТЫ ДЛЯ ПРОГНОЗИРОВАНИЯ:');
        
        // Находим самые дорогие лоты
        const expensiveLots = await this.dbClient.query(`
            SELECT 
                lot_number,
                auction_number,
                condition,
                metal,
                weight,
                winning_bid,
                coin_description
            FROM auction_lots 
            WHERE winning_bid IS NOT NULL 
                AND winning_bid > 0
            ORDER BY winning_bid DESC
            LIMIT 10;
        `);
        
        console.log('\n🏆 Топ-10 самых дорогих лотов:');
        expensiveLots.rows.forEach((lot, index) => {
            console.log(`  ${index + 1}. Лот ${lot.lot_number} (Аукцион ${lot.auction_number}): ${Math.round(lot.winning_bid).toLocaleString()}₽`);
            console.log(`     ${lot.condition} | ${lot.metal} | ${lot.weight}г | ${lot.coin_description?.substring(0, 50)}...`);
        });
        
        // Анализ редких состояний
        const rareConditions = await this.dbClient.query(`
            SELECT 
                condition,
                COUNT(*) as frequency,
                AVG(winning_bid) as avg_price
            FROM auction_lots 
            WHERE winning_bid IS NOT NULL 
                AND winning_bid > 0
                AND condition IS NOT NULL
            GROUP BY condition
            HAVING COUNT(*) <= 5
            ORDER BY avg_price DESC;
        `);
        
        console.log('\n💎 Редкие состояния с высокой ценой:');
        rareConditions.rows.forEach((row, index) => {
            console.log(`  ${index + 1}. "${row.condition}": ${row.frequency} лотов, средняя цена: ${Math.round(row.avg_price).toLocaleString()}₽`);
        });
    }

    async run() {
        try {
            await this.init();
            
            console.log('🔍 АНАЛИЗ ИСТОРИЧЕСКИХ ДАННЫХ О ЦЕНАХ ЛОТОВ');
            console.log('📋 Цель: выявить ключевые факторы для прогнозирования цен');
            
            await this.analyzePriceCorrelations();
            await this.analyzeMarketTrends();
            await this.generateInsights();
            
            console.log('\n✅ Анализ завершен! Данные готовы для создания модели прогнозирования.');
            
        } catch (error) {
            console.error('❌ Ошибка анализа:', error.message);
        } finally {
            await this.dbClient.end();
        }
    }
}

// Запуск анализа
async function main() {
    const analyzer = new PriceDataAnalyzer();
    await analyzer.run();
}

main();

const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool(config.dbConfig);

async function debugMetalsDates() {
    try {
        console.log('🔍 Проверяем наличие данных о ценах на металлы для дат аукционов...');
        
        // Получаем уникальные даты аукционов
        const datesQuery = `
            SELECT DISTINCT auction_end_date
            FROM auction_lots 
            WHERE metal = 'Au' 
              AND coin_description ILIKE '%комплекс%'
              AND weight IS NOT NULL
            ORDER BY auction_end_date DESC
        `;
        
        const datesResult = await pool.query(datesQuery);
        
        console.log(`📅 Найдено уникальных дат: ${datesResult.rows.length}`);
        
        for (const row of datesResult.rows) {
            const auctionDate = new Date(row.auction_end_date).toISOString().split('T')[0];
            console.log(`\n📅 Дата аукциона: ${auctionDate}`);
            
            // Проверяем, есть ли данные о ценах на эту дату
            const metalsQuery = `
                SELECT date, gold_price, usd_rate
                FROM metals_prices 
                WHERE date = $1::date
            `;
            
            const metalsResult = await pool.query(metalsQuery, [auctionDate]);
            
            if (metalsResult.rows.length > 0) {
                const metalsData = metalsResult.rows[0];
                console.log(`   ✅ Данные о ценах найдены:`);
                console.log(`      - Цена золота: ${metalsData.gold_price} ₽/г`);
                console.log(`      - Курс USD: ${metalsData.usd_rate}`);
            } else {
                console.log(`   ❌ Данные о ценах НЕ найдены`);
            }
        }
        
    } catch (error) {
        console.error('❌ Ошибка:', error);
    } finally {
        await pool.end();
    }
}

debugMetalsDates();

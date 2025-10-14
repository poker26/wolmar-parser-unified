const { Client } = require('pg');
const config = require('./config');

async function checkCategoriesInAuctionLots() {
    const client = new Client(config.dbConfig);
    
    try {
        await client.connect();
        console.log('✅ Подключено к базе данных');
        
        // Проверяем общее количество записей
        const totalResult = await client.query('SELECT COUNT(*) as total FROM auction_lots');
        console.log(`📊 Всего лотов в auction_lots: ${totalResult.rows[0].total}`);
        
        // Проверяем количество лотов с категориями
        const categoryResult = await client.query(`
            SELECT COUNT(*) as count 
            FROM auction_lots 
            WHERE category IS NOT NULL AND category != ''
        `);
        console.log(`📋 Лотов с категориями: ${categoryResult.rows[0].count}`);
        
        // Проверяем уникальные категории
        const uniqueCategoriesResult = await client.query(`
            SELECT DISTINCT category, COUNT(*) as count
            FROM auction_lots 
            WHERE category IS NOT NULL AND category != ''
            GROUP BY category 
            ORDER BY count DESC
        `);
        
        console.log('🏷️ Уникальные категории:');
        uniqueCategoriesResult.rows.forEach((row, index) => {
            console.log(`   ${index + 1}. ${row.category}: ${row.count} лотов`);
        });
        
        // Проверяем последние добавленные лоты с категориями
        const recentResult = await client.query(`
            SELECT lot_number, auction_number, category, coin_description
            FROM auction_lots 
            WHERE category IS NOT NULL AND category != ''
            ORDER BY id DESC
            LIMIT 5
        `);
        
        console.log('🆕 Последние лоты с категориями:');
        recentResult.rows.forEach((row, index) => {
            console.log(`   ${index + 1}. Лот ${row.lot_number} (аукцион ${row.auction_number}): ${row.category}`);
            console.log(`      Описание: ${row.coin_description?.substring(0, 100)}...`);
        });
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    } finally {
        await client.end();
    }
}

checkCategoriesInAuctionLots();



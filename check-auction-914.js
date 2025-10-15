const { Pool } = require('pg');
const config = require('./config');

async function checkAuction914() {
    console.log('🔍 ПРОВЕРКА ЛОТОВ ДЛЯ АУКЦИОНА 914 (Wolmar ID: 2070)');
    console.log('==================================================');
    
    const pool = new Pool(config.dbConfig);
    
    try {
        console.log('\n1️⃣ Подключаемся к базе данных...');
        
        console.log('\n2️⃣ Проверяем количество лотов в категории "Боны" для аукциона 914...');
        const countResult = await pool.query(`
            SELECT COUNT(*) as count 
            FROM auction_lots 
            WHERE auction_number = '914' AND category = 'Боны'
        `);
        console.log(`📊 Лотов в БД для аукциона 914, категория "Боны": ${countResult.rows[0].count}`);
        
        console.log('\n3️⃣ Проверяем все категории для аукциона 914...');
        const categoriesResult = await pool.query(`
            SELECT category, COUNT(*) as count
            FROM auction_lots 
            WHERE auction_number = '914'
            GROUP BY category
            ORDER BY count DESC
        `);
        console.log('📊 Категории в БД для аукциона 914:');
        categoriesResult.rows.forEach(cat => {
            console.log(`   ${cat.category}: ${cat.count} лотов`);
        });
        
        console.log('\n4️⃣ Проверяем последние добавленные лоты для аукциона 914...');
        const recentResult = await pool.query(`
            SELECT lot_number, category, coin_description
            FROM auction_lots 
            WHERE auction_number = '914'
            ORDER BY id DESC 
            LIMIT 10
        `);
        console.log('📋 Последние 10 лотов в БД для аукциона 914:');
        recentResult.rows.forEach((lot, index) => {
            console.log(`   ${index + 1}. Лот ${lot.lot_number} | ${lot.category} | ${lot.coin_description?.substring(0, 50)}...`);
        });
        
        console.log('\n5️⃣ Проверяем общее количество лотов для аукциона 914...');
        const totalResult = await pool.query(`
            SELECT COUNT(*) as total
            FROM auction_lots 
            WHERE auction_number = '914'
        `);
        console.log(`📊 Общее количество лотов для аукциона 914: ${totalResult.rows[0].total}`);
        
        console.log('\n6️⃣ Проверяем соответствие parsing_number и auction_number...');
        const mappingResult = await pool.query(`
            SELECT DISTINCT auction_number, parsing_number
            FROM auction_lots 
            WHERE parsing_number = '2070' OR auction_number = '914'
            ORDER BY auction_number
        `);
        console.log('📊 Соответствие номеров:');
        mappingResult.rows.forEach(row => {
            console.log(`   Аукцион: ${row.auction_number} | Parsing: ${row.parsing_number}`);
        });
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
        console.error('❌ Стек ошибки:', error.stack);
    } finally {
        await pool.end();
    }
}

if (require.main === module) {
    checkAuction914();
}

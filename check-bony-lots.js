const { Pool } = require('pg');
const config = require('./config');

async function checkBonyLots() {
    console.log('🔍 ПРОВЕРКА ЛОТОВ КАТЕГОРИИ "БОНЫ" ДЛЯ АУКЦИОНА 2070');
    console.log('==================================================');
    
    const pool = new Pool(config.dbConfig);
    
    try {
        console.log('\n1️⃣ Подключаемся к базе данных...');
        
        console.log('\n2️⃣ Проверяем количество лотов в категории "Боны" для аукциона 2070...');
        const countResult = await pool.query(`
            SELECT COUNT(*) as count 
            FROM auction_lots 
            WHERE auction_number = '2070' AND category = 'Боны'
        `);
        console.log(`📊 Лотов в БД для аукциона 2070, категория "Боны": ${countResult.rows[0].count}`);
        
        console.log('\n3️⃣ Проверяем все категории для аукциона 2070...');
        const categoriesResult = await pool.query(`
            SELECT category, COUNT(*) as count
            FROM auction_lots 
            WHERE auction_number = '2070'
            GROUP BY category
            ORDER BY count DESC
        `);
        console.log('📊 Категории в БД для аукциона 2070:');
        categoriesResult.rows.forEach(cat => {
            console.log(`   ${cat.category}: ${cat.count} лотов`);
        });
        
        console.log('\n4️⃣ Проверяем последние добавленные лоты для аукциона 2070...');
        const recentResult = await pool.query(`
            SELECT lot_number, category, coin_description
            FROM auction_lots 
            WHERE auction_number = '2070'
            ORDER BY id DESC 
            LIMIT 10
        `);
        console.log('📋 Последние 10 лотов в БД для аукциона 2070:');
        recentResult.rows.forEach((lot, index) => {
            console.log(`   ${index + 1}. Лот ${lot.lot_number} | ${lot.category} | ${lot.coin_description?.substring(0, 50)}...`);
        });
        
        console.log('\n5️⃣ Проверяем общее количество лотов для аукциона 2070...');
        const totalResult = await pool.query(`
            SELECT COUNT(*) as total
            FROM auction_lots 
            WHERE auction_number = '2070'
        `);
        console.log(`📊 Общее количество лотов для аукциона 2070: ${totalResult.rows[0].total}`);
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
        console.error('❌ Стек ошибки:', error.stack);
    } finally {
        await pool.end();
    }
}

if (require.main === module) {
    checkBonyLots();
}

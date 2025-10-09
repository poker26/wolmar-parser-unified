const { Pool } = require('pg');
const config = require('./config');

async function checkSnCoins() {
    const pool = new Pool(config.database);
    
    try {
        console.log('🔍 Проверяем наличие монет с металлом Sn...');
        
        // Сначала проверим, есть ли вообще записи в каталоге
        const countQuery = 'SELECT COUNT(*) as total FROM coin_catalog';
        const countResult = await pool.query(countQuery);
        console.log(`📊 Всего записей в каталоге: ${countResult.rows[0].total}`);
        
        // Проверим уникальные металлы
        const metalsQuery = 'SELECT DISTINCT metal FROM coin_catalog WHERE metal IS NOT NULL ORDER BY metal';
        const metalsResult = await pool.query(metalsQuery);
        console.log('\n🔍 Уникальные металлы в каталоге:');
        metalsResult.rows.forEach((row, index) => {
            console.log(`${index + 1}. ${row.metal}`);
        });
        
        // Проверим конкретно Sn
        const snQuery = 'SELECT COUNT(*) as count FROM coin_catalog WHERE metal = $1';
        const snResult = await pool.query(snQuery, ['Sn']);
        console.log(`\n📊 Монет с металлом Sn: ${snResult.rows[0].count}`);
        
        // Если есть, покажем несколько примеров
        if (snResult.rows[0].count > 0) {
            const examplesQuery = `
                SELECT id, denomination, coin_name, year, metal, mint, condition
                FROM coin_catalog 
                WHERE metal = 'Sn'
                LIMIT 5
            `;
            const examplesResult = await pool.query(examplesQuery);
            console.log('\n📋 Примеры монет Sn:');
            examplesResult.rows.forEach((coin, index) => {
                console.log(`${index + 1}. ID: ${coin.id} | ${coin.denomination} ${coin.coin_name} | ${coin.year || 'без года'} | ${coin.mint || 'неизвестный двор'}`);
            });
        }
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
        console.error('Stack:', error.stack);
    } finally {
        await pool.end();
    }
}

checkSnCoins();

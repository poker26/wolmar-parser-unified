const { Pool } = require('pg');
const config = require('./config');

async function checkServerConfig() {
    const pool = new Pool(config.dbConfig);
    
    try {
        console.log('🔍 Проверка конфигурации сервера:\n');
        
        // Проверим подключение к БД
        console.log('📊 Подключение к БД:');
        console.log(`Host: ${config.dbConfig.host}`);
        console.log(`Database: ${config.dbConfig.database}`);
        console.log(`Port: ${config.dbConfig.port}`);
        console.log(`User: ${config.dbConfig.user}`);
        
        // Проверим количество записей в каталоге
        const countQuery = 'SELECT COUNT(*) FROM coin_catalog';
        const countResult = await pool.query(countQuery);
        console.log(`\n📊 Записей в каталоге: ${countResult.rows[0].count}`);
        
        // Проверим последние записи
        const recentQuery = `
            SELECT 
                id, auction_number, lot_number, coin_name, year, metal,
                LENGTH(avers_image_data) as avers_size,
                LENGTH(revers_image_data) as revers_size
            FROM coin_catalog 
            ORDER BY id DESC 
            LIMIT 5
        `;
        
        const recentResult = await pool.query(recentQuery);
        console.log('\n📊 Последние 5 записей:');
        recentResult.rows.forEach((row, index) => {
            console.log(`${index + 1}. ID:${row.id} ${row.auction_number}-${row.lot_number} ${row.coin_name} (${row.metal}) ${row.year}г. [${row.avers_size}/${row.revers_size}]`);
        });
        
        // Проверим конкретный лот 968-52
        const lotQuery = `
            SELECT 
                id, auction_number, lot_number, coin_name, year, metal,
                avers_image_url, revers_image_url,
                LENGTH(avers_image_data) as avers_size,
                LENGTH(revers_image_data) as revers_size
            FROM coin_catalog 
            WHERE auction_number = '968' AND lot_number = '52'
        `;
        
        const lotResult = await pool.query(lotQuery);
        if (lotResult.rows.length > 0) {
            const lot = lotResult.rows[0];
            console.log('\n🎯 Лот 968-52:');
            console.log(`ID: ${lot.id}`);
            console.log(`Монета: ${lot.coin_name} (${lot.metal}) ${lot.year}г.`);
            console.log(`Аверс URL: ${lot.avers_image_url}`);
            console.log(`Реверс URL: ${lot.revers_image_url}`);
            console.log(`Размеры: ${lot.avers_size}/${lot.revers_size} байт`);
        } else {
            console.log('\n❌ Лот 968-52 не найден');
        }
        
    } catch (error) {
        console.error('❌ Ошибка:', error);
    } finally {
        await pool.end();
    }
}

checkServerConfig();







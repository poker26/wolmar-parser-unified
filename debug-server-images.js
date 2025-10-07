const { Pool } = require('pg');
const config = require('./config');

async function debugServerImages() {
    const pool = new Pool(config.dbConfig);
    
    try {
        console.log('🔍 Диагностика проблемы с изображениями на сервере:\n');
        
        // Проверим данные в БД для лота 968-52
        const query = `
            SELECT 
                id, lot_id, auction_number, lot_number,
                denomination, coin_name, year, metal,
                avers_image_url, revers_image_url,
                LENGTH(avers_image_data) as avers_size,
                LENGTH(revers_image_data) as revers_size,
                SUBSTRING(avers_image_data FROM 1 FOR 10) as avers_start,
                SUBSTRING(revers_image_data FROM 1 FOR 10) as revers_start
            FROM coin_catalog 
            WHERE auction_number = '968' AND lot_number = '52'
        `;
        
        const result = await pool.query(query);
        
        if (result.rows.length === 0) {
            console.log('❌ Лот 968-52 не найден в БД');
            return;
        }
        
        const lot = result.rows[0];
        console.log('📊 Данные лота 968-52 в БД:');
        console.log(`ID: ${lot.id}`);
        console.log(`Лот: ${lot.auction_number}-${lot.lot_number}`);
        console.log(`Монета: ${lot.denomination} ${lot.coin_name} (${lot.metal}) ${lot.year}г.`);
        console.log(`Аверс URL: ${lot.avers_image_url}`);
        console.log(`Реверс URL: ${lot.revers_image_url}`);
        console.log(`Размер аверса: ${lot.avers_size} байт`);
        console.log(`Размер реверса: ${lot.revers_size} байт`);
        console.log(`Начало аверса: ${lot.avers_start}`);
        console.log(`Начало реверса: ${lot.revers_start}`);
        
        // Проверим, есть ли другие лоты с такими же изображениями
        const duplicateQuery = `
            SELECT 
                auction_number, lot_number, coin_name, year, metal,
                LENGTH(avers_image_data) as avers_size,
                LENGTH(revers_image_data) as revers_size
            FROM coin_catalog 
            WHERE avers_image_data = $1 OR revers_image_data = $2
            AND id != $3
        `;
        
        const duplicateResult = await pool.query(duplicateQuery, [
            lot.avers_image_data, 
            lot.revers_image_data, 
            lot.id
        ]);
        
        if (duplicateResult.rows.length > 0) {
            console.log('\n⚠️ Найдены другие лоты с такими же изображениями:');
            duplicateResult.rows.forEach(row => {
                console.log(`- ${row.auction_number}-${row.lot_number}: ${row.coin_name} (${row.metal}) ${row.year}г.`);
                console.log(`  Размер аверса: ${row.avers_size}, реверса: ${row.revers_size}`);
            });
        } else {
            console.log('\n✅ Изображения уникальны');
        }
        
        // Проверим, есть ли лоты с серебряными монетами 25 пенни 1863г
        const silverQuery = `
            SELECT 
                auction_number, lot_number, coin_name, year, metal,
                LENGTH(avers_image_data) as avers_size,
                LENGTH(revers_image_data) as revers_size
            FROM coin_catalog 
            WHERE coin_name ILIKE '%25 пенни%' 
            OR (coin_name ILIKE '%пенни%' AND year = 1863)
            ORDER BY id DESC
            LIMIT 5
        `;
        
        const silverResult = await pool.query(silverQuery);
        
        if (silverResult.rows.length > 0) {
            console.log('\n🔍 Найдены серебряные монеты 25 пенни:');
            silverResult.rows.forEach(row => {
                console.log(`- ${row.auction_number}-${row.lot_number}: ${row.coin_name} (${row.metal}) ${row.year}г.`);
                console.log(`  Размер аверса: ${row.avers_size}, реверса: ${row.revers_size}`);
            });
        }
        
    } catch (error) {
        console.error('❌ Ошибка:', error);
    } finally {
        await pool.end();
    }
}

debugServerImages();







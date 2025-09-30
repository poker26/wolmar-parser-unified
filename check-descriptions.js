const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool(config.dbConfig);

async function checkDescriptions() {
    const client = await pool.connect();
    try {
        console.log('🔍 Проверка описаний лотов на наличие информации о весе...\n');

        // Ищем описания с упоминанием веса или пробы
        const result = await client.query(`
            SELECT id, coin_name, original_description 
            FROM coin_catalog 
            WHERE original_description ILIKE '%вес%' 
               OR original_description ILIKE '%гр%'
               OR original_description ILIKE '%Au %'
               OR original_description ILIKE '%Ag %'
               OR original_description ILIKE '%проба%'
            LIMIT 10
        `);
        
        console.log(`📊 Найдено описаний с упоминанием веса: ${result.rows.length}\n`);
        
        result.rows.forEach((row, index) => {
            console.log(`${index + 1}. ID: ${row.id}`);
            console.log(`   Название: ${row.coin_name}`);
            console.log(`   Описание: ${row.original_description}`);
            console.log('');
        });

        // Проверяем общее количество записей
        const countResult = await client.query('SELECT COUNT(*) FROM coin_catalog');
        console.log(`📊 Всего записей в каталоге: ${countResult.rows[0].count}`);

    } catch (error) {
        console.error('❌ Ошибка при проверке описаний:', error);
    } finally {
        client.release();
        await pool.end();
    }
}

checkDescriptions();



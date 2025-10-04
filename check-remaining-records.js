const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool(config.dbConfig);

async function checkRemainingRecords() {
    const client = await pool.connect();
    try {
        console.log('🔍 Проверка оставшихся записей в БД...\n');

        const result = await client.query('SELECT id, coin_name, metal, coin_weight, fineness FROM coin_catalog ORDER BY id');
        
        console.log(`📊 Найдено записей: ${result.rows.length}`);
        
        result.rows.forEach((row, index) => {
            console.log(`${index + 1}. ID: ${row.id}`);
            console.log(`   Название: ${row.coin_name}`);
            console.log(`   Металл: ${row.metal || 'не указан'}`);
            console.log(`   Вес: ${row.coin_weight || 'не указан'}`);
            console.log(`   Проба: ${row.fineness || 'не указана'}`);
            console.log('');
        });

    } catch (error) {
        console.error('❌ Ошибка при проверке записей:', error);
    } finally {
        client.release();
        await pool.end();
    }
}

checkRemainingRecords();





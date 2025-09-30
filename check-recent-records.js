const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool(config.dbConfig);

async function checkRecentRecords() {
    const client = await pool.connect();
    try {
        console.log('🔍 Проверка последних записей в каталоге...\n');

        // Общее количество записей
        const totalResult = await client.query('SELECT COUNT(*) FROM coin_catalog');
        console.log(`📊 Всего записей в каталоге: ${totalResult.rows[0].count}`);

        // Последние 5 записей
        const recentResult = await client.query(`
            SELECT id, coin_name, metal, coin_weight, fineness, pure_metal_weight, weight_oz, original_description
            FROM coin_catalog 
            ORDER BY id DESC
            LIMIT 5
        `);
        
        console.log('\n📋 Последние 5 записей:');
        recentResult.rows.forEach((row, index) => {
            console.log(`\n${index + 1}. ID: ${row.id}`);
            console.log(`   Название: ${row.coin_name}`);
            console.log(`   Металл: ${row.metal || 'не указан'}`);
            console.log(`   Вес монеты: ${row.coin_weight || 'не указан'}г`);
            console.log(`   Проба: ${row.fineness || 'не указана'}`);
            console.log(`   Чистый металл: ${row.pure_metal_weight || 'не указан'}г`);
            console.log(`   Вес в унциях: ${row.weight_oz || 'не указан'}oz`);
            console.log(`   Описание: ${row.original_description.substring(0, 100)}...`);
        });

        // Проверяем записи с заполненными полями веса
        const weightResult = await client.query(`
            SELECT COUNT(*) 
            FROM coin_catalog 
            WHERE coin_weight IS NOT NULL OR fineness IS NOT NULL OR pure_metal_weight IS NOT NULL
        `);
        console.log(`\n📊 Записей с данными о весе: ${weightResult.rows[0].count}`);

    } catch (error) {
        console.error('❌ Ошибка при проверке записей:', error);
    } finally {
        client.release();
        await pool.end();
    }
}

checkRecentRecords();



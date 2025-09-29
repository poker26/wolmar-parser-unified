const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool(config.dbConfig);

async function findWeightRecord() {
    const client = await pool.connect();
    
    try {
        console.log('🔍 Поиск записи с данными о весе...\n');
        
        // Ищем записи с данными о весе
        const query = `
            SELECT id, lot_id, coin_name, metal, coin_weight, fineness, pure_metal_weight, weight_oz, original_description
            FROM coin_catalog
            WHERE coin_weight IS NOT NULL
            ORDER BY id DESC;
        `;
        
        const result = await client.query(query);
        
        console.log(`📊 Найдено записей с данными о весе: ${result.rows.length}\n`);
        
        for (const [index, row] of result.rows.entries()) {
            console.log(`--- Запись ${index + 1} ---`);
            console.log(`ID: ${row.id}, Лот ID: ${row.lot_id}`);
            console.log(`Название: ${row.coin_name}`);
            console.log(`Металл: ${row.metal}`);
            console.log(`Вес монеты: ${row.coin_weight}г`);
            console.log(`Проба: ${row.fineness}`);
            console.log(`Чистый металл: ${row.pure_metal_weight}г`);
            console.log(`Вес в унциях: ${row.weight_oz}oz`);
            console.log(`Описание: ${row.original_description.substring(0, 100)}...`);
            console.log('');
        }
        
    } catch (error) {
        console.error('❌ Ошибка при поиске записи с весом:', error);
    } finally {
        client.release();
        await pool.end();
    }
}

findWeightRecord();

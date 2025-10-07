const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool(config.dbConfig);

async function checkSpecificLots() {
    const client = await pool.connect();
    
    try {
        console.log('🔍 Проверка конкретных лотов 1391-1404...\n');
        
        // Проверяем, есть ли записи для лотов 1391-1404
        const query = `
            SELECT lot_id, coin_name, metal, coin_weight, fineness, pure_metal_weight
            FROM coin_catalog
            WHERE lot_id >= 1391 AND lot_id <= 1404
            ORDER BY lot_id;
        `;
        
        const result = await client.query(query);
        
        console.log(`📊 Найдено записей для лотов 1391-1404: ${result.rows.length}\n`);
        
        if (result.rows.length > 0) {
            for (const [index, row] of result.rows.entries()) {
                console.log(`--- Лот ${index + 1} ---`);
                console.log(`ID: ${row.lot_id}, Название: ${row.coin_name}, Металл: ${row.metal}`);
                console.log(`Вес: ${row.coin_weight}г, Проба: ${row.fineness}, Чистый: ${row.pure_metal_weight}г`);
                console.log('');
            }
        } else {
            console.log('❌ Записи для лотов 1391-1404 не найдены');
            console.log('Это означает, что парсер их не обработал');
        }
        
    } catch (error) {
        console.error('❌ Ошибка при проверке конкретных лотов:', error);
    } finally {
        client.release();
        await pool.end();
    }
}

checkSpecificLots();







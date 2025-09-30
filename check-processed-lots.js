const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool(config.dbConfig);

async function checkProcessedLots() {
    const client = await pool.connect();
    
    try {
        console.log('🔍 Проверка обработанных лотов...\n');
        
        // Получаем последние записи в каталоге
        const catalogQuery = `
            SELECT lot_id, coin_name, metal, coin_weight, fineness, pure_metal_weight
            FROM coin_catalog
            ORDER BY id DESC
            LIMIT 10;
        `;
        
        const catalogResult = await client.query(catalogQuery);
        
        console.log(`📊 Последние записи в каталоге:`);
        catalogResult.rows.forEach((row, index) => {
            console.log(`${index + 1}. ID: ${row.lot_id}, Название: ${row.coin_name}, Металл: ${row.metal}`);
            console.log(`   Вес: ${row.coin_weight}г, Проба: ${row.fineness}, Чистый: ${row.pure_metal_weight}г`);
        });
        
        // Проверяем, есть ли записи с весом
        const weightQuery = `
            SELECT COUNT(*) as count
            FROM coin_catalog
            WHERE coin_weight IS NOT NULL;
        `;
        
        const weightResult = await client.query(weightQuery);
        console.log(`\n📊 Записей с данными о весе: ${weightResult.rows[0].count}`);
        
        // Проверяем, дошел ли парсер до лотов с весом (ID 1391+)
        const highIdQuery = `
            SELECT MAX(lot_id) as max_lot_id
            FROM coin_catalog;
        `;
        
        const highIdResult = await client.query(highIdQuery);
        console.log(`📊 Максимальный ID обработанного лота: ${highIdResult.rows[0].max_lot_id}`);
        
        if (highIdResult.rows[0].max_lot_id >= 1391) {
            console.log('✅ Парсер дошел до лотов с весом!');
        } else {
            console.log('⏳ Парсер еще не дошел до лотов с весом (ID 1391+)');
        }
        
    } catch (error) {
        console.error('❌ Ошибка при проверке лотов:', error);
    } finally {
        client.release();
        await pool.end();
    }
}

checkProcessedLots();



const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool(config.dbConfig);

async function checkWeightLotsDescriptions() {
    const client = await pool.connect();
    
    try {
        console.log('🔍 Проверка описаний лотов с весом...\n');
        
        // Проверяем лоты с ID 1391-1404
        const query = `
            SELECT id, auction_number, lot_number, coin_description
            FROM auction_lots
            WHERE id >= 1391 AND id <= 1404
            ORDER BY id;
        `;
        
        const result = await client.query(query);
        
        console.log(`📊 Найдено лотов с ID 1391-1404: ${result.rows.length}\n`);
        
        for (const [index, row] of result.rows.entries()) {
            console.log(`--- Лот ${index + 1} ---`);
            console.log(`ID: ${row.id}, Аукцион: ${row.auction_number}, Лот: ${row.lot_number}`);
            console.log(`Описание: ${row.coin_description ? row.coin_description.substring(0, 100) + '...' : 'NULL'}`);
            console.log(`Длина описания: ${row.coin_description ? row.coin_description.length : 0} символов`);
            console.log('');
        }
        
    } catch (error) {
        console.error('❌ Ошибка при проверке описаний лотов с весом:', error);
    } finally {
        client.release();
        await pool.end();
    }
}

checkWeightLotsDescriptions();







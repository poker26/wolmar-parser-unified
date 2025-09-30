const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool(config.dbConfig);

async function checkSilverLots() {
    const client = await pool.connect();
    try {
        console.log('🔍 Поиск лотов с серебром и информацией о весе...\n');

        // Ищем лоты с серебром, которые содержат информацию о весе
        const query = `
            SELECT id, coin_description, auction_number, lot_number
            FROM auction_lots 
            WHERE coin_description ILIKE '%Ag%' 
            AND (coin_description ILIKE '%гр%' OR coin_description ILIKE '%oz%' OR coin_description ILIKE '%Au %' OR coin_description ILIKE '%Ag %' OR coin_description ILIKE '%Pt %' OR coin_description ILIKE '%Pd %')
            ORDER BY id DESC
            LIMIT 5
        `;
        
        const result = await client.query(query);
        
        console.log(`📊 Найдено лотов с серебром и весом: ${result.rows.length}\n`);
        
        result.rows.forEach((row, index) => {
            console.log(`${index + 1}. ID: ${row.id}, Аукцион: ${row.auction_number}, Лот: ${row.lot_number}`);
            console.log(`   Описание: ${row.coin_description.substring(0, 150)}...`);
            console.log('');
        });

    } catch (error) {
        console.error('❌ Ошибка при поиске лотов с серебром:', error);
    } finally {
        client.release();
        await pool.end();
    }
}

checkSilverLots();

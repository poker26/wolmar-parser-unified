const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool(config.dbConfig);

async function findSilverWithWeight() {
    const client = await pool.connect();
    try {
        console.log('🔍 Поиск лотов серебра с явным указанием веса...\n');

        // Ищем лоты с серебром, которые содержат информацию о весе
        const query = `
            SELECT id, coin_description, auction_number, lot_number
            FROM auction_lots 
            WHERE coin_description ILIKE '%Ag%' 
            AND (coin_description ILIKE '%гр%' OR coin_description ILIKE '%oz%' OR coin_description ILIKE '%вес%')
            ORDER BY id DESC
            LIMIT 3
        `;
        
        const result = await client.query(query);
        
        console.log(`📊 Найдено лотов серебра с весом: ${result.rows.length}\n`);
        
        result.rows.forEach((row, index) => {
            console.log(`${index + 1}. ID: ${row.id}, Аукцион: ${row.auction_number}, Лот: ${row.lot_number}`);
            console.log(`   Описание: ${row.coin_description}`);
            console.log('');
        });

    } catch (error) {
        console.error('❌ Ошибка при поиске лотов серебра:', error);
    } finally {
        client.release();
        await pool.end();
    }
}

findSilverWithWeight();





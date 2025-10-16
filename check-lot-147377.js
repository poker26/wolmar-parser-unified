const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool(config.dbConfig);

async function checkLot() {
    try {
        console.log('🔍 Проверяем лот 147377 в базе данных...');
        
        const lotQuery = `
            SELECT id, parsing_number, auction_number, lot_number, coin_description
            FROM auction_lots 
            WHERE id = $1
        `;
        
        const result = await pool.query(lotQuery, [147377]);
        
        if (result.rows.length === 0) {
            console.log('❌ Лот 147377 не найден в базе данных');
            
            // Проверим, есть ли лоты с похожими ID
            const similarQuery = `
                SELECT id, parsing_number, auction_number, lot_number
                FROM auction_lots 
                WHERE id BETWEEN 147370 AND 147380
                ORDER BY id
            `;
            const similarResult = await pool.query(similarQuery);
            console.log('🔍 Похожие лоты:', similarResult.rows);
            
        } else {
            const lot = result.rows[0];
            console.log('✅ Лот найден:');
            console.log(`   ID: ${lot.id}`);
            console.log(`   parsing_number: ${lot.parsing_number} (тип: ${typeof lot.parsing_number})`);
            console.log(`   auction_number: ${lot.auction_number} (тип: ${typeof lot.auction_number})`);
            console.log(`   lot_number: ${lot.lot_number}`);
            console.log(`   Описание: ${lot.coin_description ? lot.coin_description.substring(0, 100) + '...' : 'Нет'}`);
            
            if (!lot.parsing_number) {
                console.log('⚠️ У лота отсутствует parsing_number!');
            }
        }
        
    } catch (error) {
        console.error('❌ Ошибка проверки лота:', error);
    } finally {
        await pool.end();
    }
}

checkLot();

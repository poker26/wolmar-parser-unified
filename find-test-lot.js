const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool(config.dbConfig);

async function findTestLot() {
    try {
        console.log('🔍 Ищем лот с весом и ценой для тестирования...');
        
        const query = `
            SELECT id, lot_number, auction_number, coin_description, 
                   winning_bid, auction_end_date, metal, weight
            FROM auction_lots 
            WHERE weight IS NOT NULL 
              AND winning_bid IS NOT NULL 
              AND winning_bid > 0
              AND metal IS NOT NULL
              AND auction_end_date IS NOT NULL
            ORDER BY winning_bid DESC
            LIMIT 5
        `;
        
        const result = await pool.query(query);
        
        console.log('📋 Найдено лотов с полными данными:', result.rows.length);
        
        result.rows.forEach((lot, index) => {
            console.log(`\n${index + 1}. Лот ID: ${lot.id}`);
            console.log(`   Номер лота: ${lot.lot_number}`);
            console.log(`   Аукцион: ${lot.auction_number}`);
            console.log(`   Металл: ${lot.metal}`);
            console.log(`   Вес: ${lot.weight} г`);
            console.log(`   Цена: ${lot.winning_bid} ₽`);
            console.log(`   Дата аукциона: ${lot.auction_end_date}`);
            console.log(`   Описание: ${lot.coin_description.substring(0, 100)}...`);
        });
        
        if (result.rows.length > 0) {
            const testLot = result.rows[0];
            console.log(`\n🧪 Для тестирования используем лот ID: ${testLot.id}`);
        }
        
    } catch (error) {
        console.error('❌ Ошибка:', error);
    } finally {
        await pool.end();
    }
}

findTestLot();

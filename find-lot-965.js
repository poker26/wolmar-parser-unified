const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool(config.dbConfig);

async function findLot965() {
    try {
        console.log('🔍 Ищем лот из аукциона 965 (4 сентября 2025) с весом и ценой...');
        
        const query = `
            SELECT id, lot_number, auction_number, coin_description, 
                   winning_bid, auction_end_date, metal, weight
            FROM auction_lots 
            WHERE auction_number = '965'
              AND weight IS NOT NULL 
              AND winning_bid IS NOT NULL 
              AND winning_bid > 0
              AND metal IS NOT NULL
              AND auction_end_date IS NOT NULL
            ORDER BY winning_bid DESC
            LIMIT 3
        `;
        
        const result = await pool.query(query);
        
        console.log('📋 Найдено лотов в аукционе 965:', result.rows.length);
        
        result.rows.forEach((lot, index) => {
            console.log(`\n${index + 1}. Лот ID: ${lot.id}`);
            console.log(`   Номер лота: ${lot.lot_number}`);
            console.log(`   Аукцион: ${lot.auction_number}`);
            console.log(`   Металл: ${lot.metal}`);
            console.log(`   Вес: ${lot.weight} г`);
            console.log(`   Цена: ${lot.winning_bid} ₽`);
            console.log(`   Дата аукциона: ${lot.auction_end_date}`);
            console.log(`   Описание: ${lot.coin_description.substring(0, 80)}...`);
        });
        
    } catch (error) {
        console.error('❌ Ошибка:', error);
    } finally {
        await pool.end();
    }
}

findLot965();

const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool(config.dbConfig);

async function checkLot113() {
    try {
        // Ищем лот 113 в аукционе 970
        const result = await pool.query(`
            SELECT id, lot_number, auction_number, winning_bid, winner_login, source_url
            FROM auction_lots 
            WHERE lot_number = '113' AND auction_number = '970'
            ORDER BY id DESC
            LIMIT 5
        `);
        
        console.log('📊 Найдено лотов:', result.rows.length);
        result.rows.forEach((lot, index) => {
            console.log(`📊 Лот ${index + 1}:`, {
                id: lot.id,
                lot_number: lot.lot_number,
                auction_number: lot.auction_number,
                winning_bid: lot.winning_bid,
                winner_login: lot.winner_login,
                source_url: lot.source_url
            });
        });
        
    } catch (error) {
        console.error('❌ Ошибка:', error);
    } finally {
        await pool.end();
    }
}

checkLot113();

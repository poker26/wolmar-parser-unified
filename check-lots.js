const { Client } = require('pg');
const config = require('./config');

async function checkLots() {
    const client = new Client(config.dbConfig);
    try {
        await client.connect();
        
        // Получаем лот №3 аукциона 967
        const lot3 = await client.query(`
            SELECT id, lot_number, coin_description, metal, condition, year, letters, winning_bid 
            FROM auction_lots 
            WHERE auction_number = $1 AND lot_number = $2
        `, [967, '3']);
        console.log('Лот №3:');
        console.log(lot3.rows[0]);
        
        // Получаем лот №88 аукциона 967
        const lot88 = await client.query(`
            SELECT id, lot_number, coin_description, metal, condition, year, letters, winning_bid 
            FROM auction_lots 
            WHERE auction_number = $1 AND lot_number = $2
        `, [967, '88']);
        console.log('\nЛот №88:');
        console.log(lot88.rows[0]);
        
    } catch (error) {
        console.error('Ошибка:', error);
    } finally {
        await client.end();
    }
}

checkLots();

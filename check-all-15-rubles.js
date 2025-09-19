const { Client } = require('pg');
const config = require('./config');

async function checkAll15Rubles() {
    const client = new Client(config.dbConfig);
    try {
        await client.connect();
        
        // Ищем все лоты 15 рублей
        const all15Rubles = await client.query(`
            SELECT 
                id, lot_number, auction_number, coin_description,
                winning_bid, condition, year, letters, metal
            FROM auction_lots 
            WHERE coin_description ~ $1
                AND winning_bid IS NOT NULL 
                AND winning_bid > 0
            ORDER BY auction_end_date DESC
            LIMIT 20
        `, ['\\b15\\s*рублей?\\b']);
        
        console.log(`🔍 Найдено ${all15Rubles.rows.length} лотов 15 рублей:`);
        
        all15Rubles.rows.forEach((lot, index) => {
            console.log(`   ${index + 1}. Лот ${lot.lot_number} (Аукцион ${lot.auction_number}): ${lot.year}г., ${lot.condition}, ${lot.letters}, ${lot.winning_bid}₽`);
        });
        
    } catch (error) {
        console.error('❌ Ошибка:', error);
    } finally {
        await client.end();
    }
}

checkAll15Rubles();

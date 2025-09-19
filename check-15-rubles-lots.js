const { Client } = require('pg');
const config = require('./config');

async function check15RublesLots() {
    const client = new Client(config.dbConfig);
    try {
        await client.connect();
        
        // Ищем все лоты 15 рублей 1897г. АГ MS61
        const similarLots = await client.query(`
            SELECT 
                id, lot_number, auction_number, coin_description,
                winning_bid, winner_login, auction_end_date,
                metal, condition, year, letters, weight
            FROM auction_lots 
            WHERE condition = $1 
                AND metal = $2 
                AND year = $3 
                AND letters = $4
                AND coin_description ~ $5
                AND winning_bid IS NOT NULL 
                AND winning_bid > 0
            ORDER BY auction_end_date DESC
        `, ['MS61', 'Au', 1897, 'АГ', '\\b15\\s*рублей?\\b']);
        
        console.log(`🔍 Найдено ${similarLots.rows.length} лотов 15 рублей 1897г. АГ MS61:`);
        
        similarLots.rows.forEach((lot, index) => {
            console.log(`   ${index + 1}. Лот ${lot.lot_number} (Аукцион ${lot.auction_number}): ${lot.winning_bid}₽, ${lot.auction_end_date}`);
        });
        
        // Также проверим, есть ли лоты 15 рублей 1897г. АГ с другими состояниями
        const all15Rubles = await client.query(`
            SELECT 
                id, lot_number, auction_number, condition,
                winning_bid, auction_end_date
            FROM auction_lots 
            WHERE metal = $1 
                AND year = $2 
                AND letters = $3
                AND coin_description ~ $4
                AND winning_bid IS NOT NULL 
                AND winning_bid > 0
            ORDER BY auction_end_date DESC
            LIMIT 10
        `, ['Au', 1897, 'АГ', '\\b15\\s*рублей?\\b']);
        
        console.log(`\n🔍 Всего найдено ${all15Rubles.rows.length} лотов 15 рублей 1897г. АГ (все состояния):`);
        
        all15Rubles.rows.forEach((lot, index) => {
            console.log(`   ${index + 1}. Лот ${lot.lot_number} (Аукцион ${lot.auction_number}): ${lot.condition}, ${lot.winning_bid}₽`);
        });
        
    } catch (error) {
        console.error('❌ Ошибка:', error);
    } finally {
        await client.end();
    }
}

check15RublesLots();

const { Client } = require('pg');
const config = require('./config');

async function find15RublesLots() {
    const client = new Client(config.dbConfig);
    try {
        await client.connect();
        
        // Ищем все лоты с "15 рублей" в описании
        const all15Rubles = await client.query(`
            SELECT 
                id, lot_number, auction_number, coin_description,
                winning_bid, condition, year, letters, metal
            FROM auction_lots 
            WHERE coin_description LIKE '%15 рублей%'
                AND winning_bid IS NOT NULL 
                AND winning_bid > 0
            ORDER BY auction_end_date DESC
        `);
        
        console.log(`🔍 Найдено ${all15Rubles.rows.length} лотов с "15 рублей" в описании:`);
        
        all15Rubles.rows.forEach((lot, index) => {
            console.log(`   ${index + 1}. Лот ${lot.lot_number} (Аукцион ${lot.auction_number}): ${lot.year}г., ${lot.condition}, ${lot.letters}, ${lot.winning_bid}₽`);
        });
        
        // Теперь проверим, есть ли лоты 15 рублей 1897г. АГ с другими состояниями
        const similar15Rubles = await client.query(`
            SELECT 
                id, lot_number, auction_number, condition,
                winning_bid, auction_end_date
            FROM auction_lots 
            WHERE coin_description LIKE '%15 рублей%'
                AND year = $1 
                AND letters = $2
                AND winning_bid IS NOT NULL 
                AND winning_bid > 0
            ORDER BY auction_end_date DESC
        `, [1897, 'АГ']);
        
        console.log(`\n🔍 Найдено ${similar15Rubles.rows.length} лотов 15 рублей 1897г. АГ (все состояния):`);
        
        similar15Rubles.rows.forEach((lot, index) => {
            console.log(`   ${index + 1}. Лот ${lot.lot_number} (Аукцион ${lot.auction_number}): ${lot.condition}, ${lot.winning_bid}₽, ${lot.auction_end_date}`);
        });
        
    } catch (error) {
        console.error('❌ Ошибка:', error);
    } finally {
        await client.end();
    }
}

find15RublesLots();

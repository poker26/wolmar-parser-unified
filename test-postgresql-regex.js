const { Client } = require('pg');
const config = require('./config');

async function testPostgreSQLRegex() {
    const client = new Client(config.dbConfig);
    try {
        await client.connect();
        
        // Тестируем разные варианты регулярного выражения
        const regexPatterns = [
            '\\b15\\s*рублей?\\b',
            '15\\s*рублей?',
            '15 рублей',
            '15 руб'
        ];
        
        for (const pattern of regexPatterns) {
            console.log(`\n🔍 Тестируем паттерн: "${pattern}"`);
            
            const result = await client.query(`
                SELECT 
                    id, lot_number, auction_number, coin_description,
                    winning_bid, condition, year, letters, metal
                FROM auction_lots 
                WHERE coin_description ~ $1
                    AND winning_bid IS NOT NULL 
                    AND winning_bid > 0
                LIMIT 5
            `, [pattern]);
            
            console.log(`   Найдено: ${result.rows.length} лотов`);
            result.rows.forEach((lot, index) => {
                console.log(`   ${index + 1}. Лот ${lot.lot_number} (Аукцион ${lot.auction_number}): ${lot.year}г., ${lot.condition}, ${lot.letters}`);
            });
        }
        
        // Теперь проверим конкретно лоты 15 рублей 1897г. АГ MS61
        console.log(`\n🔍 Ищем лоты 15 рублей 1897г. АГ MS61:`);
        
        const specificResult = await client.query(`
            SELECT 
                id, lot_number, auction_number, coin_description,
                winning_bid, condition, year, letters, metal
            FROM auction_lots 
            WHERE condition = $1 
                AND metal = $2 
                AND year = $3 
                AND letters = $4
                AND coin_description ~ $5
                AND winning_bid IS NOT NULL 
                AND winning_bid > 0
                AND id != $6
        `, ['MS61', 'Au', 1897, 'АГ', '15\\s*рублей?', 54647]);
        
        console.log(`   Найдено: ${specificResult.rows.length} лотов`);
        specificResult.rows.forEach((lot, index) => {
            console.log(`   ${index + 1}. Лот ${lot.lot_number} (Аукцион ${lot.auction_number}): ${lot.winning_bid}₽`);
        });
        
    } catch (error) {
        console.error('❌ Ошибка:', error);
    } finally {
        await client.end();
    }
}

testPostgreSQLRegex();

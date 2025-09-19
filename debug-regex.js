const { Client } = require('pg');
const config = require('./config');

async function debugRegex() {
    const client = new Client(config.dbConfig);
    try {
        await client.connect();
        
        // Получаем лот №3
        const lot3 = await client.query(`
            SELECT coin_description 
            FROM auction_lots 
            WHERE auction_number = $1 AND lot_number = $2
        `, [967, '3']);
        
        if (lot3.rows.length === 0) {
            console.log('❌ Лот №3 не найден');
            return;
        }
        
        const description = lot3.rows[0].coin_description;
        console.log('📝 Описание лота №3:');
        console.log(description);
        
        // Тестируем разные регулярные выражения
        const patterns = [
            /(\d+)\s*рублей?/i,
            /15\s*рублей?/i,
            /15\s*руб/i,
            /рублей/i
        ];
        
        console.log('\n🔍 Тестируем регулярные выражения:');
        patterns.forEach((pattern, index) => {
            const match = description.match(pattern);
            console.log(`   ${index + 1}. ${pattern}: ${match ? `"${match[0]}"` : 'не найдено'}`);
        });
        
        // Ищем все лоты с "15" в описании
        const lotsWith15 = await client.query(`
            SELECT lot_number, auction_number, coin_description
            FROM auction_lots 
            WHERE coin_description LIKE '%15%'
                AND winning_bid IS NOT NULL 
                AND winning_bid > 0
            LIMIT 10
        `);
        
        console.log(`\n🔍 Найдено ${lotsWith15.rows.length} лотов с "15" в описании:`);
        lotsWith15.rows.forEach((lot, index) => {
            console.log(`   ${index + 1}. Лот ${lot.lot_number} (Аукцион ${lot.auction_number}): ${lot.coin_description.substring(0, 100)}...`);
        });
        
    } catch (error) {
        console.error('❌ Ошибка:', error);
    } finally {
        await client.end();
    }
}

debugRegex();

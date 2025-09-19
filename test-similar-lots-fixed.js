const { Client } = require('pg');
const config = require('./config');

async function testSimilarLots() {
    const client = new Client(config.dbConfig);
    try {
        await client.connect();
        
        // Получаем ID лота №3 аукциона 967
        const lot3 = await client.query(`
            SELECT id, lot_number, coin_description, metal, condition, year, letters, winning_bid 
            FROM auction_lots 
            WHERE auction_number = $1 AND lot_number = $2
        `, [967, '3']);
        
        if (lot3.rows.length === 0) {
            console.log('❌ Лот №3 не найден');
            return;
        }
        
        const lot3Data = lot3.rows[0];
        console.log('🔍 Тестируем лот №3:');
        console.log(`   ID: ${lot3Data.id}`);
        console.log(`   Описание: ${lot3Data.coin_description.substring(0, 100)}...`);
        console.log(`   Металл: ${lot3Data.metal}, Состояние: ${lot3Data.condition}, Год: ${lot3Data.year}, Буквы: ${lot3Data.letters}`);
        
        // Извлекаем номинал
        const denominationMatch = lot3Data.coin_description.match(/(\d+)\s*рублей?/i);
        const denomination = denominationMatch ? denominationMatch[1] : null;
        console.log(`   Номинал: ${denomination} рублей`);
        
        // Тестируем новый API
        console.log('\n🌐 Тестируем API /api/similar-lots/:lotId...');
        
        const response = await fetch(`http://localhost:3000/api/similar-lots/${lot3Data.id}`);
        if (!response.ok) {
            console.log(`❌ Ошибка API: ${response.status}`);
            return;
        }
        
        const data = await response.json();
        console.log(`✅ Найдено ${data.similarLots.length} аналогичных лотов:`);
        
        data.similarLots.forEach((lot, index) => {
            const lotDenomination = lot.coin_description.match(/(\d+)\s*рублей?/i);
            const lotDenom = lotDenomination ? lotDenomination[1] : 'неизвестно';
            console.log(`   ${index + 1}. Лот ${lot.lot_number} (Аукцион ${lot.auction_number}): ${lotDenom} рублей, ${lot.winning_bid}₽`);
        });
        
    } catch (error) {
        console.error('❌ Ошибка:', error);
    } finally {
        await client.end();
    }
}

testSimilarLots();

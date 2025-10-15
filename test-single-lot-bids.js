const WolmarCategoryParser = require('./wolmar-category-parser');
const config = require('./config');

async function testSingleLotBids() {
    console.log('🧪 ТЕСТ ПАРСИНГА СТАВОК ДЛЯ ОДНОГО ЛОТА');
    console.log('=======================================');
    
    const parser = new WolmarCategoryParser(config.dbConfig, 'test', 2070);
    
    try {
        console.log('\n1️⃣ Инициализируем парсер...');
        await parser.init();
        
        console.log('\n2️⃣ Тестируем парсинг лота с историей ставок...');
        const testUrl = 'https://www.wolmar.ru/auction/2070/7226578?category=bony';
        
        console.log(`🔍 URL: ${testUrl}`);
        
        // Парсим лот с включенным парсингом ставок
        const lotData = await parser.parseLotPage(testUrl, null, 'Боны', true);
        
        console.log('\n3️⃣ Результаты парсинга:');
        console.log(`📋 Номер лота: ${lotData.lotNumber}`);
        console.log(`📋 Описание: ${lotData.coinDescription?.substring(0, 100)}...`);
        console.log(`📋 Победитель: ${lotData.winnerLogin}`);
        console.log(`📋 Цена: ${lotData.winningBid} руб.`);
        
        if (lotData.bidHistory && lotData.bidHistory.length > 0) {
            console.log(`\n💰 История ставок (${lotData.bidHistory.length} ставок):`);
            lotData.bidHistory.slice(0, 5).forEach((bid, index) => {
                console.log(`   ${index + 1}. ${bid.amount} руб. - ${bid.bidder} (${bid.timestamp}) ${bid.isAutoBid ? '[АВТОБИД]' : ''}`);
            });
            if (lotData.bidHistory.length > 5) {
                console.log(`   ... и еще ${lotData.bidHistory.length - 5} ставок`);
            }
        } else {
            console.log('❌ История ставок не найдена');
        }
        
        console.log('\n4️⃣ Тестируем сохранение в БД...');
        try {
            const lotId = await parser.saveLotToDatabase(lotData);
            console.log(`✅ Лот сохранен с ID: ${lotId}`);
            
            if (lotData.bidHistory && lotData.bidHistory.length > 0) {
                console.log(`✅ История ставок также сохранена`);
            }
        } catch (saveError) {
            console.error('❌ Ошибка сохранения:', saveError.message);
        }
        
    } catch (error) {
        console.error('❌ Ошибка теста:', error.message);
        console.error('❌ Стек ошибки:', error.stack);
    } finally {
        if (parser.browser) {
            await parser.browser.close();
        }
        if (parser.dbClient) {
            await parser.dbClient.end();
        }
    }
}

if (require.main === module) {
    testSingleLotBids();
}

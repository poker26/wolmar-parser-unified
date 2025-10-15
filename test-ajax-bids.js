const WolmarCategoryParser = require('./wolmar-category-parser');

async function testAjaxBids() {
    console.log('🧪 ТЕСТИРУЕМ AJAX ПАРСИНГ СТАВОК');
    console.log('================================');
    
    const parser = new WolmarCategoryParser();
    
    try {
        console.log('\n1️⃣ Инициализируем парсер...');
        await parser.init();
        
        console.log('\n2️⃣ Тестируем парсинг ставок для лота 2070/7222265...');
        const testUrl = 'https://www.wolmar.ru/auction/2070/7222265?category=bony';
        
        // Переходим на страницу лота
        await parser.page.goto(testUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        
        // Парсим историю ставок
        const bidHistory = await parser.parseBidHistory(parser.page);
        
        console.log('\n3️⃣ Результаты парсинга:');
        console.log(`📊 Найдено ставок: ${bidHistory.length}`);
        
        if (bidHistory.length > 0) {
            console.log('\n💰 Первые 5 ставок:');
            bidHistory.slice(0, 5).forEach((bid, index) => {
                console.log(`   ${index + 1}. ${bid.amount} руб. - ${bid.bidder} (${bid.timestamp}) ${bid.isAutoBid ? '[АВТОБИД]' : '[РУЧНАЯ]'}`);
            });
            
            // Статистика по автобидам
            const autoBids = bidHistory.filter(bid => bid.isAutoBid).length;
            const manualBids = bidHistory.length - autoBids;
            
            console.log('\n📊 Статистика:');
            console.log(`   Всего ставок: ${bidHistory.length}`);
            console.log(`   Автобидов: ${autoBids} (${Math.round(autoBids / bidHistory.length * 100)}%)`);
            console.log(`   Ручных ставок: ${manualBids} (${Math.round(manualBids / bidHistory.length * 100)}%)`);
        } else {
            console.log('❌ Ставки не найдены');
        }
        
    } catch (error) {
        console.error('❌ Ошибка теста:', error.message);
    } finally {
        if (parser.browser) {
            await parser.browser.close();
        }
    }
}

if (require.main === module) {
    testAjaxBids();
}

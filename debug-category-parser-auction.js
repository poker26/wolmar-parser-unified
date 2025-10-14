/**
 * Скрипт для отладки парсинга конкретного аукциона через Category Parser
 * 
 * Использование:
 * node debug-category-parser-auction.js <номер_аукциона> [стартовый_лот]
 * 
 * Примеры:
 * node debug-category-parser-auction.js 2137
 * node debug-category-parser-auction.js 2137 150
 */

const WolmarCategoryParser = require('./wolmar-category-parser');
const config = require('./config');

async function debugAuctionParsing() {
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
        console.log(`
🚀 Отладка парсинга аукциона через Category Parser

Использование:
  node debug-category-parser-auction.js <номер_аукциона> [стартовый_лот]

Примеры:
  node debug-category-parser-auction.js 2137
  node debug-category-parser-auction.js 2137 150
        `);
        process.exit(1);
    }
    
    const auctionNumber = args[0];
    const startFromLot = args[1] ? parseInt(args[1]) : 1;
    
    console.log('🚀 Запуск отладки парсинга аукциона...');
    console.log(`📋 Параметры:`);
    console.log(`   - Номер аукциона: ${auctionNumber}`);
    console.log(`   - Стартовый лот: ${startFromLot}`);
    console.log(`   - Режим: auction\n`);
    
    const parser = new WolmarCategoryParser(config.dbConfig, 'auction', auctionNumber);
    
    try {
        const startTime = Date.now();
        
        // Инициализируем парсер
        console.log('🔧 Инициализация парсера...');
        await parser.init();
        console.log('✅ Парсер инициализирован\n');
        
        // Запускаем парсинг аукциона
        console.log('🎯 Начинаем парсинг аукциона...');
        await parser.parseSpecificAuction(auctionNumber, startFromLot, {
            maxLots: 10, // Ограничиваем для отладки
            skipExisting: true,
            delayBetweenLots: 1000,
            testMode: false
        });
        
        const endTime = Date.now();
        const duration = Math.round((endTime - startTime) / 1000);
        
        console.log(`\n🎉 Парсинг завершен за ${duration} секунд!`);
        console.log(`📊 Финальная статистика:`);
        console.log(`   ✅ Обработано лотов: ${parser.processed}`);
        console.log(`   ❌ Ошибок: ${parser.errors}`);
        console.log(`   ⏭️ Пропущено: ${parser.skipped}`);
        
    } catch (error) {
        console.error('\n❌ Критическая ошибка парсинга:', error.message);
        console.error('Stack trace:', error.stack);
        throw error;
    } finally {
        // Закрываем браузер
        try {
            if (parser.browser) {
                await parser.browser.close();
                console.log('🔒 Браузер закрыт');
            }
        } catch (closeError) {
            console.error('Ошибка закрытия браузера:', closeError.message);
        }
    }
}

// Запуск отладки
if (require.main === module) {
    debugAuctionParsing()
        .then(() => {
            console.log('✅ Отладка завершена успешно');
            process.exit(0);
        })
        .catch((error) => {
            console.error('❌ Отладка завершена с ошибкой:', error.message);
            process.exit(1);
        });
}

module.exports = { debugAuctionParsing };



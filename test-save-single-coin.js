const CatalogParser = require('./catalog-parser.js');

async function testSaveSingleCoin() {
    const parser = new CatalogParser();
    
    try {
        await parser.init();
        
        // Создаем тестовый лот с весом
        const testLot = {
            id: 999999,
            auction_number: 999,
            lot_number: 'test-lot',
            coin_description: "50 рублей. Софийский собор в Новгороде 1988г. ММД. Au 7,78. | Тираж: 25 000. 900 проба. Диаметр 22,6 мм.",
            avers_image_url: 'https://example.com/avers.jpg',
            revers_image_url: 'https://example.com/revers.jpg'
        };
        
        console.log('🧪 Тестирование сохранения одной монеты "50 рублей"...\n');
        console.log(`📝 Описание: ${testLot.coin_description}\n`);
        
        // Парсим описание
        const parsedData = parser.parseLotDescription(testLot.coin_description);
        
        console.log('📋 Результат парсинга:');
        console.log(`  - Металл: ${parsedData.metal || 'не найден'}`);
        console.log(`  - Вес монеты: ${parsedData.coin_weight || 'не найден'}г`);
        console.log(`  - Проба: ${parsedData.fineness || 'не найдена'}`);
        console.log(`  - Чистый металл: ${parsedData.pure_metal_weight || 'не найден'}г`);
        console.log(`  - Вес в унциях: ${parsedData.weight_oz || 'не найден'}oz`);
        
        console.log('\n💾 Попытка сохранения в БД...');
        
        // Сохраняем в каталог
        await parser.saveToCatalog(testLot, parsedData, null, null);
        
        console.log('\n✅ Тестирование завершено!');
        
    } catch (error) {
        console.error('❌ Ошибка при тестировании:', error);
    } finally {
        await parser.close();
    }
}

testSaveSingleCoin();

const CatalogParser = require('./catalog-parser.js');

async function testSingleLotWithWeight() {
    const parser = new CatalogParser();
    
    try {
        await parser.init();
        
        // Тестовое описание с весом
        const testDescription = "50 рублей. Софийский собор в Новгороде 1988г. ММД. Au 7,78. | Тираж: 25 000. 900 проба. Диаметр 22,6 мм.";
        
        console.log('🧪 Тестирование парсинга одного лота с весом...\n');
        console.log(`📝 Описание: ${testDescription}\n`);
        
        // Парсим описание
        const parsedData = parser.parseLotDescription(testDescription);
        
        console.log('📋 Результат парсинга:');
        console.log(`  - Металл: ${parsedData.metal || 'не найден'}`);
        console.log(`  - Вес монеты: ${parsedData.coin_weight || 'не найден'}г`);
        console.log(`  - Проба: ${parsedData.fineness || 'не найдена'}`);
        console.log(`  - Чистый металл: ${parsedData.pure_metal_weight || 'не найден'}г`);
        console.log(`  - Вес в унциях: ${parsedData.weight_oz || 'не найден'}oz`);
        
        console.log('\n✅ Тестирование завершено!');
        
    } catch (error) {
        console.error('❌ Ошибка при тестировании:', error);
    } finally {
        await parser.close();
    }
}

testSingleLotWithWeight();



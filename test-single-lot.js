const CatalogParser = require('./catalog-parser.js');

async function testSingleLot() {
    const parser = new CatalogParser();
    
    try {
        await parser.init();
        
        // Тестовое описание с весом
        const testDescription = "200 рублей. Рысь 1995г. ММД. Au 31,1. | В слабе NGC. Изображение сидящей рыси, слева от неё - летящая птица, справа - ели. Рысь - млекопитающее рода кошек, длина тела до 109 см, хвоста - до 24 см. Обитает в лесах Евразии и Северной Америки. Тираж: 1 750. 999 проба. Диаметр 33 мм.";
        
        console.log('🧪 Тестирование парсинга одного лота...\n');
        console.log(`📝 Описание: ${testDescription.substring(0, 100)}...\n`);
        
        const result = parser.parseLotDescription(testDescription);
        
        console.log('📋 Результат парсинга:');
        console.log(`  - Металл: ${result.metal || 'не найден'}`);
        console.log(`  - Вес монеты: ${result.coin_weight || 'не найден'}г`);
        console.log(`  - Проба: ${result.fineness || 'не найдена'}`);
        console.log(`  - Чистый металл: ${result.pure_metal_weight || 'не найден'}г`);
        console.log(`  - Вес в унциях: ${result.weight_oz || 'не найден'}oz`);
        
        console.log('\n✅ Тестирование завершено!');
        
    } catch (error) {
        console.error('❌ Ошибка при тестировании:', error);
    } finally {
        await parser.close();
    }
}

testSingleLot();





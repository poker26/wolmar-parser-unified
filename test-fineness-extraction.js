const CatalogParser = require('./catalog-parser.js');

async function testFinenessExtraction() {
    const parser = new CatalogParser();
    
    try {
        await parser.init();
        
        // Тестовое описание с пробой
        const testDescription = "Стопка Ag. | Стопка. Серебро 925 пробы. Вес - 32 гр., высота - 5,4 см. Россия, после 1994 года.";
        
        console.log('🧪 Тестирование извлечения пробы...\n');
        console.log(`📝 Описание: ${testDescription}\n`);
        
        // Проверяем, что находит regex для пробы
        const finenessMatch = testDescription.match(/(\d{3})\s*проба/i);
        console.log(`🔍 Результат поиска пробы: ${finenessMatch ? finenessMatch[1] : 'не найдена'}`);
        
        // Парсим описание
        const parsedData = parser.parseLotDescription(testDescription);
        
        console.log('\n📋 Результат парсинга:');
        console.log(`  - Металл: ${parsedData.metal || 'не найден'}`);
        console.log(`  - Вес монеты: ${parsedData.coin_weight || 'не найден'}г`);
        console.log(`  - Проба: ${parsedData.fineness || 'не найдена'}`);
        console.log(`  - Чистый металл: ${parsedData.pure_metal_weight || 'не найден'}г`);
        
        console.log('\n✅ Тестирование завершено!');
        
    } catch (error) {
        console.error('❌ Ошибка при тестировании:', error);
    } finally {
        await parser.close();
    }
}

testFinenessExtraction();





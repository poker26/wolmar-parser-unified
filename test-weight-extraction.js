const CatalogParser = require('./catalog-parser.js');

async function testWeightExtraction() {
    const parser = new CatalogParser();
    
    try {
        await parser.init();
        
        // Тестируем на реальном описании с весом
        const testDescription = "Копейка. Иван IV Васильевич. Псков Ag. | Объединённая северо-восточная Русь - Государь всея Руси Иван IV Васильевич Грозный Копейка. Датировка ~1535-1547. Чеканка в Пскове. Нормативный вес 0.68 гр.. В.Н. Клещинова, И.В. Гришина, №# 74.";
        
        console.log('🧪 Тестирование извлечения веса из реального описания...\n');
        console.log(`📝 Описание: ${testDescription.substring(0, 100)}...\n`);
        
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

testWeightExtraction();

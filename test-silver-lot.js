const CatalogParser = require('./catalog-parser.js');

async function testSilverLot() {
    const parser = new CatalogParser();
    
    try {
        await parser.init();
        
        // Тестовое описание серебряной монеты
        const testDescription = "25 пенни. Финляндия 1907г. L. Ag. | Гельсингфорсский монетный двор. Биткин №# 966.415, тираж 590 785...";
        
        console.log('🧪 Тестирование парсинга серебряной монеты...\n');
        console.log(`📝 Описание: ${testDescription}\n`);
        
        // Парсим описание
        const parsedData = parser.parseLotDescription(testDescription);
        
        console.log('📋 Результат парсинга:');
        console.log(`  - Металл: ${parsedData.metal || 'не найден'}`);
        console.log(`  - Вес монеты: ${parsedData.coin_weight || 'не найден'}г`);
        console.log(`  - Проба: ${parsedData.fineness || 'не найдена'}`);
        console.log(`  - Чистый металл: ${parsedData.pure_metal_weight || 'не найден'}г`);
        console.log(`  - Вес в унциях: ${parsedData.weight_oz || 'не найден'}oz`);
        
        console.log('\n🔍 Проверка драгоценного металла:');
        const isPrecious = ['AU', 'AG', 'PT', 'PD'].includes(parsedData.metal?.toUpperCase());
        console.log(`  - Драгоценный металл: ${isPrecious ? 'ДА' : 'НЕТ'} (${parsedData.metal})`);
        
        console.log('\n✅ Тестирование завершено!');
        
    } catch (error) {
        console.error('❌ Ошибка при тестировании:', error);
    } finally {
        await parser.close();
    }
}

testSilverLot();





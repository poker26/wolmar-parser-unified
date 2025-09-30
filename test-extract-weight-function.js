const CatalogParser = require('./catalog-parser.js');

async function testExtractWeightFunction() {
    const parser = new CatalogParser();
    
    try {
        await parser.init();
        
        // Тестовое описание с весом
        const testDescription = "50 рублей. Софийский собор в Новгороде 1988г. ММД. Au 7,78. | Тираж: 25 000. 900 проба. Диаметр 22,6 мм.";
        
        console.log('🧪 Тестирование функции extractWeightAndFineness...\n');
        console.log(`📝 Описание: ${testDescription}\n`);
        
        // Создаем объект result
        const result = {
            coin_weight: null,
            fineness: null,
            pure_metal_weight: null,
            weight_oz: null
        };
        
        console.log('🔍 До вызова функции:');
        console.log(`  - coin_weight: ${result.coin_weight}`);
        console.log(`  - fineness: ${result.fineness}`);
        console.log(`  - pure_metal_weight: ${result.pure_metal_weight}`);
        console.log(`  - weight_oz: ${result.weight_oz}`);
        
        // Вызываем функцию
        parser.extractWeightAndFineness(testDescription, result);
        
        console.log('\n🔍 После вызова функции:');
        console.log(`  - coin_weight: ${result.coin_weight}`);
        console.log(`  - fineness: ${result.fineness}`);
        console.log(`  - pure_metal_weight: ${result.pure_metal_weight}`);
        console.log(`  - weight_oz: ${result.weight_oz}`);
        
        console.log('\n✅ Тестирование завершено!');
        
    } catch (error) {
        console.error('❌ Ошибка при тестировании:', error);
    } finally {
        await parser.close();
    }
}

testExtractWeightFunction();



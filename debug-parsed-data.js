const CatalogParser = require('./catalog-parser.js');

async function debugParsedData() {
    const parser = new CatalogParser();
    
    try {
        await parser.init();
        
        // Тестовое описание
        const testDescription = "50 рублей. Софийский собор в Новгороде 1988г. ММД. Au 7,78. | Тираж: 25 000. 900 проба. Диаметр 22,6 мм.";
        
        console.log('🔍 Отладка данных после парсинга...\n');
        
        // Парсим описание
        const parsedData = parser.parseLotDescription(testDescription);
        
        console.log('📋 Все поля parsedData:');
        Object.keys(parsedData).forEach(key => {
            const value = parsedData[key];
            const type = typeof value;
            console.log(`  - ${key}: ${value} (${type})`);
        });
        
        console.log('\n🔍 Проверка числовых полей:');
        console.log(`  - denomination: ${parsedData.denomination} (${typeof parsedData.denomination})`);
        console.log(`  - year: ${parsedData.year} (${typeof parsedData.year})`);
        console.log(`  - coin_weight: ${parsedData.coin_weight} (${typeof parsedData.coin_weight})`);
        console.log(`  - fineness: ${parsedData.fineness} (${typeof parsedData.fineness})`);
        console.log(`  - pure_metal_weight: ${parsedData.pure_metal_weight} (${typeof parsedData.pure_metal_weight})`);
        
        console.log('\n✅ Отладка завершена!');
        
    } catch (error) {
        console.error('❌ Ошибка при отладке:', error);
    } finally {
        await parser.close();
    }
}

debugParsedData();

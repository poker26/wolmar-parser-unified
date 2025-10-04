const CatalogParser = require('./catalog-parser.js');

async function testRealDescriptions() {
    const parser = new CatalogParser();
    
    try {
        await parser.init();
        
        // Реальные описания из логов
        const testDescriptions = [
            "50 рублей. Московский Кремль и Красная площадь. Топ грейд 2006г. ММД. Au 7,78. | В слабе NGC. Топ грейд.",
            "100 долларов. Мексика 1985г. Ag 31,1. | Микроцарапины.",
            "50 рублей. Петр I 2003г. ММД. Au 7,78. | На фоне окна-арки в кирпичной стене - портрет императора Петра I."
        ];
        
        console.log('🧪 Тестирование парсинга реальных описаний...\n');
        
        for (const [index, description] of testDescriptions.entries()) {
            console.log(`--- Тест ${index + 1} ---`);
            console.log(`📝 Описание: ${description.substring(0, 80)}...`);
            
            // Парсим описание
            const parsedData = parser.parseLotDescription(description);
            
            console.log(`\n📋 Результат парсинга:`);
            console.log(`  - Металл: ${parsedData.metal || 'не найден'}`);
            console.log(`  - Вес монеты: ${parsedData.coin_weight || 'не найден'}г`);
            console.log(`  - Проба: ${parsedData.fineness || 'не найдена'}`);
            console.log(`  - Чистый металл: ${parsedData.pure_metal_weight || 'не найден'}г`);
            console.log(`  - Вес в унциях: ${parsedData.weight_oz || 'не найден'}oz`);
            
            console.log('\n');
        }
        
        console.log('✅ Тестирование завершено!');
        
    } catch (error) {
        console.error('❌ Ошибка при тестировании:', error);
    } finally {
        await parser.close();
    }
}

testRealDescriptions();





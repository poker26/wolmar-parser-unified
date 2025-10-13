const WolmarCategoryParser = require('./wolmar-category-parser');
const config = require('./config');

async function testCategoryLotParsing() {
    console.log('🧪 Тестирование парсинга лотов из категории...');
    
    try {
        // Инициализируем парсер
        const parser = new WolmarCategoryParser(config.dbConfig);
        await parser.init();
        
        console.log('✅ Парсер инициализирован');
        
        // Находим категории
        const categories = await parser.discoverCategories();
        console.log(`📋 Найдено ${categories.length} категорий`);
        
        if (categories.length === 0) {
            console.log('❌ Категории не найдены');
            return;
        }
        
        // Берем первую категорию для тестирования
        const testCategory = categories[0];
        console.log(`🎯 Тестируем категорию: "${testCategory.name}"`);
        console.log(`🔗 URL: ${testCategory.url}`);
        
        // Парсим лоты из этой категории (максимум 3 лота для теста)
        const testOptions = {
            maxLotsPerCategory: 3,
            skipExisting: true,
            delayBetweenLots: 2000,
            testMode: true
        };
        
        console.log('🚀 Начинаем парсинг лотов...');
        const result = await parser.parseCategoryLots(testCategory.url, testCategory.name, testOptions);
        
        console.log('📊 Результаты парсинга:');
        console.log(`   - Обработано лотов: ${result.processed}`);
        console.log(`   - Ошибок: ${result.errors}`);
        console.log(`   - Пропущено: ${result.skipped}`);
        
        console.log('✅ Тестирование завершено успешно!');
        
    } catch (error) {
        console.error('❌ Ошибка тестирования:', error.message);
        console.error(error.stack);
    } finally {
        process.exit(0);
    }
}

// Запускаем тест
testCategoryLotParsing();

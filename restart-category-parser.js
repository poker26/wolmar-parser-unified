const WolmarCategoryParser = require('./wolmar-category-parser');
const config = require('./config');

async function restartCategoryParser() {
    console.log('🚀 Перезапуск парсера категорий...');
    
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
        
        // Показываем найденные категории
        console.log('🎯 Найденные категории:');
        categories.forEach((cat, index) => {
            console.log(`   ${index + 1}. ${cat.name}`);
        });
        
        // Настройки для парсинга
        const options = {
            maxCategories: null, // Все категории
            maxLotsPerCategory: 50, // По 50 лотов на категорию
            skipExisting: true, // Пропускать существующие
            delayBetweenLots: 1000, // 1 секунда между лотами
            testMode: false // Продакшн режим
        };
        
        console.log('⚙️ Настройки парсинга:');
        console.log(`   - Максимум категорий: ${options.maxCategories || 'все'}`);
        console.log(`   - Максимум лотов на категорию: ${options.maxLotsPerCategory}`);
        console.log(`   - Пропускать существующие: ${options.skipExisting}`);
        console.log(`   - Задержка между лотами: ${options.delayBetweenLots}ms`);
        console.log(`   - Тестовый режим: ${options.testMode}`);
        
        console.log('\n🚀 Начинаем парсинг всех категорий...');
        
        // Запускаем парсинг всех категорий
        const result = await parser.parseAllCategories(options);
        
        console.log('\n📊 Результаты парсинга:');
        console.log(`   - Обработано лотов: ${result.processed}`);
        console.log(`   - Ошибок: ${result.errors}`);
        console.log(`   - Пропущено: ${result.skipped}`);
        console.log(`   - Обработано категорий: ${result.categoriesProcessed}`);
        
        console.log('✅ Парсинг завершен!');
        
    } catch (error) {
        console.error('❌ Ошибка парсинга:', error.message);
        console.error(error.stack);
    } finally {
        process.exit(0);
    }
}

// Запускаем парсер
restartCategoryParser();

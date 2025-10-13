/**
 * Тестовый скрипт для Wolmar Category Parser
 * 
 * Проверяет работу парсера по категориям на небольшом объеме данных
 */

const WolmarCategoryParser = require('./wolmar-category-parser');
const config = require('./config');

async function testCategoryParser() {
    console.log('🧪 Запуск тестирования Wolmar Category Parser...\n');
    
    const parser = new WolmarCategoryParser(config.dbConfig);
    
    try {
        // Тестовые настройки
        const testOptions = {
            maxCategories: 2,           // Только 2 категории
            maxLotsPerCategory: 5,      // По 5 лотов в каждой
            skipExisting: true,         // Пропускать существующие
            delayBetweenLots: 1500,     // Задержка 1.5 секунды
            testMode: true              // Тестовый режим
        };
        
        console.log('📋 Тестовые настройки:');
        console.log(`   - Максимум категорий: ${testOptions.maxCategories}`);
        console.log(`   - Максимум лотов на категорию: ${testOptions.maxLotsPerCategory}`);
        console.log(`   - Пропускать существующие: ${testOptions.skipExisting}`);
        console.log(`   - Задержка между лотами: ${testOptions.delayBetweenLots}ms`);
        console.log(`   - Тестовый режим: ${testOptions.testMode}\n`);
        
        // Запускаем парсинг
        await parser.parseAllCategories(testOptions);
        
        console.log('\n🎉 Тестирование завершено успешно!');
        
    } catch (error) {
        console.error('\n❌ Ошибка во время тестирования:', error.message);
        console.error('Stack trace:', error.stack);
        throw error;
    }
}

// Запуск теста
if (require.main === module) {
    testCategoryParser()
        .then(() => {
            console.log('✅ Тест завершен успешно');
            process.exit(0);
        })
        .catch((error) => {
            console.error('❌ Тест завершен с ошибкой:', error.message);
            process.exit(1);
        });
}

module.exports = { testCategoryParser };


/**
 * Скрипт для запуска полного парсинга по категориям
 * 
 * Использование:
 * node run-category-parser.js [--test] [--max-categories=N] [--max-lots=N] [--delay=N]
 * 
 * Параметры:
 * --test              - тестовый режим (2 категории, по 5 лотов)
 * --max-categories=N  - максимум категорий для обработки
 * --max-lots=N        - максимум лотов на категорию
 * --delay=N           - задержка между лотами в миллисекундах
 * --skip-existing     - пропускать существующие лоты (по умолчанию true)
 */

const WolmarCategoryParser = require('./wolmar-category-parser');
const config = require('./config');

// Парсинг аргументов командной строки
function parseArguments() {
    const args = process.argv.slice(2);
    const options = {
        testMode: false,
        maxCategories: null,
        maxLotsPerCategory: null,
        delayBetweenLots: 800,
        skipExisting: true
    };
    
    args.forEach(arg => {
        if (arg === '--test') {
            options.testMode = true;
            options.maxCategories = 2;
            options.maxLotsPerCategory = 5;
            options.delayBetweenLots = 1500;
        } else if (arg.startsWith('--max-categories=')) {
            options.maxCategories = parseInt(arg.split('=')[1]);
        } else if (arg.startsWith('--max-lots=')) {
            options.maxLotsPerCategory = parseInt(arg.split('=')[1]);
        } else if (arg.startsWith('--delay=')) {
            options.delayBetweenLots = parseInt(arg.split('=')[1]);
        } else if (arg === '--skip-existing') {
            options.skipExisting = true;
        } else if (arg === '--no-skip-existing') {
            options.skipExisting = false;
        }
    });
    
    return options;
}

async function runCategoryParser() {
    console.log('🚀 Запуск Wolmar Category Parser...\n');
    
    const options = parseArguments();
    
    console.log('📋 Настройки парсинга:');
    console.log(`   - Тестовый режим: ${options.testMode}`);
    console.log(`   - Максимум категорий: ${options.maxCategories || 'все'}`);
    console.log(`   - Максимум лотов на категорию: ${options.maxLotsPerCategory || 'все'}`);
    console.log(`   - Задержка между лотами: ${options.delayBetweenLots}ms`);
    console.log(`   - Пропускать существующие: ${options.skipExisting}\n`);
    
    const parser = new WolmarCategoryParser(config.dbConfig);
    
    try {
        const startTime = Date.now();
        
        // Запускаем парсинг
        await parser.parseAllCategories(options);
        
        const endTime = Date.now();
        const duration = Math.round((endTime - startTime) / 1000);
        
        console.log(`\n🎉 Парсинг завершен за ${duration} секунд!`);
        console.log(`📊 Финальная статистика:`);
        console.log(`   ✅ Обработано лотов: ${parser.processed}`);
        console.log(`   ❌ Ошибок: ${parser.errors}`);
        console.log(`   ⏭️ Пропущено: ${parser.skipped}`);
        
    } catch (error) {
        console.error('\n❌ Критическая ошибка парсинга:', error.message);
        console.error('Stack trace:', error.stack);
        throw error;
    }
}

// Показываем справку
function showHelp() {
    console.log(`
🚀 Wolmar Category Parser

Использование:
  node run-category-parser.js [опции]

Опции:
  --test                    Тестовый режим (2 категории, по 5 лотов)
  --max-categories=N        Максимум категорий для обработки
  --max-lots=N              Максимум лотов на категорию  
  --delay=N                 Задержка между лотами в миллисекундах (по умолчанию 800)
  --skip-existing           Пропускать существующие лоты (по умолчанию)
  --no-skip-existing        Не пропускать существующие лоты
  --help                    Показать эту справку

Примеры:
  node run-category-parser.js --test
  node run-category-parser.js --max-categories=5 --max-lots=20
  node run-category-parser.js --delay=1000 --no-skip-existing
`);
}

// Проверяем аргументы
if (process.argv.includes('--help')) {
    showHelp();
    process.exit(0);
}

// Запуск парсера
if (require.main === module) {
    runCategoryParser()
        .then(() => {
            console.log('✅ Парсинг завершен успешно');
            process.exit(0);
        })
        .catch((error) => {
            console.error('❌ Парсинг завершен с ошибкой:', error.message);
            process.exit(1);
        });
}

module.exports = { runCategoryParser, parseArguments };


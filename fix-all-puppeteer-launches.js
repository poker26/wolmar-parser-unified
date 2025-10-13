const fs = require('fs');
const path = require('path');

// Список файлов, которые нужно исправить (исключаем puppeteer-utils.js и тестовые файлы)
const filesToFix = [
    'wolmar-parser4.js',
    'wolmar-parser4-improved.js', 
    'mass-update-optimized-url-working.js',
    'optimized-mass-update.js',
    'numismat-parser.js',
    'mass-update-optimized-url.js',
    'mass-update-completed-auctions.js',
    'mass-update-optimized-url-fixed.js',
    'mass-update-optimized-url-final.js',
    'debug-url-matching.js',
    'debug-numismat.js',
    'debug-lots.js',
    'analyze-auction-pages.js',
    'wolmar-parser4-fixed.js',
    'wolmar-parser3.js',
    'wolmar-parser3-fixed.js',
    'wolmar-parser2.js'
];

// Флаги для отключения метрик Chrome
const metricsFlags = [
    '--user-data-dir=/tmp/chrome-temp-' + Math.random().toString(36).substring(7),
    '--disable-metrics',
    '--disable-metrics-reporting',
    '--disable-background-mode',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--disable-logging',
    '--disable-gpu-logging',
    '--disable-features=TranslateUI,BlinkGenPropertyTrees,VizDisplayCompositor'
];

function fixPuppeteerLaunch(filePath) {
    try {
        console.log(`🔧 Исправляем файл: ${filePath}`);
        
        if (!fs.existsSync(filePath)) {
            console.log(`⚠️  Файл не найден: ${filePath}`);
            return;
        }
        
        let content = fs.readFileSync(filePath, 'utf8');
        let modified = false;
        
        // Паттерн для поиска puppeteer.launch с args
        const launchPattern = /puppeteer\.launch\(\s*\{([^}]+)\}\s*\)/gs;
        
        content = content.replace(launchPattern, (match, config) => {
            // Проверяем, есть ли уже флаги метрик
            if (config.includes('--disable-metrics')) {
                console.log(`✅ Файл уже исправлен: ${filePath}`);
                return match;
            }
            
            // Ищем args массив
            const argsPattern = /args:\s*\[([^\]]*)\]/s;
            const argsMatch = config.match(argsPattern);
            
            if (argsMatch) {
                // Добавляем флаги метрик в существующий args массив
                const existingArgs = argsMatch[1];
                const newArgs = existingArgs.trim() + 
                    (existingArgs.trim().endsWith(',') ? '' : ',') + 
                    '\n                            ' + 
                    metricsFlags.map(flag => `'${flag}'`).join(',\n                            ');
                
                const newConfig = config.replace(argsPattern, `args: [${newArgs}]`);
                modified = true;
                console.log(`✅ Добавлены флаги метрик в: ${filePath}`);
                return `puppeteer.launch({${newConfig}})`;
            } else {
                // Если нет args, добавляем их
                const newConfig = config.trim() + 
                    (config.trim().endsWith(',') ? '' : ',') + 
                    '\n            args: [\n                ' + 
                    metricsFlags.map(flag => `'${flag}'`).join(',\n                ') + 
                    '\n            ]';
                modified = true;
                console.log(`✅ Добавлен args массив с флагами метрик в: ${filePath}`);
                return `puppeteer.launch({${newConfig}})`;
            }
        });
        
        if (modified) {
            fs.writeFileSync(filePath, content, 'utf8');
            console.log(`💾 Файл сохранен: ${filePath}`);
        } else {
            console.log(`ℹ️  Изменения не требуются: ${filePath}`);
        }
        
    } catch (error) {
        console.error(`❌ Ошибка при обработке файла ${filePath}:`, error.message);
    }
}

// Основная функция
function main() {
    console.log('🚀 Начинаем исправление всех файлов с puppeteer.launch...\n');
    
    let fixedCount = 0;
    let totalCount = filesToFix.length;
    
    filesToFix.forEach(filePath => {
        fixPuppeteerLaunch(filePath);
        fixedCount++;
    });
    
    console.log(`\n✅ Обработано файлов: ${fixedCount}/${totalCount}`);
    console.log('🎉 Исправление завершено!');
}

// Запускаем скрипт
main();

const fs = require('fs');
const path = require('path');

// Список файлов в папке scripts, которые нужно исправить
const scriptsFiles = [
    'scripts/test-fetch.js',
    'scripts/fetch-with-session.js',
    'scripts/fetch-with-proxy.js',
    'scripts/fetch-with-chrome.js',
    'scripts/fetch-ultimate.js',
    'scripts/fetch-stealth.js',
    'scripts/fetch-stealth-advanced.js',
    'scripts/fetch-listing.js',
    'scripts/fetch-multiple-attempts.js',
    'scripts/fetch-listing-advanced.js',
    'scripts/fetch-item.js',
    'scripts/fetch-fully-automated.js',
    'scripts/fetch-browser-headless.js',
    'scripts/fetch-browser-extension.js',
    'scripts/fetch-browser-system.js'
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
                    '\n      ' + 
                    metricsFlags.map(flag => `'${flag}'`).join(',\n      ');
                
                const newConfig = config.replace(argsPattern, `args: [${newArgs}]`);
                modified = true;
                console.log(`✅ Добавлены флаги метрик в: ${filePath}`);
                return `puppeteer.launch({${newConfig}})`;
            } else {
                // Если нет args, добавляем их
                const newConfig = config.trim() + 
                    (config.trim().endsWith(',') ? '' : ',') + 
                    '\n    args: [\n      ' + 
                    metricsFlags.map(flag => `'${flag}'`).join(',\n      ') + 
                    '\n    ]';
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
    console.log('🚀 Начинаем исправление файлов в папке scripts...\n');
    
    let fixedCount = 0;
    let totalCount = scriptsFiles.length;
    
    scriptsFiles.forEach(filePath => {
        fixPuppeteerLaunch(filePath);
        fixedCount++;
    });
    
    console.log(`\n✅ Обработано файлов: ${fixedCount}/${totalCount}`);
    console.log('🎉 Исправление завершено!');
}

// Запускаем скрипт
main();

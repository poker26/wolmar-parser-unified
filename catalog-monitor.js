const fs = require('fs');
const path = require('path');

class CatalogMonitor {
    constructor() {
        this.progressFile = './catalog-progress.json';
        this.errorLogFile = './catalog-errors.log';
    }

    // Показать текущий прогресс
    showProgress() {
        try {
            if (!fs.existsSync(this.progressFile)) {
                console.log('❌ Файл прогресса не найден. Парсер еще не запускался.');
                return;
            }

            const progress = JSON.parse(fs.readFileSync(this.progressFile, 'utf8'));
            
            console.log('📊 Текущий прогресс парсинга каталога:');
            console.log('=====================================');
            console.log(`🕐 Начало работы: ${new Date(progress.startTime).toLocaleString()}`);
            console.log(`🕐 Последнее обновление: ${new Date(progress.lastUpdate).toLocaleString()}`);
            console.log(`📈 Последний обработанный ID: ${progress.lastProcessedId}`);
            console.log(`✅ Обработано лотов: ${progress.totalProcessed}`);
            console.log(`❌ Ошибок: ${progress.totalErrors}`);
            
            if (progress.totalProcessed > 0) {
                const successRate = ((progress.totalProcessed - progress.totalErrors) / progress.totalProcessed * 100).toFixed(2);
                console.log(`📊 Процент успеха: ${successRate}%`);
            }

            const duration = new Date(progress.lastUpdate) - new Date(progress.startTime);
            const hours = Math.floor(duration / (1000 * 60 * 60));
            const minutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60));
            console.log(`⏱️ Время работы: ${hours}ч ${minutes}м`);

        } catch (error) {
            console.error('❌ Ошибка чтения файла прогресса:', error.message);
        }
    }

    // Показать последние ошибки
    showRecentErrors(count = 10) {
        try {
            if (!fs.existsSync(this.errorLogFile)) {
                console.log('✅ Файл ошибок не найден. Ошибок пока нет.');
                return;
            }

            const errorLog = fs.readFileSync(this.errorLogFile, 'utf8');
            const errors = errorLog.split('\n\n').filter(error => error.trim());
            
            console.log(`📋 Последние ${Math.min(count, errors.length)} ошибок:`);
            console.log('=====================================');
            
            const recentErrors = errors.slice(-count);
            recentErrors.forEach((error, index) => {
                console.log(`\n${index + 1}. ${error}`);
            });

        } catch (error) {
            console.error('❌ Ошибка чтения файла ошибок:', error.message);
        }
    }

    // Очистить файлы прогресса и ошибок
    clearFiles() {
        try {
            if (fs.existsSync(this.progressFile)) {
                fs.unlinkSync(this.progressFile);
                console.log('✅ Файл прогресса удален');
            }
            
            if (fs.existsSync(this.errorLogFile)) {
                fs.unlinkSync(this.errorLogFile);
                console.log('✅ Файл ошибок удален');
            }
            
            console.log('🧹 Все файлы мониторинга очищены');
        } catch (error) {
            console.error('❌ Ошибка очистки файлов:', error.message);
        }
    }

    // Показать статистику по ошибкам
    showErrorStats() {
        try {
            if (!fs.existsSync(this.errorLogFile)) {
                console.log('✅ Файл ошибок не найден. Ошибок пока нет.');
                return;
            }

            const errorLog = fs.readFileSync(this.errorLogFile, 'utf8');
            const errors = errorLog.split('\n\n').filter(error => error.trim());
            
            console.log('📊 Статистика ошибок:');
            console.log('=====================');
            console.log(`📈 Всего ошибок: ${errors.length}`);
            
            // Группируем ошибки по типам
            const errorTypes = {};
            errors.forEach(error => {
                const match = error.match(/Лот \d+-\d+: (.+?)\n/);
                if (match) {
                    const errorType = match[1];
                    errorTypes[errorType] = (errorTypes[errorType] || 0) + 1;
                }
            });
            
            console.log('\n📋 Типы ошибок:');
            Object.entries(errorTypes)
                .sort(([,a], [,b]) => b - a)
                .forEach(([type, count]) => {
                    console.log(`   ${type}: ${count} раз`);
                });

        } catch (error) {
            console.error('❌ Ошибка анализа ошибок:', error.message);
        }
    }

    // Показать справку
    showHelp() {
        console.log('🔧 Монитор каталога монет');
        console.log('========================');
        console.log('Использование: node catalog-monitor.js [команда]');
        console.log('');
        console.log('Команды:');
        console.log('  progress, p    - Показать текущий прогресс');
        console.log('  errors, e      - Показать последние ошибки');
        console.log('  stats, s       - Показать статистику ошибок');
        console.log('  clear, c       - Очистить файлы мониторинга');
        console.log('  help, h        - Показать эту справку');
        console.log('');
        console.log('Примеры:');
        console.log('  node catalog-monitor.js progress');
        console.log('  node catalog-monitor.js errors 20');
        console.log('  node catalog-monitor.js stats');
    }
}

// Запуск монитора
async function main() {
    const monitor = new CatalogMonitor();
    const args = process.argv.slice(2);
    const command = args[0] || 'progress';
    const param = args[1];

    switch (command.toLowerCase()) {
        case 'progress':
        case 'p':
            monitor.showProgress();
            break;
            
        case 'errors':
        case 'e':
            const count = param ? parseInt(param) : 10;
            monitor.showRecentErrors(count);
            break;
            
        case 'stats':
        case 's':
            monitor.showErrorStats();
            break;
            
        case 'clear':
        case 'c':
            monitor.clearFiles();
            break;
            
        case 'help':
        case 'h':
        default:
            monitor.showHelp();
            break;
    }
}

if (require.main === module) {
    main();
}

module.exports = CatalogMonitor;

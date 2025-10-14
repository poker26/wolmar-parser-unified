const fs = require('fs');
const path = require('path');

// Копируем логику из admin-server.js для тестирования
function readLogs(type, lines = 100) {
    let logFile;
    
    // Специальная обработка для category-parser
    if (type === 'category-parser') {
        logFile = path.join(__dirname, 'logs', 'category-parser.log');
    } else {
        logFile = path.join(__dirname, 'logs', `${type}-parser.log`);
    }
    
    console.log(`🔍 Ищем файл логов: ${logFile}`);
    console.log(`📁 Абсолютный путь: ${path.resolve(logFile)}`);
    console.log(`📊 Файл существует: ${fs.existsSync(logFile)}`);
    
    if (!fs.existsSync(logFile)) {
        console.log('❌ Файл не найден, возвращаем пустой массив');
        return [];
    }
    
    console.log(`📄 Размер файла: ${fs.statSync(logFile).size} байт`);
    
    try {
        const content = fs.readFileSync(logFile, 'utf8');
        console.log(`📋 Содержимое файла (первые 200 символов):`);
        console.log(content.substring(0, 200));
        
        const logLines = content.split('\n').filter(line => line.trim());
        console.log(`📊 Всего строк: ${logLines.length}`);
        console.log(`📋 Последние ${Math.min(lines, logLines.length)} строк:`);
        
        const result = logLines.slice(-lines);
        result.forEach((line, index) => {
            console.log(`  ${index + 1}: ${line}`);
        });
        
        return result;
    } catch (error) {
        console.error('❌ Ошибка чтения файла:', error.message);
        return [];
    }
}

// Тестируем функцию
console.log('🧪 Тестируем функцию readLogs для category-parser:');
console.log('='.repeat(60));

const logs = readLogs('category-parser', 10);

console.log('\n📊 Результат:');
console.log(`Количество логов: ${logs.length}`);
console.log('Логи:', logs);

// Также проверим другие типы для сравнения
console.log('\n' + '='.repeat(60));
console.log('🧪 Тестируем функцию readLogs для main:');

const mainLogs = readLogs('main', 5);
console.log(`Количество логов main: ${mainLogs.length}`);

// Проверим, какие файлы есть в директории logs
console.log('\n' + '='.repeat(60));
console.log('📁 Содержимое директории logs:');

const logsDir = path.join(__dirname, 'logs');
if (fs.existsSync(logsDir)) {
    const files = fs.readdirSync(logsDir);
    files.forEach(file => {
        const filePath = path.join(logsDir, file);
        const stats = fs.statSync(filePath);
        console.log(`  ${file} (${stats.size} байт, ${stats.mtime})`);
    });
} else {
    console.log('❌ Директория logs не существует');
}

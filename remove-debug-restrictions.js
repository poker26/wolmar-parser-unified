#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('🔧 Удаление отладочных ограничений из catalog-parser.js...');

// Читаем файл
const filePath = 'catalog-parser.js';
let content = fs.readFileSync(filePath, 'utf8');

// 1. Удаляем фильтр по драгоценным металлам
const metalFilterRegex = /if \(!\[['"]AU['"],\s*['"]AG['"],\s*['"]PT['"],\s*['"]PD['"]\]\.includes\(parsedData\.metal\?\.toUpperCase\(\)\)\) \{[^}]+\}/gs;
content = content.replace(metalFilterRegex, '// Фильтр по драгоценным металлам удален');

// 2. Удаляем фильтр по аукциону 968
const auctionFilterRegex = /const whereClause = `WHERE auction_number = '968' AND \(metal = 'AU' OR metal = 'AG' OR metal = 'PT' OR metal = 'PD'\)`;/;
content = content.replace(auctionFilterRegex, 'const whereClause = `WHERE 1=1`; // Обрабатываем все аукционы');

// 3. Удаляем отладочные console.log
const debugLogsRegex = /console\.log\(`🔍 До извлечения веса: .*?`\);/g;
content = content.replace(debugLogsRegex, '// Отладочный лог удален');

const debugLogsRegex2 = /console\.log\(`🔍 После извлечения веса: .*?`\);/g;
content = content.replace(debugLogsRegex2, '// Отладочный лог удален');

// Записываем обратно
fs.writeFileSync(filePath, content);

console.log('✅ Отладочные ограничения удалены:');
console.log('   - Фильтр по драгоценным металлам');
console.log('   - Фильтр по аукциону 968');
console.log('   - Отладочные логи');
console.log('');
console.log('🚀 Теперь парсер будет обрабатывать все записи!');





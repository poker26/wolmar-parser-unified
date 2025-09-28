const fs = require('fs');

// Скрипт для удаления API endpoints каталога из server.js
// Удаляет только endpoints, связанные с каталогом монет

console.log('🧹 Удаление API endpoints каталога из server.js...');

// Читаем файл
const serverContent = fs.readFileSync('server.js', 'utf8');

// Список endpoints каталога для удаления
const catalogEndpoints = [
    '/api/auctions',
    '/api/auctions/:auctionNumber/lots', 
    '/api/auctions/:auctionNumber/stats',
    '/api/lots/:id',
    '/api/filters'
];

// Функция для удаления блока endpoint
function removeEndpoint(content, endpoint) {
    const lines = content.split('\n');
    const result = [];
    let skip = false;
    let braceCount = 0;
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Находим начало endpoint
        if (line.includes(`app.get('${endpoint}'`) || line.includes(`app.get("${endpoint}"`)) {
            skip = true;
            braceCount = 0;
            continue;
        }
        
        if (skip) {
            // Считаем открывающие и закрывающие скобки
            const openBraces = (line.match(/\{/g) || []).length;
            const closeBraces = (line.match(/\}/g) || []).length;
            braceCount += openBraces - closeBraces;
            
            // Если дошли до конца блока
            if (braceCount <= 0 && line.trim() === '});') {
                skip = false;
                continue;
            }
            
            // Пропускаем строки внутри блока
            continue;
        }
        
        result.push(line);
    }
    
    return result.join('\n');
}

// Удаляем каждый endpoint
let cleanedContent = serverContent;
for (const endpoint of catalogEndpoints) {
    console.log(`🗑️ Удаляем endpoint: ${endpoint}`);
    cleanedContent = removeEndpoint(cleanedContent, endpoint);
}

// Создаем резервную копию
fs.writeFileSync('server.js.backup', serverContent);
console.log('💾 Создана резервная копия: server.js.backup');

// Сохраняем очищенный файл
fs.writeFileSync('server.js', cleanedContent);
console.log('✅ API endpoints каталога удалены из server.js');

// Проверяем результат
const finalContent = fs.readFileSync('server.js', 'utf8');
const remainingEndpoints = catalogEndpoints.filter(endpoint => 
    finalContent.includes(endpoint)
);

if (remainingEndpoints.length === 0) {
    console.log('✅ Все endpoints каталога успешно удалены');
} else {
    console.log('⚠️ Остались endpoints:', remainingEndpoints);
}

console.log('🎯 API endpoints каталога теперь изолированы в ветке web-interface');

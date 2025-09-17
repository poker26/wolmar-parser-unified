const axios = require('axios');

async function debugCBRParsing() {
    try {
        console.log('🔍 Отлаживаем парсинг данных ЦБ РФ...');
        
        // Тестируем на конкретную дату
        const testDate = '17.09.2025';
        const url = `https://cbr.ru/hd_base/metall/metall_base_new/?UniDbQuery.From=${testDate}&UniDbQuery.To=${testDate}&UniDbQuery.Gold=true&UniDbQuery.Silver=true&UniDbQuery.Platinum=true&UniDbQuery.Palladium=true&UniDbQuery.Posted=True&UniDbQuery.so=1`;
        
        console.log(`📅 Тестовая дата: ${testDate}`);
        console.log(`🔗 URL: ${url}`);
        
        const response = await axios.get(url, { 
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        console.log(`📊 Статус ответа: ${response.status}`);
        console.log(`📏 Размер ответа: ${response.data.length} символов`);
        
        // Сохраняем HTML для анализа
        const fs = require('fs');
        fs.writeFileSync('cbr-response.html', response.data);
        console.log('💾 HTML ответ сохранен в файл cbr-response.html');
        
        // Ищем таблицы в HTML
        const html = response.data;
        
        // Ищем все таблицы
        const tableMatches = html.match(/<table[^>]*>[\s\S]*?<\/table>/g);
        console.log(`📋 Найдено таблиц: ${tableMatches ? tableMatches.length : 0}`);
        
        if (tableMatches) {
            tableMatches.forEach((table, index) => {
                console.log(`\n📊 Таблица ${index + 1}:`);
                console.log(`   Размер: ${table.length} символов`);
                
                // Ищем строки в таблице
                const rowMatches = table.match(/<tr[^>]*>[\s\S]*?<\/tr>/g);
                console.log(`   Строк: ${rowMatches ? rowMatches.length : 0}`);
                
                if (rowMatches && rowMatches.length > 0) {
                    // Показываем первые несколько строк
                    const sampleRows = rowMatches.slice(0, 3);
                    sampleRows.forEach((row, rowIndex) => {
                        console.log(`   Строка ${rowIndex + 1}: ${row.substring(0, 200)}...`);
                    });
                }
            });
        }
        
        // Ищем упоминания металлов
        const metals = ['золот', 'серебр', 'платин', 'паллади'];
        metals.forEach(metal => {
            const matches = html.match(new RegExp(metal, 'gi'));
            console.log(`🔍 Упоминаний "${metal}": ${matches ? matches.length : 0}`);
        });
        
        // Ищем цены (числа с запятыми)
        const priceMatches = html.match(/\d+,\d+/g);
        console.log(`💰 Найдено цен (формат X,XX): ${priceMatches ? priceMatches.length : 0}`);
        if (priceMatches && priceMatches.length > 0) {
            console.log(`   Примеры: ${priceMatches.slice(0, 10).join(', ')}`);
        }
        
    } catch (error) {
        console.error('❌ Ошибка отладки:', error.message);
    }
}

debugCBRParsing();

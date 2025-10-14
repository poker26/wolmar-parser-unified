const http = require('http');

// Тестируем API endpoint для логов парсера категорий
function testLogsAPI() {
    const options = {
        hostname: 'localhost',
        port: 3001,
        path: '/api/admin/logs/category-parser',
        method: 'GET',
        headers: {
            'Content-Type': 'application/json'
        }
    };

    console.log('🔍 Тестируем API endpoint: /api/admin/logs/category-parser');
    
    const req = http.request(options, (res) => {
        console.log(`📊 Статус ответа: ${res.statusCode}`);
        console.log(`📋 Заголовки:`, res.headers);
        
        let data = '';
        res.on('data', (chunk) => {
            data += chunk;
        });
        
        res.on('end', () => {
            console.log('📄 Ответ сервера:');
            try {
                const jsonData = JSON.parse(data);
                console.log(JSON.stringify(jsonData, null, 2));
            } catch (error) {
                console.log('❌ Ошибка парсинга JSON:', error.message);
                console.log('📄 Сырой ответ:', data);
            }
        });
    });

    req.on('error', (error) => {
        console.error('❌ Ошибка запроса:', error.message);
    });

    req.end();
}

// Также тестируем другие типы логов для сравнения
function testOtherLogsAPI() {
    const logTypes = ['main', 'update', 'catalog'];
    
    logTypes.forEach(type => {
        const options = {
            hostname: 'localhost',
            port: 3001,
            path: `/api/admin/logs/${type}`,
            method: 'GET'
        };

        console.log(`\n🔍 Тестируем API endpoint: /api/admin/logs/${type}`);
        
        const req = http.request(options, (res) => {
            console.log(`📊 Статус ответа: ${res.statusCode}`);
            
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                try {
                    const jsonData = JSON.parse(data);
                    console.log(`📄 Количество логов: ${jsonData.logs ? jsonData.logs.length : 'неизвестно'}`);
                } catch (error) {
                    console.log('❌ Ошибка парсинга JSON');
                }
            });
        });

        req.on('error', (error) => {
            console.error('❌ Ошибка запроса:', error.message);
        });

        req.end();
    });
}

console.log('🚀 Запуск тестирования API логов...\n');
testLogsAPI();

setTimeout(() => {
    console.log('\n' + '='.repeat(50));
    testOtherLogsAPI();
}, 2000);

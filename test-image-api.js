const http = require('http');

async function testImageApi() {
    console.log('🔍 Тестирование API эндпоинта для изображений...\n');

    // Тестируем получение изображения аверса для ID 93
    const testUrl = 'http://localhost:3000/api/catalog/coins/93/image/avers';
    
    console.log(`📡 Запрос: ${testUrl}`);
    
    const options = {
        hostname: 'localhost',
        port: 3000,
        path: '/api/catalog/coins/93/image/avers',
        method: 'GET'
    };

    const req = http.request(options, (res) => {
        console.log(`📊 Статус ответа: ${res.statusCode}`);
        console.log(`📋 Заголовки:`, res.headers);
        
        if (res.statusCode === 200) {
            console.log('✅ Изображение получено успешно!');
            
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                console.log(`📏 Размер данных: ${data.length} байт`);
                console.log(`🔍 Первые 50 символов: ${data.substring(0, 50)}`);
            });
        } else {
            console.log('❌ Ошибка получения изображения');
        }
    });

    req.on('error', (error) => {
        console.error('❌ Ошибка запроса:', error.message);
    });

    req.end();
}

testImageApi();

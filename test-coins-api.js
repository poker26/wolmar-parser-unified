const http = require('http');

async function testCoinsApi() {
    console.log('🔍 Тестирование API для получения списка монет...\n');

    const options = {
        hostname: 'localhost',
        port: 3000,
        path: '/api/catalog/coins?limit=1',
        method: 'GET'
    };

    const req = http.request(options, (res) => {
        console.log(`📊 Статус ответа: ${res.statusCode}`);
        
        let data = '';
        res.on('data', (chunk) => {
            data += chunk;
        });
        
        res.on('end', () => {
            try {
                const result = JSON.parse(data);
                console.log('📋 Структура ответа:');
                console.log(`  - Всего монет: ${result.total || 'не указано'}`);
                console.log(`  - Монет на странице: ${result.coins ? result.coins.length : 'не указано'}`);
                
                if (result.coins && result.coins.length > 0) {
                    const coin = result.coins[0];
                    console.log('\n📋 Первая монета:');
                    console.log(`  - ID: ${coin.id}`);
                    console.log(`  - Название: ${coin.coin_name}`);
                    console.log(`  - has_avers_image: ${coin.has_avers_image}`);
                    console.log(`  - has_revers_image: ${coin.has_revers_image}`);
                    console.log(`  - avers_image: ${coin.avers_image || 'не указано'}`);
                    console.log(`  - revers_image: ${coin.revers_image || 'не указано'}`);
                }
            } catch (error) {
                console.error('❌ Ошибка парсинга JSON:', error.message);
                console.log('📄 Сырые данные:', data.substring(0, 200));
            }
        });
    });

    req.on('error', (error) => {
        console.error('❌ Ошибка запроса:', error.message);
    });

    req.end();
}

testCoinsApi();







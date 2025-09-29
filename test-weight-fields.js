const http = require('http');

async function testWeightFields() {
    console.log('🔍 Проверка полей веса в API...\n');

    const options = {
        hostname: 'localhost',
        port: 3000,
        path: '/api/catalog/coins?limit=1',
        method: 'GET'
    };

    const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
            data += chunk;
        });
        
        res.on('end', () => {
            try {
                const result = JSON.parse(data);
                
                if (result.coins && result.coins.length > 0) {
                    const coin = result.coins[0];
                    console.log('📋 Поля веса в API:');
                    console.log(`  - coin_weight: ${coin.coin_weight || 'не указано'}`);
                    console.log(`  - fineness: ${coin.fineness || 'не указано'}`);
                    console.log(`  - pure_metal_weight: ${coin.pure_metal_weight || 'не указано'}`);
                    console.log(`  - weight_oz: ${coin.weight_oz || 'не указано'}`);
                    
                    console.log('\n📋 Все поля монеты:');
                    Object.keys(coin).forEach(key => {
                        console.log(`  - ${key}: ${coin[key]}`);
                    });
                }
            } catch (error) {
                console.error('❌ Ошибка парсинга JSON:', error.message);
            }
        });
    });

    req.on('error', (error) => {
        console.error('❌ Ошибка запроса:', error.message);
    });

    req.end();
}

testWeightFields();

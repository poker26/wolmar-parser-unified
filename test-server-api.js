const http = require('http');

async function testServerAPI() {
    console.log('🧪 Тестирование API сервера:\n');
    
    try {
        // Тестируем основной API
        console.log('1️⃣ Тестируем /api/catalog/coins...');
        const coinsResponse = await fetch('http://46.173.19.68:3000/api/catalog/coins?limit=5');
        
        if (coinsResponse.ok) {
            const coinsData = await coinsResponse.json();
            console.log(`✅ API отвечает: ${coinsData.coins.length} монет`);
            
            if (coinsData.coins.length > 0) {
                const firstCoin = coinsData.coins[0];
                console.log(`📊 Первая монета: ID ${firstCoin.id}, ${firstCoin.coin_name}`);
                console.log(`🖼️ has_avers_image: ${firstCoin.has_avers_image}`);
                console.log(`🖼️ has_revers_image: ${firstCoin.has_revers_image}`);
                
                // Тестируем API изображения
                if (firstCoin.has_avers_image) {
                    console.log(`\n2️⃣ Тестируем API изображения для ID ${firstCoin.id}...`);
                    const imageResponse = await fetch(`http://46.173.19.68:3000/api/catalog/coins/${firstCoin.id}/image/avers`);
                    
                    if (imageResponse.ok) {
                        console.log(`✅ Изображение загружено: ${imageResponse.headers.get('content-length')} байт`);
                        console.log(`📊 Content-Type: ${imageResponse.headers.get('content-type')}`);
                    } else {
                        console.log(`❌ Ошибка загрузки изображения: ${imageResponse.status}`);
                    }
                }
            }
        } else {
            console.log(`❌ API ошибка: ${coinsResponse.status}`);
        }
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    }
}

testServerAPI();







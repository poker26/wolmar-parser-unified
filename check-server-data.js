const http = require('http');

async function checkServerData() {
    console.log('🔍 Проверка данных на сервере:\n');
    
    try {
        // Получаем первые 5 монет
        const response = await fetch('http://46.173.19.68:3000/api/catalog/coins?limit=5');
        const data = await response.json();
        
        console.log(`📊 Получено монет: ${data.coins.length}`);
        
        data.coins.forEach((coin, index) => {
            console.log(`\n--- Монета ${index + 1} ---`);
            console.log(`ID: ${coin.id}`);
            console.log(`Название: ${coin.coin_name}`);
            console.log(`Год: ${coin.year}`);
            console.log(`Металл: ${coin.metal}`);
            console.log(`Аукцион: ${coin.auction_number}`);
            console.log(`Лот: ${coin.lot_number}`);
            console.log(`has_avers_image: ${coin.has_avers_image}`);
            console.log(`has_revers_image: ${coin.has_revers_image}`);
            
            // Проверим API изображения
            if (coin.has_avers_image) {
                const imageUrl = `http://46.173.19.68:3000/api/catalog/coins/${coin.id}/image/avers`;
                console.log(`🖼️ Аверс URL: ${imageUrl}`);
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    }
}

checkServerData();
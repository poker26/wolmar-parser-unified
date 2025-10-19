const fetch = require('node-fetch');

async function testFiltersAPI() {
    try {
        console.log('🔍 Тестируем API endpoint /api/filters...');
        
        // Тестируем без параметров
        console.log('\n📡 Запрос без параметров:');
        const response1 = await fetch('http://localhost:3000/api/filters');
        const data1 = await response1.json();
        console.log('Статус:', response1.status);
        console.log('Данные:', JSON.stringify(data1, null, 2));
        
        // Тестируем с номером аукциона
        console.log('\n📡 Запрос с номером аукциона (2009):');
        const response2 = await fetch('http://localhost:3000/api/filters?auctionNumber=2009');
        const data2 = await response2.json();
        console.log('Статус:', response2.status);
        console.log('Данные:', JSON.stringify(data2, null, 2));
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    }
}

testFiltersAPI();
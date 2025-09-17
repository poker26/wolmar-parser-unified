const axios = require('axios');

async function testMetalsAPI() {
    try {
        console.log('🧪 Тестируем API эндпоинты для цен на металлы...');
        
        // Тест 1: Получение списка цен
        console.log('\n1. Тестируем GET /api/metals-prices?limit=3');
        try {
            const response1 = await axios.get('http://localhost:3000/api/metals-prices?limit=3');
            console.log('✅ Успешно:', response1.data);
        } catch (error) {
            console.log('❌ Ошибка:', error.response?.data || error.message);
        }
        
        // Тест 2: Получение цены на конкретную дату
        console.log('\n2. Тестируем GET /api/metals-prices/2025-09-17');
        try {
            const response2 = await axios.get('http://localhost:3000/api/metals-prices/2025-09-17');
            console.log('✅ Успешно:', response2.data);
        } catch (error) {
            console.log('❌ Ошибка:', error.response?.data || error.message);
        }
        
        // Тест 3: Расчет нумизматической наценки для лота с весом
        console.log('\n3. Тестируем GET /api/numismatic-premium/28017');
        try {
            const response3 = await axios.get('http://localhost:3000/api/numismatic-premium/28017');
            console.log('✅ Успешно:', response3.data);
        } catch (error) {
            console.log('❌ Ошибка:', error.response?.data || error.message);
        }
        
    } catch (error) {
        console.error('❌ Критическая ошибка:', error.message);
    }
}

testMetalsAPI();

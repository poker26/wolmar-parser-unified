const fetch = require('node-fetch');

async function testCollectionAPI() {
    try {
        console.log('🔍 Тестируем API коллекции...');
        
        // Тест без авторизации
        const response = await fetch('http://localhost:3000/api/collection/stats');
        console.log('📊 Статистика коллекции (без авторизации):', response.status);
        
        if (response.ok) {
            const data = await response.json();
            console.log('📊 Данные статистики:', JSON.stringify(data, null, 2));
        }
        
        // Тест с авторизацией (нужен токен)
        console.log('\n🔐 Для полного теста нужен токен авторизации');
        console.log('💡 Попробуйте в браузере:');
        console.log('1. Откройте Developer Tools (F12)');
        console.log('2. Перейдите на вкладку Network');
        console.log('3. Обновите страницу');
        console.log('4. Найдите запрос к /api/collection/stats');
        console.log('5. Посмотрите Response - какие данные приходят');
        
    } catch (error) {
        console.error('❌ Ошибка тестирования API:', error);
    }
}

testCollectionAPI();

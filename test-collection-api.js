const axios = require('axios');

const BASE_URL = 'http://localhost:3000';

async function testCollectionAPI() {
    console.log('🧪 Тестирование API коллекций...\n');

    try {
        // 1. Регистрация пользователя
        console.log('1️⃣ Регистрация пользователя...');
        const registerResponse = await axios.post(`${BASE_URL}/api/auth/register`, {
            username: 'testuser',
            password: 'password123',
            email: 'test@example.com',
            fullName: 'Test User'
        });
        console.log('✅ Пользователь зарегистрирован:', registerResponse.data);

        // 2. Авторизация
        console.log('\n2️⃣ Авторизация...');
        const loginResponse = await axios.post(`${BASE_URL}/api/auth/login`, {
            username: 'testuser',
            password: 'password123'
        });
        const token = loginResponse.data.token;
        console.log('✅ Авторизация успешна, токен получен');

        // 3. Получение профиля
        console.log('\n3️⃣ Получение профиля...');
        const profileResponse = await axios.get(`${BASE_URL}/api/auth/profile`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        console.log('✅ Профиль получен:', profileResponse.data.user.username);

        // 4. Получение статистики каталога для поиска монет
        console.log('\n4️⃣ Получение статистики каталога...');
        const statsResponse = await axios.get(`${BASE_URL}/api/catalog/stats`);
        console.log('✅ Статистика каталога:', statsResponse.data);

        // 5. Поиск монет для добавления в коллекцию
        console.log('\n5️⃣ Поиск монет...');
        const coinsResponse = await axios.get(`${BASE_URL}/api/catalog/coins?limit=5`);
        const coins = coinsResponse.data.coins;
        console.log(`✅ Найдено ${coins.length} монет`);

        if (coins.length > 0) {
            const firstCoin = coins[0];
            console.log(`📄 Первая монета: ${firstCoin.coin_name} (ID: ${firstCoin.id})`);

            // 6. Проверка, есть ли монета в коллекции
            console.log('\n6️⃣ Проверка коллекции...');
            const checkResponse = await axios.get(`${BASE_URL}/api/collection/check/${firstCoin.id}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            console.log('✅ Монета в коллекции:', checkResponse.data.isInCollection);

            // 7. Добавление монеты в коллекцию
            console.log('\n7️⃣ Добавление монеты в коллекцию...');
            const addResponse = await axios.post(`${BASE_URL}/api/collection/add`, {
                coinId: firstCoin.id,
                notes: 'Тестовая монета',
                conditionRating: 4,
                purchasePrice: 100.50,
                purchaseDate: '2025-01-01'
            }, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            console.log('✅ Монета добавлена в коллекцию:', addResponse.data);

            // 8. Получение коллекции пользователя
            console.log('\n8️⃣ Получение коллекции...');
            const collectionResponse = await axios.get(`${BASE_URL}/api/collection`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            console.log(`✅ Коллекция содержит ${collectionResponse.data.coins.length} монет`);
            console.log('📊 Пагинация:', collectionResponse.data.pagination);

            // 9. Получение статистики коллекции
            console.log('\n9️⃣ Статистика коллекции...');
            const collectionStatsResponse = await axios.get(`${BASE_URL}/api/collection/stats`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            console.log('✅ Статистика коллекции:', collectionStatsResponse.data);

            // 10. Обновление информации о монете
            console.log('\n🔟 Обновление информации о монете...');
            const updateResponse = await axios.put(`${BASE_URL}/api/collection/update`, {
                coinId: firstCoin.id,
                notes: 'Обновленные заметки',
                conditionRating: 5
            }, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            console.log('✅ Информация о монете обновлена:', updateResponse.data);

            // 11. Удаление монеты из коллекции
            console.log('\n1️⃣1️⃣ Удаление монеты из коллекции...');
            const removeResponse = await axios.delete(`${BASE_URL}/api/collection/remove`, {
                data: { coinId: firstCoin.id },
                headers: { 'Authorization': `Bearer ${token}` }
            });
            console.log('✅ Монета удалена из коллекции:', removeResponse.data);

        } else {
            console.log('⚠️ Нет монет в каталоге для тестирования');
        }

        console.log('\n🎉 Все тесты API коллекций прошли успешно!');

    } catch (error) {
        console.error('❌ Ошибка тестирования:', error.response?.data || error.message);
    }
}

// Запускаем тесты
testCollectionAPI();

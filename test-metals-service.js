const MetalsPriceService = require('./metals-price-service');

async function testMetalsService() {
    console.log('🧪 Тестируем MetalsPriceService...');
    
    const service = new MetalsPriceService();
    
    try {
        // Тест 1: Проверяем подключение к базе данных
        console.log('\n1. Тестируем подключение к базе данных...');
        const testQuery = await service.pool.query('SELECT 1 as test');
        console.log('✅ Подключение к БД работает:', testQuery.rows[0]);
        
        // Тест 2: Проверяем таблицу metals_prices
        console.log('\n2. Проверяем таблицу metals_prices...');
        const tableCheck = await service.pool.query(`
            SELECT COUNT(*) as count 
            FROM metals_prices 
            WHERE date >= '2025-09-01'
        `);
        console.log('✅ Записей в таблице metals_prices с сентября:', tableCheck.rows[0].count);
        
        // Тест 3: Тестируем получение цены из БД
        console.log('\n3. Тестируем получение цены из БД...');
        const priceData = await service.getMetalPriceFromDB('2025-09-17', 'gold_price');
        console.log('✅ Данные о цене золота на 17.09.2025:', priceData);
        
        // Тест 4: Тестируем расчет нумизматической наценки
        console.log('\n4. Тестируем расчет нумизматической наценки...');
        const premium = service.calculateNumismaticPremium(
            100000, // цена лота
            7.78,   // вес в граммах
            9741.18, // цена золота за грамм
            82.84   // курс USD
        );
        console.log('✅ Расчет нумизматической наценки:', premium);
        
    } catch (error) {
        console.error('❌ Ошибка в MetalsPriceService:', error);
    } finally {
        await service.close();
    }
}

testMetalsService();

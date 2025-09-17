const MetalsPriceService = require('./metals-price-service');

async function testDateFormat() {
    const service = new MetalsPriceService();
    
    try {
        console.log('🧪 Тестируем различные форматы дат...');
        
        // Тест 1: Строка в формате YYYY-MM-DD
        console.log('\n1. Тестируем строку "2025-09-04":');
        const result1 = await service.getMetalPriceFromDB('2025-09-04', 'gold');
        console.log('Результат:', result1);
        
        // Тест 2: Date объект
        console.log('\n2. Тестируем Date объект:');
        const date2 = new Date('2025-09-04');
        const result2 = await service.getMetalPriceFromDB(date2, 'gold');
        console.log('Результат:', result2);
        
        // Тест 3: Проверим, что есть в базе данных
        console.log('\n3. Проверяем данные в базе:');
        const query = `
            SELECT date, gold_price, usd_rate
            FROM metals_prices 
            WHERE date = '2025-09-04'::date
        `;
        const result3 = await service.pool.query(query);
        console.log('Данные в БД:', result3.rows);
        
    } catch (error) {
        console.error('❌ Ошибка:', error);
    } finally {
        await service.close();
    }
}

testDateFormat();

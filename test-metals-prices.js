const MetalsPriceService = require('./metals-price-service');

async function testMetalsPrices() {
    const service = new MetalsPriceService();
    
    try {
        console.log('🧪 Тестируем загрузку цен на драгоценные металлы...');
        
        // Тестируем получение данных за последние 30 дней
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(endDate.getDate() - 30);
        
        console.log(`📅 Тестовый период: ${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}`);
        
        const results = [];
        const currentDate = new Date(startDate);
        
        while (currentDate <= endDate) {
            // Пропускаем выходные дни
            if (currentDate.getDay() !== 0 && currentDate.getDay() !== 6) {
                console.log(`\n🔍 Тестируем дату: ${currentDate.toLocaleDateString()}`);
                
                const data = await service.getPriceData(new Date(currentDate));
                if (data) {
                    results.push(data);
                    console.log(`✅ Успешно: USD=${data.usdRate}, Au=${data.metals?.gold || 'N/A'}, Ag=${data.metals?.silver || 'N/A'}`);
                    
                    // Сохраняем в базу данных
                    const saved = await service.saveToDatabase(data);
                    console.log(`💾 Сохранено в БД: ${saved ? 'Да' : 'Нет'}`);
                } else {
                    console.log(`❌ Данные не получены`);
                }
                
                // Задержка между запросами
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
            
            currentDate.setDate(currentDate.getDate() + 1);
        }
        
        console.log(`\n📊 Результаты тестирования:`);
        console.log(`   - Обработано дат: ${results.length}`);
        console.log(`   - Успешных запросов: ${results.filter(r => r.usdRate && r.metals).length}`);
        
        // Показываем примеры данных
        if (results.length > 0) {
            console.log(`\n📋 Примеры полученных данных:`);
            results.slice(0, 3).forEach(data => {
                console.log(`   ${data.date}: USD=${data.usdRate}, Au=${data.metals?.gold || 'N/A'}, Ag=${data.metals?.silver || 'N/A'}, Pt=${data.metals?.platinum || 'N/A'}, Pd=${data.metals?.palladium || 'N/A'}`);
            });
        }
        
    } catch (error) {
        console.error('❌ Ошибка тестирования:', error);
    } finally {
        await service.close();
    }
}

testMetalsPrices();

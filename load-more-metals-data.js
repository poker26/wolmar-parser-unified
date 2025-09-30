const MetalsPriceService = require('./metals-price-service');

async function loadMoreMetalsData() {
    const service = new MetalsPriceService();
    
    try {
        console.log('📊 Загружаем данные о ценах на металлы за последние 3 месяца...');
        
        const endDate = new Date('2025-09-17');
        const startDate = new Date('2025-06-01');
        
        let currentDate = new Date(startDate);
        let loadedCount = 0;
        let skippedCount = 0;
        
        while (currentDate <= endDate) {
            const dateStr = currentDate.toISOString().split('T')[0];
            
            try {
                console.log(`📅 Загружаем данные за ${dateStr}...`);
                
                const result = await service.fetchAndSaveMetalsPrices(dateStr);
                
                if (result) {
                    console.log(`   ✅ Данные загружены и сохранены`);
                    loadedCount++;
                } else {
                    console.log(`   ⏭️ Данные уже существуют или недоступны`);
                    skippedCount++;
                }
                
                // Небольшая пауза между запросами
                await new Promise(resolve => setTimeout(resolve, 100));
                
            } catch (error) {
                console.log(`   ❌ Ошибка загрузки данных за ${dateStr}:`, error.message);
                skippedCount++;
            }
            
            // Переходим к следующему дню
            currentDate.setDate(currentDate.getDate() + 1);
        }
        
        console.log(`\n📊 Итого:`);
        console.log(`   ✅ Загружено новых записей: ${loadedCount}`);
        console.log(`   ⏭️ Пропущено: ${skippedCount}`);
        
    } catch (error) {
        console.error('❌ Ошибка:', error);
    } finally {
        await service.close();
    }
}

loadMoreMetalsData();

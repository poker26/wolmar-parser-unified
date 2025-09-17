const MetalsPriceService = require('./metals-price-service');

async function loadMissingMetalsData() {
    const service = new MetalsPriceService();
    
    try {
        console.log('📊 Загружаем недостающие данные о ценах на металлы...');
        
        // Даты, для которых нужны данные
        const missingDates = [
            '2025-08-14', // Аукцион 962
            '2025-07-31'  // Аукцион 960
        ];
        
        let loadedCount = 0;
        let skippedCount = 0;
        
        for (const dateStr of missingDates) {
            try {
                console.log(`📅 Загружаем данные за ${dateStr}...`);
                
                // Получаем данные
                const priceData = await service.getPriceData(dateStr);
                
                if (priceData && priceData.metals) {
                    // Сохраняем в базу данных
                    const saved = await service.saveToDatabase(priceData);
                    
                    if (saved) {
                        console.log(`   ✅ Данные загружены и сохранены`);
                        console.log(`      - USD: ${priceData.usdRate}`);
                        console.log(`      - Золото: ${priceData.metals.gold} ₽/г`);
                        loadedCount++;
                    } else {
                        console.log(`   ⏭️ Данные уже существуют`);
                        skippedCount++;
                    }
                } else {
                    console.log(`   ❌ Данные недоступны`);
                    skippedCount++;
                }
                
                // Небольшая пауза между запросами
                await new Promise(resolve => setTimeout(resolve, 500));
                
            } catch (error) {
                console.log(`   ❌ Ошибка загрузки данных за ${dateStr}:`, error.message);
                skippedCount++;
            }
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

loadMissingMetalsData();

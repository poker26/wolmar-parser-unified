const MetalsPriceService = require('./metals-price-service');

async function loadMetalsData2025() {
    const service = new MetalsPriceService();
    
    try {
        console.log('📊 Загружаем данные о ценах на металлы с 01.01.2025...');
        
        const startDate = new Date('2025-01-01');
        const endDate = new Date('2025-09-17'); // До сегодня
        
        let currentDate = new Date(startDate);
        let loadedCount = 0;
        let skippedCount = 0;
        let errorCount = 0;
        
        const totalDays = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
        let processedDays = 0;
        
        while (currentDate <= endDate) {
            const dateStr = currentDate.toISOString().split('T')[0];
            processedDays++;
            
            try {
                console.log(`📅 [${processedDays}/${totalDays}] Загружаем данные за ${dateStr}...`);
                
                // Получаем данные
                const priceData = await service.getPriceData(dateStr);
                
                if (priceData && priceData.metals) {
                    // Сохраняем в базу данных
                    const saved = await service.saveToDatabase(priceData);
                    
                    if (saved) {
                        console.log(`   ✅ Данные загружены и сохранены`);
                        console.log(`      - USD: ${priceData.usdRate}`);
                        console.log(`      - Золото: ${priceData.metals.gold} ₽/г`);
                        console.log(`      - Серебро: ${priceData.metals.silver} ₽/г`);
                        console.log(`      - Платина: ${priceData.metals.platinum} ₽/г`);
                        console.log(`      - Палладий: ${priceData.metals.palladium} ₽/г`);
                        loadedCount++;
                    } else {
                        console.log(`   ⏭️ Данные уже существуют`);
                        skippedCount++;
                    }
                } else {
                    console.log(`   ❌ Данные недоступны`);
                    skippedCount++;
                }
                
                // Небольшая пауза между запросами (500мс)
                await new Promise(resolve => setTimeout(resolve, 500));
                
            } catch (error) {
                console.log(`   ❌ Ошибка загрузки данных за ${dateStr}:`, error.message);
                errorCount++;
            }
            
            // Переходим к следующему дню
            currentDate.setDate(currentDate.getDate() + 1);
        }
        
        console.log(`\n📊 Итого:`);
        console.log(`   ✅ Загружено новых записей: ${loadedCount}`);
        console.log(`   ⏭️ Пропущено: ${skippedCount}`);
        console.log(`   ❌ Ошибок: ${errorCount}`);
        console.log(`   📅 Всего дней обработано: ${processedDays}`);
        
        // Показываем статистику по месяцам
        console.log(`\n📈 Статистика по месяцам:`);
        const months = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 
                       'Июль', 'Август', 'Сентябрь'];
        
        for (let month = 0; month < 9; month++) {
            const monthStart = new Date(2025, month, 1);
            const monthEnd = new Date(2025, month + 1, 0);
            const monthDays = monthEnd.getDate();
            
            console.log(`   ${months[month]} 2025: ${monthDays} дней`);
        }
        
    } catch (error) {
        console.error('❌ Критическая ошибка:', error);
    } finally {
        await service.close();
    }
}

loadMetalsData2025();

const MetalsPriceService = require('./metals-price-service');

async function loadHistoricalMetalsPrices() {
    const service = new MetalsPriceService();
    
    try {
        console.log('🚀 Начинаем загрузку исторических цен на драгоценные металлы...');
        console.log('📅 Период: последние 10 лет');
        console.log('💰 Источники: ЦБ РФ (курс USD + цены на металлы)');
        console.log('');
        
        // Загружаем данные за последние 10 лет
        const historicalData = await service.getHistoricalData(10);
        
        console.log(`\n📊 Загружено ${historicalData.length} записей`);
        
        // Сохраняем в базу данных
        console.log('💾 Сохраняем данные в базу данных...');
        
        let savedCount = 0;
        let errorCount = 0;
        
        for (const data of historicalData) {
            const saved = await service.saveToDatabase(data);
            if (saved) {
                savedCount++;
            } else {
                errorCount++;
            }
            
            // Показываем прогресс каждые 50 записей
            if ((savedCount + errorCount) % 50 === 0) {
                console.log(`📈 Прогресс: ${savedCount + errorCount}/${historicalData.length} записей обработано`);
            }
        }
        
        console.log('\n🎉 Загрузка завершена!');
        console.log('📊 Статистика:');
        console.log(`   - Успешно сохранено: ${savedCount} записей`);
        console.log(`   - Ошибок: ${errorCount} записей`);
        console.log(`   - Процент успеха: ${((savedCount / historicalData.length) * 100).toFixed(1)}%`);
        
        // Показываем примеры загруженных данных
        if (historicalData.length > 0) {
            console.log('\n📋 Примеры загруженных данных:');
            const examples = historicalData.slice(0, 5);
            examples.forEach(data => {
                console.log(`   ${data.date}: USD=${data.usdRate}, Au=${data.metals?.gold || 'N/A'}, Ag=${data.metals?.silver || 'N/A'}`);
            });
        }
        
    } catch (error) {
        console.error('❌ Критическая ошибка:', error);
    } finally {
        await service.close();
    }
}

// Запускаем загрузку
loadHistoricalMetalsPrices();

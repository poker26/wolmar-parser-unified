const CollectionPriceService = require('./collection-price-service');

async function testRecalculateLotPredictions() {
    const service = new CollectionPriceService();
    
    try {
        console.log('🔧 Инициализируем сервис...');
        await service.init();
        
        // Тестируем с реальными ID лотов из избранного
        const lotIds = [90224, 63217, 63219]; // Примеры ID лотов
        
        console.log('🧪 Тестируем recalculateLotPredictions с лотами:', lotIds);
        
        const result = await service.recalculateLotPredictions(lotIds);
        
        console.log('✅ Результат тестирования:', result);
        
    } catch (error) {
        console.error('❌ Ошибка тестирования:', error);
    } finally {
        await service.close();
    }
}

testRecalculateLotPredictions();

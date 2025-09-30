/**
 * Тестирование метода recalculateUserCollectionPrices
 */

const CollectionPriceService = require('./collection-price-service');

async function testRecalculate() {
    console.log('🧪 Тестируем recalculateUserCollectionPrices...');
    
    try {
        const service = new CollectionPriceService();
        await service.init();
        
        // Тестируем пересчет для пользователя 4
        const result = await service.recalculateUserCollectionPrices(4);
        
        console.log('📊 Результат пересчета:', result);
        
    } catch (error) {
        console.error('❌ Ошибка тестирования:', error);
    }
}

testRecalculate();

/**
 * Тестирование полного процесса прогнозирования
 */

const CollectionPriceService = require('./collection-price-service');

async function testFullPrediction() {
    console.log('🧪 Тестируем полный процесс прогнозирования...');
    
    try {
        const service = new CollectionPriceService();
        await service.init();
        
        // Тестовые данные монеты из каталога
        const coin = {
            id: 9175,
            coin_name: '15 рублей. РОСС',
            denomination: '15',
            year: 1897,
            metal: 'AU',
            condition: 'XF',
            coin_weight: 12.9,
            pure_metal_weight: 11.61,
            mint: 'АГ',
            original_description: '15 рублей. РОСС. NGS русский 1897г. АГ. Au.'
        };
        
        console.log('📋 Исходные данные монеты:', coin);
        
        // Адаптируем данные
        const adaptedData = service.adaptCoinDataForPrediction(coin, 'MS63');
        
        console.log('🔧 Адаптированные данные:', adaptedData);
        
        // Получаем прогноз
        const prediction = await service.predictPrice(adaptedData);
        
        console.log('📊 Результат прогнозирования:', prediction);
        
        if (prediction.predictedPrice) {
            console.log(`✅ Прогнозная цена: ${prediction.predictedPrice.toLocaleString()}₽`);
        } else {
            console.log('❌ Прогнозная цена не рассчитана');
        }
        
    } catch (error) {
        console.error('❌ Ошибка тестирования:', error);
    }
}

testFullPrediction();

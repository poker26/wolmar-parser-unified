/**
 * Тестирование адаптированных данных для ImprovedPredictionsGenerator
 */

const CollectionPriceService = require('./collection-price-service');

async function testAdaptedData() {
    console.log('🧪 Тестируем адаптированные данные...');
    
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
        
        // Проверяем, что все обязательные поля присутствуют
        const requiredFields = ['id', 'lot_number', 'auction_number', 'metal', 'condition', 'weight', 'year'];
        const missingFields = requiredFields.filter(field => !adaptedData[field]);
        
        if (missingFields.length > 0) {
            console.log('❌ Отсутствуют обязательные поля:', missingFields);
        } else {
            console.log('✅ Все обязательные поля присутствуют');
        }
        
    } catch (error) {
        console.error('❌ Ошибка тестирования:', error);
    }
}

testAdaptedData();

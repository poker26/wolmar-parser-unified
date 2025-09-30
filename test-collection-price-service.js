/**
 * Тестирование обновленного CollectionPriceService с ImprovedPredictionsGenerator
 */

const CollectionPriceService = require('./collection-price-service');

async function testCollectionPriceService() {
    console.log('🧪 Тестируем обновленный CollectionPriceService...');
    
    try {
        const service = new CollectionPriceService();
        await service.init();
        
        // Тестовые данные для монеты 15 рублей 1897 года (лот 6 аукциона 969)
        const testLot = {
            id: 63219, // ID лота 6 аукциона 969
            lot_number: '6',
            auction_number: '969',
            condition: 'MS63',
            metal: 'Au',
            weight: 12.9,
            year: 1897,
            letters: 'АГ',
            coin_description: '15 рублей. РОСС. NGS русский 1897г. АГ. Au. | В слабе NGS. Санкт-Петербургский монетный двор. Биткин №# 934.2, тираж 11 900 033, "три последние буквы заходят за обрез шеи", Уздеников редкость - "точка", №# 0322; Казаков редкость R для сохранности XF, Unc, №# 63, рейтинг 4. Нормативная проба - Au`900, нормативный вес - 12,90 гр, чистого золота - 11,61 гр. Wolmar # 4/3'
        };
        
        console.log('📋 Тестовые данные:', testLot);
        
        // Получаем прогноз
        const prediction = await service.predictPrice(testLot);
        
        console.log('\n📊 Результат прогнозирования:');
        console.log(`  predictedPrice: ${prediction.predictedPrice}`);
        console.log(`  metalValue: ${prediction.metalValue}`);
        console.log(`  numismaticPremium: ${prediction.numismaticPremium}`);
        console.log(`  conditionMultiplier: ${prediction.conditionMultiplier}`);
        console.log(`  confidence: ${prediction.confidence}`);
        console.log(`  method: ${prediction.method}`);
        
        // Сравниваем с ожидаемым результатом (231,802₽)
        const expectedPrice = 231802;
        const difference = Math.abs(prediction.predictedPrice - expectedPrice);
        const accuracy = ((1 - difference / expectedPrice) * 100).toFixed(1);
        
        console.log(`\n🎯 Сравнение с ожидаемым результатом:`);
        console.log(`  Ожидаемая цена: ${expectedPrice}₽`);
        console.log(`  Полученная цена: ${prediction.predictedPrice}₽`);
        console.log(`  Разница: ${difference}₽`);
        console.log(`  Точность: ${accuracy}%`);
        
        if (difference < 1000) {
            console.log('✅ Результат близок к ожидаемому!');
        } else {
            console.log('⚠️ Результат отличается от ожидаемого');
        }
        
    } catch (error) {
        console.error('❌ Ошибка тестирования:', error);
    }
}

testCollectionPriceService();

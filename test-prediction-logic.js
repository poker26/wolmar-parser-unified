const RobustPredictionsGenerator = require('./robust-predictions-generator');

async function testPredictionLogic() {
    const generator = new RobustPredictionsGenerator();
    try {
        await generator.init();
        
        // Тестируем лот 9
        const testLot = {
            id: 57505,
            lot_number: '9',
            condition: 'MS61',
            metal: 'Au',
            year: '1897',
            letters: 'АГ',
            coin_description: '15 рублей. СС 1897г. АГ. Au. R | В слабе NRG.',
            auction_number: '968',
            weight: null
        };
        
        console.log('🧪 Тестируем логику прогнозирования для лота 9...');
        console.log(`📋 Параметры: ${testLot.condition}, ${testLot.metal}, ${testLot.year}, ${testLot.letters}`);
        
        const prediction = await generator.predictPrice(testLot);
        
        console.log('\n📊 Результат прогнозирования:');
        console.log(`  predicted_price (raw): ${prediction.predicted_price}`);
        console.log(`  predicted_price (type): ${typeof prediction.predicted_price}`);
        console.log(`  predicted_price (isNaN): ${isNaN(prediction.predicted_price)}`);
        console.log(`  predicted_price (isFinite): ${isFinite(prediction.predicted_price)}`);
        
        const price = (prediction.predicted_price && !isNaN(parseFloat(prediction.predicted_price))) ? parseFloat(prediction.predicted_price).toFixed(2) + '₽' : 'Нет';
        console.log(`  Прогноз: ${price}`);
        console.log(`  Метод: ${prediction.prediction_method}`);
        console.log(`  Размер выборки: ${prediction.sample_size}`);
        console.log(`  Уверенность: ${(prediction.confidence_score * 100).toFixed(1)}%`);
        console.log(`  Стоимость металла: ${prediction.metal_value.toFixed(2)}₽`);
        console.log(`  Нумизматическая премия: ${prediction.numismatic_premium ? prediction.numismatic_premium.toFixed(2) + '₽' : 'N/A'}`);
        
    } catch (error) {
        console.error('❌ Ошибка тестирования:', error);
    } finally {
        await generator.close();
    }
}

testPredictionLogic();

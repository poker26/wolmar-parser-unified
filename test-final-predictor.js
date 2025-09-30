/**
 * Тестирование FinalPricePredictor с теми же данными, что и в продакшн коде
 */

const FinalPricePredictor = require('./final-price-predictor');

async function testFinalPredictor() {
    console.log('🧪 Тестируем FinalPricePredictor...');
    
    try {
        // Создаем экземпляр предиктора
        const predictor = new FinalPricePredictor();
        await predictor.init();
        await predictor.calibrateModel();
        
        console.log('✅ FinalPricePredictor инициализирован');
        
        // Тестовые данные для монеты 15 рублей 1897 года
        const testLot = {
            metal: 'Au',
            weight: 12.9,
            condition: 'MS63',
            year: 1897,
            letters: 'АР',
            coin_description: '15 рублей 1897 года'
        };
        
        console.log('📋 Тестовые данные:', testLot);
        
        // Получаем прогноз
        const prediction = await predictor.predictPrice(testLot);
        
        console.log('\n📊 Результат прогнозирования:');
        console.log(`  predictedPrice: ${prediction.predictedPrice}`);
        console.log(`  metalValue: ${prediction.metalValue}`);
        console.log(`  numismaticPremium: ${prediction.numismaticPremium}`);
        console.log(`  conditionMultiplier: ${prediction.conditionMultiplier}`);
        console.log(`  confidence: ${prediction.confidence}`);
        console.log(`  method: ${prediction.method}`);
        
        // Проверяем калибровочную таблицу
        console.log('\n🔍 Калибровочная таблица:');
        const calibrationKey = `${testLot.condition}_${testLot.metal}`;
        console.log(`  Ключ калибровки: ${calibrationKey}`);
        console.log(`  Калибровка:`, predictor.calibrationTable[calibrationKey]);
        
        // Проверяем все доступные калибровки
        console.log('\n📈 Все доступные калибровки:');
        Object.keys(predictor.calibrationTable).forEach(key => {
            const cal = predictor.calibrationTable[key];
            console.log(`  ${key}: sampleSize=${cal.sampleSize}, medianPrice=${cal.medianPrice}`);
        });
        
    } catch (error) {
        console.error('❌ Ошибка тестирования:', error);
    }
}

testFinalPredictor();

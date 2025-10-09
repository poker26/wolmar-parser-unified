const ImprovedPredictionsGenerator = require('./improved-predictions-generator');

async function testPlatinumPredictionFix() {
    console.log('🧪 Тестируем исправленную логику поиска для платиновых монет\n');
    
    const generator = new ImprovedPredictionsGenerator();
    
    try {
        await generator.init();
        console.log('✅ Генератор инициализирован\n');
        
        // Тестовые платиновые монеты 3 рубля 1830 года
        const testLots = [
            {
                id: 54645,
                lot_number: '2',
                auction_number: 967,
                coin_description: '3 рубля 1830г. СПБ. Pt 10,32. R Ильин - 10 рублей',
                metal: 'Pt',
                weight: 10.32,
                condition: 'AU',
                year: 1830,
                letters: 'СПБ'
            },
            {
                id: 6205,
                lot_number: '2',
                auction_number: 963,
                coin_description: '3 рубля 1830г. СПБ. Pt. R Ильин - 10 рублей',
                metal: 'Pt',
                weight: null,
                condition: 'AUDet.',
                year: 1830,
                letters: 'СПБ'
            },
            {
                id: 57491,
                lot_number: '2',
                auction_number: 968,
                coin_description: '3 рубля. NGS русский 1830г. СПБ. Pt. R Ильин - 10 рублей',
                metal: 'Pt',
                weight: null,
                condition: 'VF30',
                year: 1830,
                letters: 'СПБ'
            }
        ];
        
        console.log('📊 Тестируем прогнозы для платиновых монет 3 рубля 1830 года:\n');
        
        for (const lot of testLots) {
            console.log(`🔍 Тестируем лот: ${lot.lot_number} (состояние: ${lot.condition})`);
            console.log(`   - Описание: ${lot.coin_description}`);
            console.log(`   - Вес: ${lot.weight ? lot.weight + 'г' : 'не указан'}`);
            console.log(`   - Реальная цена: ${lot.winning_bid || 'не указана'}₽`);
            
            try {
                const prediction = await generator.predictPrice(lot);
                
                console.log(`   📈 Результат прогноза:`);
                console.log(`      - Прогнозная цена: ${prediction.predicted_price ? prediction.predicted_price + '₽' : 'не рассчитана'}`);
                console.log(`      - Стоимость металла: ${prediction.metal_value ? prediction.metal_value.toFixed(2) + '₽' : 'не рассчитана'}`);
                console.log(`      - Нумизматическая наценка: ${prediction.numismatic_premium ? prediction.numismatic_premium + '₽' : 'не рассчитана'}`);
                console.log(`      - Уверенность: ${(prediction.confidence_score * 100).toFixed(1)}%`);
                console.log(`      - Метод: ${prediction.prediction_method}`);
                console.log(`      - Размер выборки: ${prediction.sample_size}`);
                
                if (prediction.sample_size > 0) {
                    console.log(`      ✅ Аналоги найдены! Система работает корректно`);
                    
                    // Анализ точности
                    if (lot.winning_bid && prediction.predicted_price) {
                        const accuracy = Math.abs(prediction.predicted_price - lot.winning_bid) / lot.winning_bid * 100;
                        console.log(`      📊 Точность прогноза: ${(100 - accuracy).toFixed(1)}%`);
                        
                        if (accuracy < 20) {
                            console.log(`      ✅ Высокая точность прогноза`);
                        } else if (accuracy < 50) {
                            console.log(`      ⚠️ Средняя точность прогноза`);
                        } else {
                            console.log(`      ❌ Низкая точность прогноза`);
                        }
                    }
                } else {
                    console.log(`      ❌ Аналоги не найдены`);
                }
                
            } catch (error) {
                console.error(`      ❌ Ошибка прогноза:`, error.message);
            }
            
            console.log('');
        }
        
        // Дополнительный тест: проверим поиск аналогичных лотов напрямую
        console.log('🔍 Дополнительный тест: проверяем поиск аналогичных лотов напрямую\n');
        
        const testLot = testLots[0]; // Берем первый лот
        console.log(`🔍 Тестируем поиск аналогичных лотов для лота ${testLot.lot_number} (состояние: ${testLot.condition})`);
        
        try {
            const similarLots = await generator.findSimilarLots(testLot);
            console.log(`📋 Найдено ${similarLots.length} аналогичных лотов:`);
            
            similarLots.forEach((similarLot, index) => {
                console.log(`   ${index + 1}. Лот ${similarLot.lot_number} (аукцион ${similarLot.auction_number}):`);
                console.log(`      - Состояние: ${similarLot.condition}`);
                console.log(`      - Цена: ${similarLot.winning_bid}₽`);
                console.log(`      - Описание: ${similarLot.coin_description.substring(0, 80)}...`);
            });
            
            if (similarLots.length > 0) {
                console.log(`\n✅ Исправление работает! Система теперь находит аналоги для платиновых монет`);
            } else {
                console.log(`\n❌ Проблема не решена, аналоги по-прежнему не найдены`);
            }
            
        } catch (error) {
            console.error(`❌ Ошибка поиска аналогичных лотов:`, error.message);
        }
        
    } catch (error) {
        console.error('❌ Критическая ошибка:', error);
    } finally {
        await generator.close();
    }
}

// Запускаем тест
testPlatinumPredictionFix();

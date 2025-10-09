const { Pool } = require('pg');
const config = require('./config.js');
const ImprovedPredictionsGenerator = require('./improved-predictions-generator.js');

async function debugLot3374() {
    const pool = new Pool(config.dbConfig);
    
    try {
        console.log('🔍 Отладка лота 3374...');
        
        // Получаем данные лота 3374
        const lotResult = await pool.query(`
            SELECT id, lot_number, auction_number, coin_description, metal, condition, year, weight, letters, winning_bid
            FROM auction_lots 
            WHERE lot_number = '3374' AND auction_number = '970'
        `);
        
        if (lotResult.rows.length === 0) {
            console.log('❌ Лот 3374 не найден');
            return;
        }
        
        const lot = lotResult.rows[0];
        console.log('📋 Данные лота 3374:', lot);
        
        // Инициализируем генератор
        const generator = new ImprovedPredictionsGenerator();
        await generator.init();
        
        try {
            // Адаптируем данные как в collection-price-service
            const adaptedData = {
                id: lot.id,
                lot_number: lot.lot_number,
                auction_number: lot.auction_number,
                metal: lot.metal,
                condition: lot.condition,
                weight: lot.weight,
                year: lot.year,
                letters: lot.letters,
                coin_description: lot.coin_description
            };
            
            console.log('🔧 Адаптированные данные:', adaptedData);
            
            // Тестируем поиск аналогичных лотов
            console.log('🔍 Тестируем поиск аналогичных лотов...');
            const similarLots = await generator.findSimilarLots(adaptedData);
            console.log(`📊 Найдено аналогичных лотов: ${similarLots.length}`);
            
            if (similarLots.length > 0) {
                console.log('📋 Аналогичные лоты:');
                similarLots.forEach((similar, index) => {
                    console.log(`  ${index + 1}. Лот ${similar.lot_number} (аукцион ${similar.auction_number}): ${similar.winning_bid}₽`);
                });
            }
            
            // Тестируем полный прогноз
            console.log('🔮 Тестируем полный прогноз...');
            const prediction = await generator.predictPrice(adaptedData);
            console.log('📈 Результат прогноза:', prediction);
            
        } finally {
            await generator.close();
        }
        
    } catch (error) {
        console.error('❌ Ошибка:', error);
    } finally {
        await pool.end();
    }
}

debugLot3374();

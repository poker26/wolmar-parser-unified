const { Pool } = require('pg');
const config = require('./config.js');
const CollectionPriceService = require('./collection-price-service.js');

async function testLot3374Prediction() {
    const pool = new Pool(config.dbConfig);
    
    try {
        console.log('🔧 Инициализируем сервис...');
        const collectionPriceService = new CollectionPriceService(pool);
        await collectionPriceService.init();
        
        // Тестируем с правильным ID лота 3374
        const lot3374Id = 93482;
        
        console.log(`🧪 Тестируем пересчет прогноза для лота 3374 (ID: ${lot3374Id})`);
        
        // Получаем информацию о лоте
        const lotResult = await pool.query(`
            SELECT id, lot_number, auction_number, coin_description, metal, condition, year, weight, letters, winning_bid
            FROM auction_lots 
            WHERE id = $1
        `, [lot3374Id]);
        
        if (lotResult.rows.length === 0) {
            console.log('❌ Лот не найден');
            return;
        }
        
        const lot = lotResult.rows[0];
        console.log('📋 Данные лота:', {
            lot_number: lot.lot_number,
            auction_number: lot.auction_number,
            metal: lot.metal,
            condition: lot.condition,
            year: lot.year,
            winning_bid: lot.winning_bid
        });
        
        // Тестируем пересчет прогнозов
        console.log('🔄 Начинаем пересчет прогнозной цены...');
        const result = await collectionPriceService.recalculateLotPredictions([lot3374Id]);
        
        console.log('📊 Результат пересчета:');
        console.log(`✅ Обновлено: ${result.updated} лотов`);
        console.log(`❌ Ошибок: ${result.errors}`);
        
        // Проверяем результат в базе
        console.log('🔍 Проверяем результат в базе данных...');
        const predictionResult = await pool.query(`
            SELECT 
                lpp.lot_id,
                al.lot_number,
                al.auction_number,
                lpp.predicted_price,
                lpp.confidence_score,
                lpp.prediction_method,
                lpp.created_at
            FROM lot_price_predictions lpp
            JOIN auction_lots al ON lpp.lot_id = al.id
            WHERE lpp.lot_id = $1
        `, [lot3374Id]);
        
        if (predictionResult.rows.length > 0) {
            const pred = predictionResult.rows[0];
            const price = pred.predicted_price ? parseFloat(pred.predicted_price).toLocaleString() + '₽' : 'null';
            const confidence = pred.confidence_score ? (pred.confidence_score * 100).toFixed(0) + '%' : '0%';
            const method = pred.prediction_method || 'неизвестно';
            const date = pred.created_at ? new Date(pred.created_at).toLocaleString('ru-RU') : 'не указана';
            
            console.log(`📈 Прогноз для лота ${pred.lot_number}: ${price} (${method}, ${confidence}) - ${date}`);
        } else {
            console.log('❌ Прогноз не найден в базе данных');
        }
        
    } catch (error) {
        console.error('❌ Ошибка:', error);
    } finally {
        await pool.end();
    }
}

testLot3374Prediction();

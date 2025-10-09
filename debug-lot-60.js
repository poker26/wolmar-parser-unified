const { Pool } = require('pg');
const config = require('./config.js');
const CollectionPriceService = require('./collection-price-service.js');

async function debugLot60() {
    const pool = new Pool(config.dbConfig);
    
    try {
        console.log('🔍 Отладка лота 60...');
        
        // Получаем данные лота 60
        const lotResult = await pool.query(`
            SELECT id, lot_number, auction_number, coin_description, metal, condition, year, weight, letters, winning_bid
            FROM auction_lots 
            WHERE lot_number = '60' AND auction_number = '970'
        `);
        
        if (lotResult.rows.length === 0) {
            console.log('❌ Лот 60 не найден в базе данных');
            return;
        }
        
        const lot = lotResult.rows[0];
        console.log('📋 Данные лота 60:', {
            id: lot.id,
            lot_number: lot.lot_number,
            auction_number: lot.auction_number,
            metal: lot.metal,
            condition: lot.condition,
            year: lot.year,
            weight: lot.weight,
            winning_bid: lot.winning_bid,
            description: lot.coin_description?.substring(0, 100) + '...'
        });
        
        // Инициализируем сервис
        console.log('🔧 Инициализируем сервис...');
        const collectionPriceService = new CollectionPriceService(pool);
        await collectionPriceService.init();
        
        // Тестируем пересчет прогнозов
        console.log('🔄 Тестируем пересчет прогнозной цены...');
        const result = await collectionPriceService.recalculateLotPredictions([lot.id]);
        
        console.log('📊 Результат пересчета:');
        console.log(`✅ Обновлено: ${result.updated} лотов`);
        console.log(`❌ Ошибок: ${result.errors}`);
        
        // Проверяем результат в базе
        console.log('🔍 Проверяем результат в базе данных...');
        const predictionResult = await pool.query(`
            SELECT 
                lpp.predicted_price,
                lpp.confidence_score,
                lpp.prediction_method,
                lpp.created_at
            FROM lot_price_predictions lpp
            WHERE lpp.lot_id = $1
        `, [lot.id]);
        
        if (predictionResult.rows.length > 0) {
            const pred = predictionResult.rows[0];
            const price = pred.predicted_price ? parseFloat(pred.predicted_price).toLocaleString() + '₽' : 'null';
            const confidence = pred.confidence_score ? (pred.confidence_score * 100).toFixed(0) + '%' : '0%';
            const method = pred.prediction_method || 'неизвестно';
            const date = pred.created_at ? new Date(pred.created_at).toLocaleString('ru-RU') : 'не указана';
            
            console.log(`📈 Прогноз для лота 60: ${price} (${method}, ${confidence}) - ${date}`);
        } else {
            console.log('❌ Прогноз не найден в базе данных');
        }
        
    } catch (error) {
        console.error('❌ Ошибка:', error);
    } finally {
        await pool.end();
    }
}

debugLot60();

/**
 * Проверяем, есть ли уже рассчитанный прогноз для лота 6 аукциона 969
 */

const { Pool } = require('pg');
const config = require('./config');

async function checkLot6Prediction() {
    const pool = new Pool(config.dbConfig);
    
    try {
        console.log('🔍 Ищем лот 6 аукциона 969...');
        
        // Ищем лот 6 в аукционе 969
        const lotQuery = `
            SELECT 
                al.id,
                al.lot_number,
                al.condition,
                al.metal,
                al.weight,
                al.year,
                al.letters,
                al.winning_bid,
                al.coin_description,
                al.auction_number
            FROM auction_lots al
            WHERE al.auction_number = '969' AND al.lot_number = '6'
        `;
        
        const lotResult = await pool.query(lotQuery);
        
        if (lotResult.rows.length === 0) {
            console.log('❌ Лот 6 аукциона 969 не найден');
            return;
        }
        
        const lot = lotResult.rows[0];
        console.log('✅ Найден лот:', lot);
        
        // Ищем прогноз для этого лота
        const predictionQuery = `
            SELECT 
                lpp.predicted_price,
                lpp.metal_value,
                lpp.numismatic_premium,
                lpp.confidence_score,
                lpp.prediction_method,
                lpp.sample_size,
                lpp.created_at
            FROM lot_price_predictions lpp
            WHERE lpp.lot_id = $1
        `;
        
        const predictionResult = await pool.query(predictionQuery, [lot.id]);
        
        if (predictionResult.rows.length === 0) {
            console.log('❌ Прогноз для лота 6 не найден');
            console.log('📋 Данные лота для расчета:');
            console.log(`  ID: ${lot.id}`);
            console.log(`  Лот: ${lot.lot_number}`);
            console.log(`  Состояние: ${lot.condition}`);
            console.log(`  Металл: ${lot.metal}`);
            console.log(`  Вес: ${lot.weight}г`);
            console.log(`  Год: ${lot.year}`);
            console.log(`  Буквы: ${lot.letters}`);
            console.log(`  Описание: ${lot.coin_description}`);
            console.log(`  Фактическая цена: ${lot.winning_bid}₽`);
        } else {
            const prediction = predictionResult.rows[0];
            console.log('✅ Найден прогноз для лота 6:');
            console.log(`  Прогнозная цена: ${prediction.predicted_price}₽`);
            console.log(`  Стоимость металла: ${prediction.metal_value}₽`);
            console.log(`  Нумизматическая премия: ${prediction.numismatic_premium}₽`);
            console.log(`  Уверенность: ${(prediction.confidence_score * 100).toFixed(1)}%`);
            console.log(`  Метод: ${prediction.prediction_method}`);
            console.log(`  Размер выборки: ${prediction.sample_size}`);
            console.log(`  Создан: ${prediction.created_at}`);
        }
        
    } catch (error) {
        console.error('❌ Ошибка:', error);
    } finally {
        await pool.end();
    }
}

checkLot6Prediction();

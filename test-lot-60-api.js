const { Pool } = require('pg');
const config = require('./config.js');

async function testLot60API() {
    const pool = new Pool(config.dbConfig);
    
    try {
        console.log('🔍 Тестируем API для лота 60...');
        
        // Получаем ID лота 60
        const lotResult = await pool.query(`
            SELECT id FROM auction_lots 
            WHERE lot_number = '60' AND auction_number = '970'
        `);
        
        if (lotResult.rows.length === 0) {
            console.log('❌ Лот 60 не найден');
            return;
        }
        
        const lotId = lotResult.rows[0].id;
        console.log('📋 ID лота 60:', lotId);
        
        // Тестируем API endpoint /api/prediction/:lotId
        console.log('🔍 Тестируем API /api/prediction/:lotId...');
        
        const predictionResult = await pool.query(`
            SELECT 
                lpp.predicted_price,
                lpp.confidence_score,
                lpp.prediction_method,
                lpp.metal_value,
                lpp.numismatic_premium,
                lpp.sample_size,
                lpp.created_at
            FROM lot_price_predictions lpp
            WHERE lpp.lot_id = $1
        `, [lotId]);
        
        if (predictionResult.rows.length > 0) {
            const pred = predictionResult.rows[0];
            console.log('📈 Данные прогноза из базы:');
            console.log({
                predicted_price: pred.predicted_price,
                confidence_score: pred.confidence_score,
                prediction_method: pred.prediction_method,
                metal_value: pred.metal_value,
                numismatic_premium: pred.numismatic_premium,
                sample_size: pred.sample_size,
                created_at: pred.created_at
            });
            
            // Симулируем ответ API
            const apiResponse = {
                success: true,
                prediction: {
                    predictedPrice: pred.predicted_price,
                    confidence: pred.confidence_score,
                    method: pred.prediction_method,
                    metalValue: pred.metal_value,
                    numismaticPremium: pred.numismatic_premium,
                    sampleSize: pred.sample_size,
                    createdAt: pred.created_at
                }
            };
            
            console.log('📤 Ответ API (симуляция):');
            console.log(JSON.stringify(apiResponse, null, 2));
            
        } else {
            console.log('❌ Прогноз не найден в базе данных');
        }
        
    } catch (error) {
        console.error('❌ Ошибка:', error);
    } finally {
        await pool.end();
    }
}

testLot60API();

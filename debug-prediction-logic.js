const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool(config.dbConfig);

async function debugPredictionLogic() {
    try {
        console.log('🔍 Отладка логики прогнозирования...\n');
        
        // Проверим несколько лотов с противоречивыми данными
        const query = `
            SELECT 
                al.lot_number,
                al.coin_description,
                al.condition,
                al.metal,
                al.year,
                al.letters,
                lpp.predicted_price,
                lpp.prediction_method,
                lpp.sample_size,
                lpp.confidence_score
            FROM auction_lots al
            LEFT JOIN lot_price_predictions lpp ON al.id = lpp.lot_id
            WHERE al.auction_number = '968'
                AND lpp.sample_size > 0
                AND lpp.prediction_method = 'no_similar_lots'
            ORDER BY lpp.sample_size DESC
            LIMIT 5
        `;
        
        const result = await pool.query(query);
        
        console.log('📊 Лоты с противоречивыми данными:');
        result.rows.forEach(row => {
            console.log(`\nЛот ${row.lot_number}:`);
            console.log(`  Описание: ${row.coin_description.substring(0, 60)}...`);
            console.log(`  Параметры: ${row.condition}, ${row.metal}, ${row.year}, ${row.letters}`);
            const price = (row.predicted_price && typeof row.predicted_price === 'number') ? row.predicted_price.toFixed(2) + '₽' : 'Нет';
            console.log(`  Прогноз: ${price}`);
            console.log(`  Метод: ${row.prediction_method}`);
            console.log(`  Размер выборки: ${row.sample_size}`);
            console.log(`  Уверенность: ${row.confidence_score ? (row.confidence_score * 100).toFixed(1) + '%' : 'N/A'}`);
        });
        
        // Теперь проверим, что происходит в алгоритме поиска аналогов
        console.log('\n🔍 Проверяем алгоритм поиска аналогов для лота 9...');
        
        const testLotQuery = `
            SELECT id, lot_number, condition, metal, year, letters, coin_description, auction_number
            FROM auction_lots 
            WHERE auction_number = '968' AND lot_number = '9'
        `;
        
        const testLotResult = await pool.query(testLotQuery);
        if (testLotResult.rows.length === 0) {
            console.log('❌ Лот 9 не найден');
            return;
        }
        
        const lot = testLotResult.rows[0];
        console.log(`\n📋 Тестируем лот ${lot.lot_number}:`);
        console.log(`  Параметры: ${lot.condition}, ${lot.metal}, ${lot.year}, ${lot.letters}`);
        
        // Извлекаем номинал
        const denominationMatch = lot.coin_description.match(/(\d+)\s*рублей?/i);
        const currentDenomination = denominationMatch ? denominationMatch[1] : null;
        console.log(`  Номинал: ${currentDenomination || 'Не найден'}`);
        
        // Ищем аналогичные лоты
        let similarQuery = `
            SELECT 
                id, lot_number, auction_number, winning_bid, coin_description, auction_end_date
            FROM auction_lots 
            WHERE condition = $1 
                AND metal = $2 
                AND year = $3 
                AND letters = $4
                AND winning_bid IS NOT NULL 
                AND winning_bid > 0
                AND id != $5
                AND auction_number != $6
        `;
        
        const params = [lot.condition, lot.metal, lot.year, lot.letters, lot.id, lot.auction_number];
        
        if (currentDenomination) {
            similarQuery += ` AND coin_description ~ $${params.length + 1}`;
            params.push(`\\m${currentDenomination}\\s*рублей?\\M`);
        }
        
        similarQuery += ` ORDER BY auction_end_date DESC`;
        
        console.log(`\n🔍 SQL запрос для поиска аналогов:`);
        console.log(similarQuery);
        console.log(`📊 Параметры: [${params.join(', ')}]`);
        
        const similarResult = await pool.query(similarQuery, params);
        const similarLots = similarResult.rows;
        
        console.log(`\n✅ Найдено аналогичных лотов: ${similarLots.length}`);
        
        if (similarLots.length > 0) {
            console.log('\n📈 Первые 3 аналога:');
            similarLots.slice(0, 3).forEach(sLot => {
                console.log(`  - Лот ${sLot.lot_number} (Аукцион ${sLot.auction_number}): ${sLot.winning_bid.toFixed(2)}₽`);
            });
        }
        
    } catch (error) {
        console.error('❌ Ошибка отладки:', error);
    } finally {
        await pool.end();
    }
}

debugPredictionLogic();

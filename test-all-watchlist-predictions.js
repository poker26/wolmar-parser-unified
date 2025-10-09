const { Pool } = require('pg');
const config = require('./config.js');
const CollectionPriceService = require('./collection-price-service.js');

async function testAllWatchlistPredictions() {
    const pool = new Pool(config.dbConfig);
    
    try {
        console.log('🔧 Инициализируем сервис...');
        const collectionPriceService = new CollectionPriceService(pool);
        await collectionPriceService.init();
        
        // Получаем все лоты из избранного (используем реальные ID из предыдущих тестов)
        const watchlistLotIds = [90224, 63217, 63219, 63220, 63221, 63222, 63223, 63224, 63225, 63226];
        
        console.log(`🧪 Тестируем пересчет прогнозов для ${watchlistLotIds.length} лотов из избранного`);
        console.log('📋 ID лотов:', watchlistLotIds);
        
        // Получаем информацию о лотах
        const lotsResult = await pool.query(`
            SELECT id, lot_number, auction_number, coin_description, metal, condition, year, weight, winning_bid
            FROM auction_lots 
            WHERE id = ANY($1)
            ORDER BY id
        `, [watchlistLotIds]);
        
        console.log(`📚 Найдено в базе: ${lotsResult.rows.length} лотов`);
        
        // Показываем информацию о каждом лоте
        lotsResult.rows.forEach((lot, index) => {
            console.log(`\n${index + 1}. Лот ${lot.lot_number} (аукцион ${lot.auction_number}):`);
            console.log(`   Металл: ${lot.metal}, Состояние: ${lot.condition}, Год: ${lot.year}`);
            console.log(`   Вес: ${lot.weight || 'не указан'}`);
            console.log(`   Текущая ставка: ${lot.winning_bid ? parseFloat(lot.winning_bid).toLocaleString() + '₽' : 'не указана'}`);
            console.log(`   Описание: ${lot.coin_description?.substring(0, 100)}...`);
        });
        
        // Тестируем пересчет прогнозов
        console.log('\n🔄 Начинаем пересчет прогнозных цен...');
        const result = await collectionPriceService.recalculateLotPredictions(watchlistLotIds);
        
        console.log('\n📊 Результат пересчета:');
        console.log(`✅ Обновлено: ${result.updated} лотов`);
        console.log(`❌ Ошибок: ${result.errors}`);
        
        // Проверяем результаты в базе
        console.log('\n🔍 Проверяем результаты в базе данных...');
        const predictionsResult = await pool.query(`
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
            WHERE lpp.lot_id = ANY($1)
            ORDER BY lpp.lot_id
        `, [watchlistLotIds]);
        
        console.log(`📈 Найдено прогнозов: ${predictionsResult.rows.length}`);
        predictionsResult.rows.forEach(pred => {
            const price = pred.predicted_price ? parseFloat(pred.predicted_price).toLocaleString() + '₽' : 'null';
            const confidence = pred.confidence_score ? (pred.confidence_score * 100).toFixed(0) + '%' : '0%';
            const method = pred.prediction_method || 'неизвестно';
            const date = pred.created_at ? new Date(pred.created_at).toLocaleString('ru-RU') : 'не указана';
            
            console.log(`   Лот ${pred.lot_number}: ${price} (${method}, ${confidence}) - ${date}`);
        });
        
    } catch (error) {
        console.error('❌ Ошибка:', error);
    } finally {
        await pool.end();
    }
}

testAllWatchlistPredictions();

const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool(config.dbConfig);

async function clearPredictionsForAuction(auctionNumber) {
    try {
        console.log(`🧹 Очищаем прогнозы для аукциона ${auctionNumber}...`);
        
        // Получаем ID всех лотов аукциона
        const lotsQuery = `
            SELECT id FROM auction_lots WHERE auction_number = $1
        `;
        const lotsResult = await pool.query(lotsQuery, [auctionNumber]);
        const lotIds = lotsResult.rows.map(row => row.id);
        
        if (lotIds.length === 0) {
            console.log('❌ Лоты не найдены');
            return;
        }
        
        console.log(`📋 Найдено ${lotIds.length} лотов`);
        
        // Удаляем прогнозы для этих лотов
        const deleteQuery = `
            DELETE FROM lot_price_predictions 
            WHERE lot_id = ANY($1)
        `;
        
        const deleteResult = await pool.query(deleteQuery, [lotIds]);
        console.log(`✅ Удалено ${deleteResult.rowCount} прогнозов`);
        
    } catch (error) {
        console.error('❌ Ошибка очистки прогнозов:', error);
    } finally {
        await pool.end();
    }
}

const auctionNumber = process.argv[2] || '968';
clearPredictionsForAuction(auctionNumber);

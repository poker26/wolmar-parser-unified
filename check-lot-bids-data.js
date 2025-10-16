const { Pool } = require('pg');
const config = require('./config');

async function checkLotBidsData() {
    const pool = new Pool(config.dbConfig);
    
    try {
        console.log('🔍 Проверяем данные в таблице lot_bids...');
        
        // Общее количество записей
        const totalResult = await pool.query('SELECT COUNT(*) as count FROM lot_bids');
        console.log(`📊 Общее количество ставок в БД: ${totalResult.rows[0].count}`);
        
        if (totalResult.rows[0].count === '0') {
            console.log('❌ Таблица lot_bids пуста!');
            
            // Проверяем, есть ли лоты в избранном
            const watchlistResult = await pool.query(`
                SELECT COUNT(*) as count 
                FROM watchlist w
                JOIN auction_lots al ON w.lot_id = al.id
                WHERE al.source_url IS NOT NULL
            `);
            console.log(`📊 Лотов в избранном с URL: ${watchlistResult.rows[0].count}`);
            
            if (watchlistResult.rows[0].count > 0) {
                console.log('💡 Есть лоты в избранном, но нет ставок. Нужно запустить обновление!');
                
                // Показываем примеры лотов
                const sampleLots = await pool.query(`
                    SELECT al.id, al.lot_number, al.auction_number, al.source_url
                    FROM watchlist w
                    JOIN auction_lots al ON w.lot_id = al.id
                    WHERE al.source_url IS NOT NULL
                    LIMIT 3
                `);
                
                console.log('📋 Примеры лотов в избранном:');
                sampleLots.rows.forEach((lot, index) => {
                    console.log(`   ${index + 1}. Лот ${lot.lot_number} (ID: ${lot.id}): ${lot.source_url}`);
                });
            }
            
            return;
        }
        
        // Показываем последние ставки
        const recentBids = await pool.query(`
            SELECT 
                lb.lot_id, 
                lb.bid_amount, 
                lb.bidder_login, 
                lb.bid_timestamp, 
                lb.is_auto_bid,
                al.lot_number,
                al.auction_number
            FROM lot_bids lb
            JOIN auction_lots al ON lb.lot_id = al.id
            ORDER BY lb.bid_timestamp DESC
            LIMIT 10
        `);
        
        console.log('📊 Последние 10 ставок:');
        recentBids.rows.forEach((bid, index) => {
            const autoBid = bid.is_auto_bid ? ' (авто)' : '';
            console.log(`   ${index + 1}. Лот ${bid.lot_number}: ${bid.bid_amount}₽ от ${bid.bidder_login}${autoBid} (${bid.bid_timestamp})`);
        });
        
        // Проверяем, есть ли ставки для лотов в избранном
        const watchlistBids = await pool.query(`
            SELECT COUNT(*) as count
            FROM lot_bids lb
            JOIN watchlist w ON lb.lot_id = w.lot_id
        `);
        
        console.log(`📊 Ставок для лотов в избранном: ${watchlistBids.rows[0].count}`);
        
        if (watchlistBids.rows[0].count === '0') {
            console.log('❌ Нет ставок для лотов в избранном!');
            
            // Показываем лоты в избранном без ставок
            const lotsWithoutBids = await pool.query(`
                SELECT al.id, al.lot_number, al.auction_number
                FROM watchlist w
                JOIN auction_lots al ON w.lot_id = al.id
                LEFT JOIN lot_bids lb ON al.id = lb.lot_id
                WHERE lb.lot_id IS NULL
                LIMIT 5
            `);
            
            console.log('📋 Лоты в избранном без ставок:');
            lotsWithoutBids.rows.forEach((lot, index) => {
                console.log(`   ${index + 1}. Лот ${lot.lot_number} (ID: ${lot.id})`);
            });
        }
        
    } catch (error) {
        console.error('❌ Ошибка проверки данных:', error.message);
    } finally {
        await pool.end();
    }
}

// Запускаем проверку
if (require.main === module) {
    checkLotBidsData()
        .then(() => {
            console.log('✅ Проверка завершена');
            process.exit(0);
        })
        .catch((error) => {
            console.error('❌ Ошибка:', error.message);
            process.exit(1);
        });
}

module.exports = checkLotBidsData;

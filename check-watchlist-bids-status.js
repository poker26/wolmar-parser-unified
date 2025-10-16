const { Pool } = require('pg');
const config = require('./config');

async function checkWatchlistBidsStatus() {
    const pool = new Pool(config.dbConfig);
    
    try {
        console.log('🔍 Проверяем статус истории ставок для избранного...');
        
        // Проверяем, есть ли лоты в избранном
        const watchlistResult = await pool.query(`
            SELECT 
                w.user_id,
                al.id as lot_id,
                al.lot_number,
                al.auction_number,
                al.source_url,
                COUNT(lb.id) as bids_count
            FROM watchlist w
            JOIN auction_lots al ON w.lot_id = al.id
            LEFT JOIN lot_bids lb ON al.id = lb.lot_id
            GROUP BY w.user_id, al.id, al.lot_number, al.auction_number, al.source_url
            ORDER BY w.added_at DESC
        `);
        
        console.log(`📊 Найдено ${watchlistResult.rows.length} лотов в избранном:`);
        
        if (watchlistResult.rows.length === 0) {
            console.log('❌ Нет лотов в избранном!');
            return;
        }
        
        watchlistResult.rows.forEach((lot, index) => {
            console.log(`   ${index + 1}. Лот ${lot.lot_number} (ID: ${lot.lot_id}): ${lot.bids_count} ставок`);
            if (lot.source_url) {
                console.log(`      URL: ${lot.source_url}`);
            } else {
                console.log(`      ❌ Нет URL для парсинга!`);
            }
        });
        
        // Проверяем общее количество ставок в БД
        const totalBidsResult = await pool.query('SELECT COUNT(*) as count FROM lot_bids');
        console.log(`\n📊 Общее количество ставок в БД: ${totalBidsResult.rows[0].count}`);
        
        // Проверяем ставки для лотов из избранного
        const watchlistBidsResult = await pool.query(`
            SELECT COUNT(*) as count
            FROM lot_bids lb
            JOIN watchlist w ON lb.lot_id = w.lot_id
        `);
        console.log(`📊 Ставок для лотов из избранного: ${watchlistBidsResult.rows[0].count}`);
        
        if (watchlistBidsResult.rows[0].count === '0') {
            console.log('\n❌ Нет ставок для лотов из избранного!');
            console.log('💡 Возможные причины:');
            console.log('   1. Скрипт update-watchlist-bids.js не запустился');
            console.log('   2. Скрипт запустился, но не нашел ставки на Wolmar');
            console.log('   3. Ошибки в парсинге AJAX данных');
            console.log('   4. Проблемы с форматом данных');
            
            // Проверяем, есть ли лоты с URL для парсинга
            const lotsWithUrl = watchlistResult.rows.filter(lot => lot.source_url);
            console.log(`\n📊 Лотов с URL для парсинга: ${lotsWithUrl.length}`);
            
            if (lotsWithUrl.length > 0) {
                console.log('💡 Рекомендация: Запустите скрипт update-watchlist-bids.js вручную');
                console.log('   Команда: node update-watchlist-bids.js [USER_ID]');
            }
        } else {
            console.log('\n✅ Есть ставки для лотов из избранного!');
            
            // Показываем последние ставки
            const recentBids = await pool.query(`
                SELECT 
                    lb.lot_id,
                    lb.bid_amount,
                    lb.bidder_login,
                    lb.bid_timestamp,
                    lb.is_auto_bid,
                    al.lot_number
                FROM lot_bids lb
                JOIN auction_lots al ON lb.lot_id = al.id
                JOIN watchlist w ON lb.lot_id = w.lot_id
                ORDER BY lb.bid_timestamp DESC
                LIMIT 5
            `);
            
            console.log('📊 Последние 5 ставок для лотов из избранного:');
            recentBids.rows.forEach((bid, index) => {
                const autoBid = bid.is_auto_bid ? ' (авто)' : '';
                console.log(`   ${index + 1}. Лот ${bid.lot_number}: ${bid.bid_amount}₽ от ${bid.bidder_login}${autoBid} (${bid.bid_timestamp})`);
            });
        }
        
    } catch (error) {
        console.error('❌ Ошибка проверки статуса:', error.message);
    } finally {
        await pool.end();
    }
}

// Запускаем проверку
if (require.main === module) {
    checkWatchlistBidsStatus()
        .then(() => {
            console.log('✅ Проверка завершена');
            process.exit(0);
        })
        .catch((error) => {
            console.error('❌ Ошибка:', error.message);
            process.exit(1);
        });
}

module.exports = checkWatchlistBidsStatus;

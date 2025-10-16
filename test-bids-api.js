const { Pool } = require('pg');
const config = require('./config');

async function testBidsAPI() {
    const pool = new Pool(config.dbConfig);
    
    try {
        console.log('🔍 Тестируем API для получения истории ставок...');
        
        // Находим лот с историей ставок
        const lotWithBids = await pool.query(`
            SELECT al.id, al.lot_number, al.auction_number, COUNT(lb.id) as bids_count
            FROM auction_lots al
            LEFT JOIN lot_bids lb ON al.id = lb.lot_id
            GROUP BY al.id, al.lot_number, al.auction_number
            HAVING COUNT(lb.id) > 0
            ORDER BY COUNT(lb.id) DESC
            LIMIT 1
        `);
        
        if (lotWithBids.rows.length === 0) {
            console.log('❌ Нет лотов с историей ставок в БД');
            return;
        }
        
        const testLot = lotWithBids.rows[0];
        console.log(`📊 Тестируем API для лота ${testLot.lot_number} (ID: ${testLot.id}) с ${testLot.bids_count} ставками`);
        
        // Тестируем SQL запрос напрямую
        const directQuery = await pool.query(`
            SELECT 
                bid_amount, bidder_login, bid_timestamp, is_auto_bid
            FROM lot_bids 
            WHERE lot_id = $1
            ORDER BY bid_timestamp DESC
        `, [testLot.id]);
        
        console.log(`📊 Прямой SQL запрос вернул ${directQuery.rows.length} ставок:`);
        directQuery.rows.forEach((bid, index) => {
            const autoBid = bid.is_auto_bid ? ' (авто)' : '';
            console.log(`   ${index + 1}. ${bid.bid_amount}₽ от ${bid.bidder_login}${autoBid} (${bid.bid_timestamp})`);
        });
        
        // Тестируем HTTP запрос к API
        console.log('\n🌐 Тестируем HTTP API...');
        
        const fetch = require('node-fetch');
        const apiUrl = `http://localhost:3001/api/lots/${testLot.id}/bids`;
        
        try {
            const response = await fetch(apiUrl);
            const data = await response.json();
            
            console.log(`📊 HTTP API вернул статус: ${response.status}`);
            console.log(`📊 HTTP API вернул данные:`, JSON.stringify(data, null, 2));
            
            if (data.success && data.bids) {
                console.log(`✅ API работает корректно! Получено ${data.bids.length} ставок`);
            } else {
                console.log('❌ API вернул неожиданный формат данных');
            }
            
        } catch (error) {
            console.error('❌ Ошибка HTTP запроса:', error.message);
        }
        
    } catch (error) {
        console.error('❌ Ошибка тестирования API:', error.message);
    } finally {
        await pool.end();
    }
}

// Запускаем тест
if (require.main === module) {
    testBidsAPI()
        .then(() => {
            console.log('✅ Тест завершен');
            process.exit(0);
        })
        .catch((error) => {
            console.error('❌ Ошибка:', error.message);
            process.exit(1);
        });
}

module.exports = testBidsAPI;

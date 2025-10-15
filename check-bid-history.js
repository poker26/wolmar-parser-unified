const { Pool } = require('pg');
const config = require('./config');

async function checkBidHistory() {
    console.log('🔍 ПРОВЕРКА ИСТОРИИ СТАВОК');
    console.log('==========================');
    
    const pool = new Pool(config.dbConfig);
    
    try {
        console.log('\n1️⃣ Подключаемся к базе данных...');
        
        console.log('\n2️⃣ Проверяем таблицу lot_bids...');
        const tableExists = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'lot_bids'
            );
        `);
        console.log(`📊 Таблица lot_bids существует: ${tableExists.rows[0].exists}`);
        
        if (tableExists.rows[0].exists) {
            console.log('\n3️⃣ Проверяем количество записей в lot_bids...');
            const countResult = await pool.query('SELECT COUNT(*) as count FROM lot_bids');
            console.log(`📊 Всего записей в lot_bids: ${countResult.rows[0].count}`);
            
            if (countResult.rows[0].count > 0) {
                console.log('\n4️⃣ Показываем последние 10 записей...');
                const recentBids = await pool.query(`
                    SELECT lb.*, al.coin_description
                    FROM lot_bids lb
                    LEFT JOIN auction_lots al ON lb.lot_id = al.id
                    ORDER BY lb.id DESC
                    LIMIT 10
                `);
                
                console.log('📋 Последние 10 ставок:');
                recentBids.rows.forEach((bid, index) => {
                    console.log(`   ${index + 1}. Лот ${bid.lot_number} | ${bid.amount} руб. | ${bid.bidder} | ${bid.timestamp} | Автобид: ${bid.is_auto_bid ? 'Да' : 'Нет'}`);
                    console.log(`      Описание: ${bid.coin_description?.substring(0, 50)}...`);
                });
                
                console.log('\n5️⃣ Статистика по автобидам...');
                const autobidStats = await pool.query(`
                    SELECT 
                        COUNT(*) as total_bids,
                        COUNT(CASE WHEN is_auto_bid = true THEN 1 END) as autobids,
                        COUNT(CASE WHEN is_auto_bid = false THEN 1 END) as manual_bids
                    FROM lot_bids
                `);
                const stats = autobidStats.rows[0];
                console.log(`📊 Всего ставок: ${stats.total_bids}`);
                console.log(`📊 Автобидов: ${stats.autobids} (${Math.round(stats.autobids / stats.total_bids * 100)}%)`);
                console.log(`📊 Ручных ставок: ${stats.manual_bids} (${Math.round(stats.manual_bids / stats.total_bids * 100)}%)`);
            }
        } else {
            console.log('❌ Таблица lot_bids не существует. Нужно создать её.');
        }
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
        console.error('❌ Стек ошибки:', error.stack);
    } finally {
        await pool.end();
    }
}

if (require.main === module) {
    checkBidHistory();
}

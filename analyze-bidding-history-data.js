/**
 * Анализ истории ставок в базе данных
 * Проверяет, для каких лотов есть история ставок и что в ней содержится
 */

const { Pool } = require('pg');

const dbConfig = {
    user: 'postgres.xkwgspqwebfeteoblayu',
    host: 'sup.begemot26.ru',
    database: 'postgres',
    password: 'Gopapopa326+',
    port: 6543,
    ssl: { rejectUnauthorized: false }
};

async function analyzeBiddingHistoryData() {
    const db = new Pool(dbConfig);
    
    try {
        console.log('🔍 Анализ истории ставок в базе данных...');
        
        // 1. Проверяем, существуют ли таблицы для истории ставок
        console.log('\n📋 Проверка существования таблиц:');
        
        const tablesCheck = await db.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name IN ('auction_bids', 'user_sessions', 'suspicious_activity')
            ORDER BY table_name
        `);
        
        console.log('   Найденные таблицы:');
        tablesCheck.rows.forEach(row => {
            console.log(`   ✅ ${row.table_name}`);
        });
        
        if (tablesCheck.rows.length === 0) {
            console.log('   ❌ Таблицы для истории ставок не найдены');
            return;
        }
        
        // 2. Анализируем таблицу auction_bids
        if (tablesCheck.rows.find(r => r.table_name === 'auction_bids')) {
            console.log('\n📊 Анализ таблицы auction_bids:');
            
            // Структура таблицы
            const bidsStructure = await db.query(`
                SELECT column_name, data_type, is_nullable
                FROM information_schema.columns 
                WHERE table_name = 'auction_bids' 
                ORDER BY ordinal_position
            `);
            
            console.log('   Структура таблицы:');
            bidsStructure.rows.forEach(row => {
                console.log(`     ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable})`);
            });
            
            // Общее количество записей
            const bidsCount = await db.query('SELECT COUNT(*) as total FROM auction_bids');
            console.log(`   Всего записей: ${bidsCount.rows[0].total}`);
            
            if (bidsCount.rows[0].total > 0) {
                // Пример записи
                const sampleBid = await db.query('SELECT * FROM auction_bids LIMIT 1');
                console.log('   Пример записи:');
                Object.keys(sampleBid.rows[0]).forEach(key => {
                    console.log(`     ${key}: ${sampleBid.rows[0][key]}`);
                });
                
                // Статистика по лотам
                const lotsWithBids = await db.query(`
                    SELECT 
                        COUNT(DISTINCT lot_number) as unique_lots,
                        COUNT(DISTINCT auction_number) as unique_auctions,
                        COUNT(DISTINCT bidder_login) as unique_bidders,
                        MIN(bid_time) as earliest_bid,
                        MAX(bid_time) as latest_bid
                    FROM auction_bids
                `);
                
                console.log('   Статистика:');
                console.log(`     Уникальных лотов: ${lotsWithBids.rows[0].unique_lots}`);
                console.log(`     Уникальных аукционов: ${lotsWithBids.rows[0].unique_auctions}`);
                console.log(`     Уникальных участников торгов: ${lotsWithBids.rows[0].unique_bidders}`);
                console.log(`     Самая ранняя ставка: ${lotsWithBids.rows[0].earliest_bid}`);
                console.log(`     Самая поздняя ставка: ${lotsWithBids.rows[0].latest_bid}`);
                
                // Топ лотов по количеству ставок
                const topLots = await db.query(`
                    SELECT 
                        lot_number,
                        auction_number,
                        COUNT(*) as bids_count,
                        MIN(bid_amount) as min_bid,
                        MAX(bid_amount) as max_bid,
                        COUNT(DISTINCT bidder_login) as unique_bidders
                    FROM auction_bids
                    GROUP BY lot_number, auction_number
                    ORDER BY bids_count DESC
                    LIMIT 10
                `);
                
                console.log('\n   Топ-10 лотов по количеству ставок:');
                topLots.rows.forEach((lot, index) => {
                    console.log(`     ${index + 1}. Лот ${lot.lot_number} (аукцион ${lot.auction_number}): ${lot.bids_count} ставок, ${lot.unique_bidders} участников, ${lot.min_bid}-${lot.max_bid}₽`);
                });
                
                // Топ участников торгов
                const topBidders = await db.query(`
                    SELECT 
                        bidder_login,
                        COUNT(*) as total_bids,
                        COUNT(DISTINCT lot_number) as lots_participated,
                        COUNT(DISTINCT auction_number) as auctions_participated,
                        AVG(bid_amount) as avg_bid_amount
                    FROM auction_bids
                    GROUP BY bidder_login
                    ORDER BY total_bids DESC
                    LIMIT 10
                `);
                
                console.log('\n   Топ-10 участников торгов:');
                topBidders.rows.forEach((bidder, index) => {
                    console.log(`     ${index + 1}. ${bidder.bidder_login}: ${bidder.total_bids} ставок, ${bidder.lots_participated} лотов, ${bidder.auctions_participated} аукционов, средняя ставка ${Math.round(bidder.avg_bid_amount)}₽`);
                });
            }
        }
        
        // 3. Анализируем таблицу user_sessions
        if (tablesCheck.rows.find(r => r.table_name === 'user_sessions')) {
            console.log('\n📊 Анализ таблицы user_sessions:');
            
            const sessionsCount = await db.query('SELECT COUNT(*) as total FROM user_sessions');
            console.log(`   Всего записей: ${sessionsCount.rows[0].total}`);
            
            if (sessionsCount.rows[0].total > 0) {
                // Статистика по IP-адресам
                const ipStats = await db.query(`
                    SELECT 
                        ip_address,
                        COUNT(DISTINCT bidder_login) as unique_users,
                        COUNT(*) as total_sessions,
                        SUM(total_bids) as total_bids
                    FROM user_sessions
                    GROUP BY ip_address
                    HAVING COUNT(DISTINCT bidder_login) > 1
                    ORDER BY unique_users DESC, total_bids DESC
                    LIMIT 10
                `);
                
                console.log('   Топ-10 IP-адресов с несколькими пользователями:');
                ipStats.rows.forEach((ip, index) => {
                    console.log(`     ${index + 1}. ${ip.ip_address}: ${ip.unique_users} пользователей, ${ip.total_sessions} сессий, ${ip.total_bids} ставок`);
                });
            }
        }
        
        // 4. Анализируем таблицу suspicious_activity
        if (tablesCheck.rows.find(r => r.table_name === 'suspicious_activity')) {
            console.log('\n📊 Анализ таблицы suspicious_activity:');
            
            const suspiciousCount = await db.query('SELECT COUNT(*) as total FROM suspicious_activity');
            console.log(`   Всего записей: ${suspiciousCount.rows[0].total}`);
            
            if (suspiciousCount.rows[0].total > 0) {
                // Типы подозрительной активности
                const activityTypes = await db.query(`
                    SELECT 
                        activity_type,
                        COUNT(*) as occurrences,
                        COUNT(DISTINCT user_login) as affected_users
                    FROM suspicious_activity
                    GROUP BY activity_type
                    ORDER BY occurrences DESC
                `);
                
                console.log('   Типы подозрительной активности:');
                activityTypes.rows.forEach((type, index) => {
                    console.log(`     ${index + 1}. ${type.activity_type}: ${type.occurrences} случаев, ${type.affected_users} пользователей`);
                });
            }
        }
        
        // 5. Связь с основной таблицей auction_lots
        console.log('\n🔗 Связь с основной таблицей auction_lots:');
        
        const lotsWithHistory = await db.query(`
            SELECT COUNT(*) as total 
            FROM auction_lots 
            WHERE bidding_history_collected = true
        `);
        console.log(`   Лотов с собранной историей ставок: ${lotsWithHistory.rows[0].total}`);
        
        const lotsWithoutHistory = await db.query(`
            SELECT COUNT(*) as total 
            FROM auction_lots 
            WHERE bidding_history_collected = false OR bidding_history_collected IS NULL
        `);
        console.log(`   Лотов без истории ставок: ${lotsWithoutHistory.rows[0].total}`);
        
        // 6. Проверяем соответствие данных
        if (tablesCheck.rows.find(r => r.table_name === 'auction_bids')) {
            const bidsCount = await db.query('SELECT COUNT(*) as total FROM auction_bids');
            const lotsWithHistoryCount = await db.query('SELECT COUNT(*) as total FROM auction_lots WHERE bidding_history_collected = true');
            
            console.log('\n📈 Соответствие данных:');
            console.log(`   Записей в auction_bids: ${bidsCount.rows[0].total}`);
            console.log(`   Лотов с bidding_history_collected = true: ${lotsWithHistoryCount.rows[0].total}`);
            
            if (bidsCount.rows[0].total > 0 && lotsWithHistoryCount.rows[0].total > 0) {
                console.log('   ✅ Данные соответствуют друг другу');
            } else if (bidsCount.rows[0].total > 0 && lotsWithHistoryCount.rows[0].total === 0) {
                console.log('   ⚠️ Есть данные в auction_bids, но нет лотов с bidding_history_collected = true');
            } else {
                console.log('   ❌ Нет данных для анализа');
            }
        }
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    } finally {
        await db.end();
    }
}

analyzeBiddingHistoryData();

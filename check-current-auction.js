const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool(config.dbConfig);

async function checkCurrentAuction() {
    try {
        console.log('🔍 Проверяем логику определения текущего аукциона...');
        
        // 1. Проверяем аукцион 2130
        const auction2130Query = `
            SELECT auction_number, COUNT(*) as total_lots
            FROM auction_lots 
            WHERE auction_number = '2130'
            GROUP BY auction_number
        `;
        const result2130 = await pool.query(auction2130Query);
        console.log(`\n📊 Аукцион 2130: ${result2130.rows.length > 0 ? result2130.rows[0].total_lots + ' лотов' : 'не найден'}`);
        
        // 2. Проверяем активные аукционы (дата окончания больше текущей)
        const activeAuctionQuery = `
            SELECT 
                auction_number,
                COUNT(*) as total_lots,
                COUNT(CASE WHEN winning_bid IS NULL THEN 1 END) as unsold_lots,
                COUNT(CASE WHEN winning_bid IS NOT NULL THEN 1 END) as sold_lots
            FROM auction_lots 
            WHERE auction_end_date > NOW()
            GROUP BY auction_number
            ORDER BY auction_number DESC
        `;
        const activeResult = await pool.query(activeAuctionQuery);
        console.log(`\n📊 Активные аукционы (дата окончания > NOW()):`);
        activeResult.rows.forEach(row => {
            console.log(`   Аукцион ${row.auction_number}: ${row.total_lots} лотов (${row.unsold_lots} не продано, ${row.sold_lots} продано)`);
        });
        
        // 3. Проверяем аукцион 968
        const auction968Query = `
            SELECT 
                auction_number,
                COUNT(*) as total_lots,
                COUNT(CASE WHEN winning_bid IS NULL THEN 1 END) as unsold_lots,
                COUNT(CASE WHEN winning_bid IS NOT NULL THEN 1 END) as sold_lots,
                MIN(auction_end_date) as min_end_date,
                MAX(auction_end_date) as max_end_date
            FROM auction_lots 
            WHERE auction_number = '968'
            GROUP BY auction_number
        `;
        const result968 = await pool.query(auction968Query);
        if (result968.rows.length > 0) {
            const row = result968.rows[0];
            console.log(`\n📊 Аукцион 968:`);
            console.log(`   Всего лотов: ${row.total_lots}`);
            console.log(`   Не продано: ${row.unsold_lots}`);
            console.log(`   Продано: ${row.sold_lots}`);
            console.log(`   Дата окончания: ${row.min_end_date} - ${row.max_end_date}`);
        }
        
        // 4. Проверяем самый новый аукцион
        const latestAuctionQuery = `
            SELECT 
                auction_number,
                COUNT(*) as total_lots,
                COUNT(CASE WHEN winning_bid IS NULL THEN 1 END) as unsold_lots,
                COUNT(CASE WHEN winning_bid IS NOT NULL THEN 1 END) as sold_lots
            FROM auction_lots 
            GROUP BY auction_number
            ORDER BY auction_number DESC
            LIMIT 3
        `;
        const latestResult = await pool.query(latestAuctionQuery);
        console.log(`\n📊 Последние 3 аукциона:`);
        latestResult.rows.forEach(row => {
            console.log(`   Аукцион ${row.auction_number}: ${row.total_lots} лотов (${row.unsold_lots} не продано, ${row.sold_lots} продано)`);
        });
        
    } catch (error) {
        console.error('❌ Ошибка проверки:', error);
    } finally {
        await pool.end();
    }
}

checkCurrentAuction();

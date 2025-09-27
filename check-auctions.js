const { Pool } = require('pg');

const dbConfig = {
    user: 'postgres.xkwgspqwebfeteoblayu',        
    host: 'aws-0-eu-north-1.pooler.supabase.com',
    database: 'postgres',   
    password: 'Gopapopa326+',    
    port: 6543,
    ssl: {
        rejectUnauthorized: false
    }
};

async function checkAuctions() {
    const pool = new Pool(dbConfig);
    
    try {
        // Получаем последние аукционы
        const result = await pool.query(`
            SELECT auction_number, COUNT(*) as lots_count, 
                   MIN(auction_end_date) as start_date,
                   MAX(auction_end_date) as end_date
            FROM auction_lots 
            GROUP BY auction_number 
            ORDER BY auction_number DESC 
            LIMIT 10
        `);
        
        console.log('📋 Последние аукционы:');
        result.rows.forEach(row => {
            console.log(`Аукцион ${row.auction_number}: ${row.lots_count} лотов (${row.start_date} - ${row.end_date})`);
        });
        
        // Проверяем активные аукционы
        const activeResult = await pool.query(`
            SELECT auction_number, COUNT(*) as lots_count
            FROM auction_lots 
            WHERE auction_end_date > NOW()
            GROUP BY auction_number 
            ORDER BY auction_number DESC
        `);
        
        console.log('\n🔄 Активные аукционы:');
        if (activeResult.rows.length > 0) {
            activeResult.rows.forEach(row => {
                console.log(`Аукцион ${row.auction_number}: ${row.lots_count} лотов`);
            });
        } else {
            console.log('Нет активных аукционов');
        }
        
    } catch (error) {
        console.error('❌ Ошибка:', error);
    } finally {
        await pool.end();
    }
}

checkAuctions();
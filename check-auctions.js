const { Client } = require('pg');
const config = require('./config');

async function checkAuctions() {
    const client = new Client(config.dbConfig);
    await client.connect();
    
    const result = await client.query(`
        SELECT DISTINCT auction_number, 
               MIN(auction_end_date) as start_date, 
               MAX(auction_end_date) as end_date,
               COUNT(*) as lots_count
        FROM auction_lots 
        GROUP BY auction_number 
        ORDER BY auction_number DESC 
        LIMIT 10
    `);
    
    console.log('Аукционы в базе:');
    result.rows.forEach(row => {
        console.log(`Аукцион ${row.auction_number}: ${row.start_date} - ${row.end_date} (${row.lots_count} лотов)`);
    });
    
    await client.end();
}

checkAuctions();

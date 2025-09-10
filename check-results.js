const { Pool } = require('pg');
const config = require('./config');

async function checkResults() {
    const pool = new Pool(config.dbConfig);
    const client = await pool.connect();
    
    try {
        const result = await client.query('SELECT COUNT(*) as count FROM coin_catalog');
        console.log('📊 Уникальных монет в каталоге:', result.rows[0].count);
        
        const result2 = await client.query('SELECT denomination, coin_name, metal, year FROM coin_catalog ORDER BY denomination, coin_name, metal LIMIT 10');
        console.log('\n🔍 Примеры записей:');
        result2.rows.forEach((row, index) => {
            console.log(`${index + 1}. ${row.denomination} ${row.coin_name} (${row.metal}) ${row.year}г.`);
        });
        
    } finally {
        client.release();
        await pool.end();
    }
}

checkResults().catch(console.error);

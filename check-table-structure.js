const { Pool } = require('pg');
const config = require('./config');

async function checkTable() {
    const pool = new Pool(config.dbConfig);
    const client = await pool.connect();
    
    try {
        const result = await client.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'coin_catalog' 
            ORDER BY ordinal_position
        `);
        
        console.log('Колонки в таблице coin_catalog:');
        result.rows.forEach((row, index) => {
            console.log(`${index + 1}. ${row.column_name} (${row.data_type})`);
        });
        
    } finally {
        client.release();
        await pool.end();
    }
}

checkTable().catch(console.error);

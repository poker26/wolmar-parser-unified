const { Pool } = require('pg');
const config = require('./config');

async function checkConstraints() {
    const pool = new Pool(config.dbConfig);
    const client = await pool.connect();
    
    try {
        const result = await client.query(`
            SELECT 
                tc.constraint_name, 
                tc.constraint_type,
                kcu.column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu 
                ON tc.constraint_name = kcu.constraint_name
            WHERE tc.table_name = 'coin_catalog'
            ORDER BY tc.constraint_name, kcu.ordinal_position
        `);
        
        console.log('Ограничения таблицы coin_catalog:');
        result.rows.forEach((row, index) => {
            console.log(`${index + 1}. ${row.constraint_name} (${row.constraint_type}) - ${row.column_name}`);
        });
        
    } finally {
        client.release();
        await pool.end();
    }
}

checkConstraints().catch(console.error);

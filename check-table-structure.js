const { Pool } = require('pg');
const config = require('./config');

async function checkTable() {
    const pool = new Pool(config.dbConfig);
    
    try {
        const result = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'auction_lots' 
            ORDER BY ordinal_position
        `);
        
        console.log('Структура таблицы auction_lots:');
        result.rows.forEach(row => {
            console.log(`- ${row.column_name}: ${row.data_type}`);
        });
        
        await pool.end();
    } catch (error) {
        console.error('Ошибка:', error.message);
        process.exit(1);
    }
}

checkTable();

const { Client } = require('pg');
const config = require('./config');

async function checkTableStructure() {
    const client = new Client(config.dbConfig);
    
    try {
        await client.connect();
        console.log('✅ Подключено к базе данных');
        
        // Получаем структуру таблицы auction_lots
        const result = await client.query(`
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns 
            WHERE table_name = 'auction_lots' 
            ORDER BY ordinal_position
        `);
        
        console.log('📋 Структура таблицы auction_lots:');
        result.rows.forEach((row, index) => {
            console.log(`   ${index + 1}. ${row.column_name} (${row.data_type}) - ${row.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}`);
        });
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    } finally {
        await client.end();
    }
}

checkTableStructure();
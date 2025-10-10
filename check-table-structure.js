const { Pool } = require('pg');
const config = require('./config');

async function checkTableStructure() {
    const pool = new Pool(config.dbConfig);
    
    try {
        console.log('🔍 Проверяем структуру таблицы coin_catalog...');
        
        const query = `
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns 
            WHERE table_name = 'coin_catalog'
            ORDER BY ordinal_position
        `;
        
        const result = await pool.query(query);
        
        console.log('\n📋 Структура таблицы coin_catalog:');
        result.rows.forEach((row, index) => {
            console.log(`${index + 1}. ${row.column_name} (${row.data_type}) - ${row.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}`);
        });
        
        // Также проверим несколько записей для понимания данных
        console.log('\n📊 Примеры записей:');
        const sampleQuery = `
            SELECT *
            FROM coin_catalog 
            LIMIT 3
        `;
        
        const sampleResult = await pool.query(sampleQuery);
        
        if (sampleResult.rows.length > 0) {
            const columns = Object.keys(sampleResult.rows[0]);
            console.log('Колонки:', columns.join(', '));
            
            sampleResult.rows.forEach((row, index) => {
                console.log(`\nЗапись ${index + 1}:`);
                columns.forEach(col => {
                    console.log(`  ${col}: ${row[col]}`);
                });
            });
        }
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    } finally {
        await pool.end();
    }
}

checkTableStructure();
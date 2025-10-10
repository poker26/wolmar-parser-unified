const { Pool } = require('pg');
const config = require('./config');

async function checkColumns() {
    const pool = new Pool(config.dbConfig);
    
    try {
        console.log('🔍 Проверяем колонки таблицы coin_catalog...');
        
        // Проверим конкретные колонки
        const testQuery = `
            SELECT 
                denomination,
                coin_metal,
                coin_weight,
                year
            FROM coin_catalog 
            LIMIT 1
        `;
        
        const result = await pool.query(testQuery);
        console.log('✅ Запрос выполнен успешно');
        console.log('Колонки:', Object.keys(result.rows[0]));
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
        
        // Попробуем найти правильные названия колонок
        console.log('\n🔍 Ищем колонки с "metal" в названии...');
        const findColumnsQuery = `
            SELECT column_name
            FROM information_schema.columns 
            WHERE table_name = 'coin_catalog'
            AND column_name LIKE '%metal%'
        `;
        
        try {
            const findResult = await pool.query(findColumnsQuery);
            console.log('Колонки с "metal":', findResult.rows.map(r => r.column_name));
        } catch (e) {
            console.error('Ошибка поиска колонок:', e.message);
        }
    } finally {
        await pool.end();
    }
}

checkColumns();

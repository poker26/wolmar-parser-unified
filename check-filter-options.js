const { Pool } = require('pg');
const config = require('./config');

async function checkFilterOptions() {
    const pool = new Pool(config.dbConfig);
    
    try {
        console.log('🔍 Проверяем таблицу filter_options...');
        
        // Проверяем структуру таблицы
        const structureQuery = `
            SELECT column_name, data_type, is_nullable 
            FROM information_schema.columns 
            WHERE table_name = 'filter_options' 
            ORDER BY ordinal_position
        `;
        
        const structureResult = await pool.query(structureQuery);
        console.log('📋 Структура таблицы:');
        structureResult.rows.forEach(row => {
            console.log(`   ${row.column_name}: ${row.data_type} (${row.is_nullable === 'YES' ? 'nullable' : 'not null'})`);
        });
        
        // Проверяем данные
        const dataQuery = `
            SELECT type, COUNT(*) as count 
            FROM filter_options 
            GROUP BY type 
            ORDER BY type
        `;
        
        const dataResult = await pool.query(dataQuery);
        console.log('\n📊 Данные в таблице:');
        dataResult.rows.forEach(row => {
            console.log(`   ${row.type}: ${row.count} записей`);
        });
        
        // Показываем примеры данных
        const examplesQuery = `
            SELECT type, value, display_name 
            FROM filter_options 
            ORDER BY type, display_name 
            LIMIT 10
        `;
        
        const examplesResult = await pool.query(examplesQuery);
        console.log('\n📝 Примеры данных:');
        examplesResult.rows.forEach(row => {
            console.log(`   ${row.type}: "${row.value}" -> "${row.display_name}"`);
        });
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    } finally {
        await pool.end();
    }
}

checkFilterOptions();


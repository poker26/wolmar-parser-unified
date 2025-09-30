const { Pool } = require('pg');
const config = require('./config');

async function checkUsersTable() {
    const pool = new Pool(config.dbConfig);
    
    try {
        console.log('🔍 Проверка структуры таблицы users...\n');
        
        // Проверяем существующие таблицы
        const tablesResult = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name LIKE '%user%'
            ORDER BY table_name
        `);
        
        console.log('📋 Найденные таблицы с "user":');
        tablesResult.rows.forEach(row => {
            console.log(`  - ${row.table_name}`);
        });
        
        // Проверяем структуру таблицы users
        const columnsResult = await pool.query(`
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns 
            WHERE table_name = 'users'
            ORDER BY ordinal_position
        `);
        
        if (columnsResult.rows.length > 0) {
            console.log('\n📋 Структура таблицы users:');
            columnsResult.rows.forEach(row => {
                console.log(`  - ${row.column_name}: ${row.data_type} ${row.is_nullable === 'NO' ? 'NOT NULL' : 'NULL'}`);
            });
        } else {
            console.log('\n❌ Таблица users не найдена');
        }
        
        // Проверяем, есть ли данные в таблице
        const countResult = await pool.query('SELECT COUNT(*) as count FROM users');
        console.log(`\n📊 Количество записей в users: ${countResult.rows[0].count}`);
        
    } catch (error) {
        console.error('❌ Ошибка проверки таблицы:', error.message);
    } finally {
        await pool.end();
    }
}

checkUsersTable();

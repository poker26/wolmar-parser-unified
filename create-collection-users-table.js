const { Pool } = require('pg');
const config = require('./config');

async function createCollectionUsersTable() {
    const pool = new Pool(config.dbConfig);
    
    try {
        console.log('🔧 Создание таблицы collection_users...\n');
        
        // Создаем таблицу collection_users
        await pool.query(`
            CREATE TABLE IF NOT EXISTS collection_users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                email VARCHAR(100),
                full_name VARCHAR(100),
                created_at TIMESTAMP DEFAULT NOW(),
                last_login TIMESTAMP,
                is_active BOOLEAN DEFAULT true
            )
        `);
        console.log('✅ Создана таблица collection_users');
        
        // Создаем индексы
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_collection_users_username ON collection_users(username);
            CREATE INDEX IF NOT EXISTS idx_collection_users_email ON collection_users(email);
        `);
        console.log('✅ Созданы индексы для collection_users');
        
        // Обновляем таблицу user_collections чтобы ссылаться на collection_users
        await pool.query(`
            ALTER TABLE user_collections 
            DROP CONSTRAINT IF EXISTS user_collections_user_id_fkey
        `);
        console.log('✅ Удалена старая связь user_collections -> users');
        
        await pool.query(`
            ALTER TABLE user_collections 
            ADD CONSTRAINT user_collections_user_id_fkey 
            FOREIGN KEY (user_id) REFERENCES collection_users(id) ON DELETE CASCADE
        `);
        console.log('✅ Обновлена связь user_collections -> collection_users');
        
        // Обновляем таблицу user_sessions
        await pool.query(`
            ALTER TABLE user_sessions 
            DROP CONSTRAINT IF EXISTS user_sessions_user_id_fkey
        `);
        console.log('✅ Удалена старая связь user_sessions -> users');
        
        await pool.query(`
            ALTER TABLE user_sessions 
            ADD CONSTRAINT user_sessions_user_id_fkey 
            FOREIGN KEY (user_id) REFERENCES collection_users(id) ON DELETE CASCADE
        `);
        console.log('✅ Обновлена связь user_sessions -> collection_users');
        
        // Проверяем структуру созданной таблицы
        const result = await pool.query(`
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns 
            WHERE table_name = 'collection_users'
            ORDER BY ordinal_position
        `);
        
        console.log('\n📋 Структура таблицы collection_users:');
        result.rows.forEach(row => {
            console.log(`  - ${row.column_name}: ${row.data_type} ${row.is_nullable === 'NO' ? 'NOT NULL' : 'NULL'}`);
        });
        
        console.log('\n🎉 Таблица collection_users успешно создана!');
        
    } catch (error) {
        console.error('❌ Ошибка при создании таблицы:', error.message);
        throw error;
    } finally {
        await pool.end();
    }
}

// Запускаем создание таблицы
createCollectionUsersTable()
    .then(() => {
        console.log('✅ Создание таблицы завершено успешно');
        process.exit(0);
    })
    .catch(error => {
        console.error('❌ Ошибка:', error.message);
        process.exit(1);
    });

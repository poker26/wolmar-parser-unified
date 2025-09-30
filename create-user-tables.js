const { Pool } = require('pg');
const config = require('./config');

async function createUserTables() {
    const pool = new Pool(config.dbConfig);
    
    try {
        console.log('🔧 Создание таблиц для системы пользователей и коллекций...\n');
        
        // Создаем таблицу пользователей
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
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
        console.log('✅ Создана таблица users');
        
        // Создаем таблицу коллекций пользователей
        await pool.query(`
            CREATE TABLE IF NOT EXISTS user_collections (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                coin_id INTEGER REFERENCES coin_catalog(id) ON DELETE CASCADE,
                added_at TIMESTAMP DEFAULT NOW(),
                notes TEXT,
                condition_rating INTEGER CHECK (condition_rating >= 1 AND condition_rating <= 5),
                purchase_price DECIMAL(12,2),
                purchase_date DATE,
                UNIQUE(user_id, coin_id)
            )
        `);
        console.log('✅ Создана таблица user_collections');
        
        // Создаем индексы для быстрого поиска
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_user_collections_user_id ON user_collections(user_id);
            CREATE INDEX IF NOT EXISTS idx_user_collections_coin_id ON user_collections(coin_id);
            CREATE INDEX IF NOT EXISTS idx_user_collections_added_at ON user_collections(added_at);
        `);
        console.log('✅ Созданы индексы для быстрого поиска');
        
        // Создаем таблицу сессий для JWT токенов (опционально)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS user_sessions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                token_hash VARCHAR(255) NOT NULL,
                expires_at TIMESTAMP NOT NULL,
                created_at TIMESTAMP DEFAULT NOW(),
                is_active BOOLEAN DEFAULT true
            )
        `);
        console.log('✅ Создана таблица user_sessions');
        
        // Создаем индекс для сессий
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(token_hash);
            CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
        `);
        console.log('✅ Созданы индексы для сессий');
        
        // Проверяем структуру созданных таблиц
        const tables = ['users', 'user_collections', 'user_sessions'];
        
        for (const table of tables) {
            const result = await pool.query(`
                SELECT column_name, data_type, is_nullable, column_default
                FROM information_schema.columns 
                WHERE table_name = $1
                ORDER BY ordinal_position
            `, [table]);
            
            console.log(`\n📋 Структура таблицы ${table}:`);
            result.rows.forEach(row => {
                console.log(`  - ${row.column_name}: ${row.data_type} ${row.is_nullable === 'NO' ? 'NOT NULL' : 'NULL'}`);
            });
        }
        
        console.log('\n🎉 Таблицы для системы пользователей успешно созданы!');
        
    } catch (error) {
        console.error('❌ Ошибка при создании таблиц:', error.message);
        throw error;
    } finally {
        await pool.end();
    }
}

// Запускаем создание таблиц
createUserTables()
    .then(() => {
        console.log('✅ Создание таблиц завершено успешно');
        process.exit(0);
    })
    .catch(error => {
        console.error('❌ Ошибка:', error.message);
        process.exit(1);
    });

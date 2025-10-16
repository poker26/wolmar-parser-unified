const { Pool } = require('pg');
const config = require('./config');

async function createWatchlistTable() {
    const pool = new Pool(config.dbConfig);
    
    try {
        console.log('🔧 Создание таблицы watchlist...');
        
        // Создаем таблицу watchlist
        await pool.query(`
            CREATE TABLE IF NOT EXISTS watchlist (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES collection_users(id) ON DELETE CASCADE,
                lot_id INTEGER REFERENCES auction_lots(id) ON DELETE CASCADE,
                added_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(user_id, lot_id)
            )
        `);
        
        console.log('✅ Таблица watchlist создана');
        
        // Создаем индексы для оптимизации
        console.log('🔧 Создание индексов...');
        
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_watchlist_user_id ON watchlist(user_id)
        `);
        
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_watchlist_lot_id ON watchlist(lot_id)
        `);
        
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_watchlist_added_at ON watchlist(added_at)
        `);
        
        console.log('✅ Индексы созданы');
        
        // Проверяем структуру таблицы
        console.log('🔍 Проверка структуры таблицы...');
        
        const result = await pool.query(`
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns 
            WHERE table_name = 'watchlist' 
            ORDER BY ordinal_position
        `);
        
        console.log('📊 Структура таблицы watchlist:');
        result.rows.forEach(row => {
            console.log(`  - ${row.column_name}: ${row.data_type} ${row.is_nullable === 'NO' ? 'NOT NULL' : 'NULL'} ${row.column_default ? `DEFAULT ${row.column_default}` : ''}`);
        });
        
        // Проверяем ограничения
        const constraints = await pool.query(`
            SELECT constraint_name, constraint_type
            FROM information_schema.table_constraints 
            WHERE table_name = 'watchlist'
        `);
        
        console.log('🔒 Ограничения таблицы:');
        constraints.rows.forEach(row => {
            console.log(`  - ${row.constraint_name}: ${row.constraint_type}`);
        });
        
        console.log('🎉 Таблица watchlist успешно создана и настроена!');
        
    } catch (error) {
        console.error('❌ Ошибка создания таблицы watchlist:', error.message);
        throw error;
    } finally {
        await pool.end();
    }
}

// Запускаем скрипт
if (require.main === module) {
    createWatchlistTable()
        .then(() => {
            console.log('✅ Скрипт завершен успешно');
            process.exit(0);
        })
        .catch((error) => {
            console.error('❌ Скрипт завершен с ошибкой:', error.message);
            process.exit(1);
        });
}

module.exports = createWatchlistTable;

const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool(config.dbConfig);

async function createMetalsPricesTable() {
    try {
        console.log('🔧 Создаем таблицу для хранения цен на драгоценные металлы...');
        
        const createTableQuery = `
            CREATE TABLE IF NOT EXISTS metals_prices (
                id SERIAL PRIMARY KEY,
                date DATE NOT NULL UNIQUE,
                usd_rate DECIMAL(10,4),
                gold_price DECIMAL(10,4),      -- цена золота за грамм в рублях
                silver_price DECIMAL(10,4),    -- цена серебра за грамм в рублях
                platinum_price DECIMAL(10,4),  -- цена платины за грамм в рублях
                palladium_price DECIMAL(10,4), -- цена палладия за грамм в рублях
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `;
        
        await pool.query(createTableQuery);
        console.log('✅ Таблица metals_prices создана успешно');
        
        // Создаем индексы для быстрого поиска
        const createIndexesQuery = `
            CREATE INDEX IF NOT EXISTS idx_metals_prices_date ON metals_prices(date);
            CREATE INDEX IF NOT EXISTS idx_metals_prices_created_at ON metals_prices(created_at);
        `;
        
        await pool.query(createIndexesQuery);
        console.log('✅ Индексы созданы успешно');
        
        // Проверяем существующие данные
        const checkDataQuery = `
            SELECT 
                COUNT(*) as total_records,
                MIN(date) as earliest_date,
                MAX(date) as latest_date
            FROM metals_prices;
        `;
        
        const result = await pool.query(checkDataQuery);
        const stats = result.rows[0];
        
        console.log('📊 Статистика таблицы metals_prices:');
        console.log(`   - Всего записей: ${stats.total_records}`);
        console.log(`   - Период: ${stats.earliest_date || 'Нет данных'} - ${stats.latest_date || 'Нет данных'}`);
        
    } catch (error) {
        console.error('❌ Ошибка создания таблицы:', error);
    } finally {
        await pool.end();
    }
}

createMetalsPricesTable();

const { Pool } = require('pg');
const config = require('./config');

async function createFilterOptionsTable() {
    console.log('🔌 Подключаемся к базе данных...');
    console.log('📋 Конфигурация:', {
        host: config.dbConfig.host,
        database: config.dbConfig.database,
        user: config.dbConfig.user,
        port: config.dbConfig.port
    });
    
    // Увеличиваем таймауты для Supabase
    const dbConfig = {
        ...config.dbConfig,
        connectionTimeoutMillis: 30000,
        idleTimeoutMillis: 60000,
        query_timeout: 30000
    };
    
    const pool = new Pool(dbConfig);
    
    try {
        // Тестируем подключение
        console.log('🔍 Тестируем подключение...');
        await pool.query('SELECT 1');
        console.log('✅ Подключение к БД успешно');
        
        console.log('🔧 Создаем таблицу filter_options...');
        
        // Создаем таблицу
        const createTableQuery = `
            CREATE TABLE IF NOT EXISTS filter_options (
                id SERIAL PRIMARY KEY,
                type VARCHAR(20) NOT NULL,
                value VARCHAR(200) NOT NULL,
                display_name VARCHAR(200) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(type, value)
            );
        `;
        
        await pool.query(createTableQuery);
        console.log('✅ Таблица filter_options создана');
        
        // Очищаем таблицу
        await pool.query('DELETE FROM filter_options');
        console.log('🗑️ Таблица очищена');
        
        // Заполняем данными из coin_catalog
        console.log('📊 Заполняем данными из coin_catalog...');
        
        // Страны
        const countriesQuery = `
            INSERT INTO filter_options (type, value, display_name)
            SELECT DISTINCT 'country', country, country 
            FROM coin_catalog 
            WHERE country IS NOT NULL AND country != ''
            ORDER BY country
        `;
        
        const countriesResult = await pool.query(countriesQuery);
        console.log(`✅ Добавлено ${countriesResult.rowCount} стран`);
        
        // Редкости
        const raritiesQuery = `
            INSERT INTO filter_options (type, value, display_name)
            SELECT DISTINCT 'rarity', rarity, rarity 
            FROM coin_catalog 
            WHERE rarity IS NOT NULL AND rarity != ''
            ORDER BY rarity
        `;
        
        const raritiesResult = await pool.query(raritiesQuery);
        console.log(`✅ Добавлено ${raritiesResult.rowCount} редкостей`);
        
        // Монетные дворы
        const mintsQuery = `
            INSERT INTO filter_options (type, value, display_name)
            SELECT DISTINCT 'mint', mint, mint 
            FROM coin_catalog 
            WHERE mint IS NOT NULL AND mint != ''
            ORDER BY mint
        `;
        
        const mintsResult = await pool.query(mintsQuery);
        console.log(`✅ Добавлено ${mintsResult.rowCount} монетных дворов`);
        
        // Проверяем результат
        const totalQuery = `
            SELECT type, COUNT(*) as count 
            FROM filter_options 
            GROUP BY type 
            ORDER BY type
        `;
        
        const totalResult = await pool.query(totalQuery);
        console.log('📊 Итого в таблице:');
        totalResult.rows.forEach(row => {
            console.log(`   ${row.type}: ${row.count} записей`);
        });
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    } finally {
        await pool.end();
    }
}

createFilterOptionsTable();

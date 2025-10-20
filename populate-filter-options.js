const { Pool } = require('pg');
const config = require('./config');

async function populateFilterOptions() {
    // Увеличиваем таймауты для Supabase
    const dbConfig = {
        ...config.dbConfig,
        connectionTimeoutMillis: 30000,
        idleTimeoutMillis: 60000,
        query_timeout: 30000
    };
    
    const pool = new Pool(dbConfig);
    
    try {
        console.log('🔌 Подключаемся к базе данных...');
        
        // Тестируем подключение
        await pool.query('SELECT 1');
        console.log('✅ Подключение к БД успешно');
        
        // Очищаем таблицу
        console.log('🗑️ Очищаем таблицу...');
        await pool.query('DELETE FROM filter_options');
        console.log('✅ Таблица очищена');
        
        // Заполняем данными из coin_catalog
        console.log('📊 Заполняем данными из coin_catalog...');
        
        // Страны
        console.log('🌍 Добавляем страны...');
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
        console.log('⭐ Добавляем редкости...');
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
        console.log('🏛️ Добавляем монетные дворы...');
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
        console.log('📊 Проверяем результат...');
        const totalQuery = `
            SELECT type, COUNT(*) as count 
            FROM filter_options 
            GROUP BY type 
            ORDER BY type
        `;
        
        const totalResult = await pool.query(totalQuery);
        console.log('📋 Итого в таблице:');
        totalResult.rows.forEach(row => {
            console.log(`   ${row.type}: ${row.count} записей`);
        });
        
        // Показываем примеры
        const examplesQuery = `
            SELECT type, value, display_name 
            FROM filter_options 
            ORDER BY type, display_name 
            LIMIT 15
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

populateFilterOptions();


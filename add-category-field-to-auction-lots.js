const { Pool } = require('pg');

// Импортируем конфигурацию
const config = require('./config');

// Конфигурация базы данных Supabase
const dbConfig = config.dbConfig;

async function addCategoryField() {
    const pool = new Pool(dbConfig);
    
    try {
        console.log('🔧 Добавляем поле category в таблицу auction_lots...');
        
        // Проверяем, существует ли уже поле category
        const checkFieldQuery = `
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'auction_lots' 
            AND column_name = 'category'
        `;
        
        const checkResult = await pool.query(checkFieldQuery);
        
        if (checkResult.rows.length > 0) {
            console.log('✅ Поле category уже существует в таблице auction_lots');
            return;
        }
        
        // Добавляем поле category
        const addFieldQuery = `
            ALTER TABLE auction_lots 
            ADD COLUMN category VARCHAR(50)
        `;
        
        await pool.query(addFieldQuery);
        console.log('✅ Поле category успешно добавлено в таблицу auction_lots');
        
        // Создаем индекс для поля category для ускорения поиска
        const createIndexQuery = `
            CREATE INDEX IF NOT EXISTS idx_auction_lots_category 
            ON auction_lots(category)
        `;
        
        await pool.query(createIndexQuery);
        console.log('✅ Индекс для поля category создан');
        
        // Проверяем структуру таблицы
        const structureQuery = `
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns 
            WHERE table_name = 'auction_lots' 
            ORDER BY ordinal_position
        `;
        
        const structureResult = await pool.query(structureQuery);
        console.log('\n📋 Структура таблицы auction_lots:');
        structureResult.rows.forEach(row => {
            console.log(`  ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable})`);
        });
        
        // Проверяем количество записей
        const countQuery = 'SELECT COUNT(*) as total FROM auction_lots';
        const countResult = await pool.query(countQuery);
        console.log(`\n📊 Всего записей в таблице: ${countResult.rows[0].total}`);
        
    } catch (error) {
        console.error('❌ Ошибка при добавлении поля category:', error);
        throw error;
    } finally {
        await pool.end();
    }
}

// Запускаем скрипт
addCategoryField().catch(console.error);

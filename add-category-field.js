const { Pool } = require('pg');
const config = require('./config');

async function addCategoryField() {
    const pool = new Pool(config.dbConfig);
    
    try {
        console.log('🔧 Добавляем поле category в таблицу coin_catalog...');
        
        // Проверяем, существует ли уже поле category
        const checkQuery = `
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'coin_catalog' 
            AND column_name = 'category'
        `;
        
        const checkResult = await pool.query(checkQuery);
        
        if (checkResult.rows.length > 0) {
            console.log('✅ Поле category уже существует');
        } else {
            // Добавляем поле category
            const addColumnQuery = `
                ALTER TABLE coin_catalog 
                ADD COLUMN category VARCHAR(20) DEFAULT 'other'
            `;
            
            await pool.query(addColumnQuery);
            console.log('✅ Поле category добавлено');
        }
        
        // Создаем индекс для быстрого поиска по категориям
        const createIndexQuery = `
            CREATE INDEX IF NOT EXISTS idx_coin_catalog_category 
            ON coin_catalog(category)
        `;
        
        await pool.query(createIndexQuery);
        console.log('✅ Индекс для поля category создан');
        
        // Проверяем результат
        const verifyQuery = `
            SELECT column_name, data_type, column_default
            FROM information_schema.columns 
            WHERE table_name = 'coin_catalog' 
            AND column_name = 'category'
        `;
        
        const verifyResult = await pool.query(verifyQuery);
        if (verifyResult.rows.length > 0) {
            const column = verifyResult.rows[0];
            console.log(`✅ Поле category: ${column.data_type}, по умолчанию: ${column.column_default}`);
        }
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    } finally {
        await pool.end();
    }
}

addCategoryField();

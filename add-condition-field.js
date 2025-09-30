const { Pool } = require('pg');
const config = require('./config');

async function addConditionField() {
    const pool = new Pool(config.dbConfig);
    
    try {
        console.log('🔧 Добавляем поле condition в таблицу user_collections...');
        
        // Добавляем поле condition
        await pool.query(`
            ALTER TABLE user_collections 
            ADD COLUMN IF NOT EXISTS condition VARCHAR(50) DEFAULT 'XF'
        `);
        
        console.log('✅ Поле condition добавлено в таблицу user_collections');
        
        // Обновляем существующие записи
        await pool.query(`
            UPDATE user_collections 
            SET condition = 'XF' 
            WHERE condition IS NULL OR condition = ''
        `);
        
        console.log('✅ Существующие записи обновлены');
        
    } catch (error) {
        console.error('❌ Ошибка добавления поля condition:', error);
    } finally {
        await pool.end();
    }
}

addConditionField();

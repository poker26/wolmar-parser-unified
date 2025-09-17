const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool(config.dbConfig);

async function addWeightField() {
    try {
        console.log('🔄 Добавляем поле weight в таблицу auction_lots...');
        
        const addWeightFieldQuery = `
            ALTER TABLE auction_lots 
            ADD COLUMN IF NOT EXISTS weight DECIMAL(10,3);
        `;
        
        await pool.query(addWeightFieldQuery);
        console.log('✅ Поле weight успешно добавлено в таблицу auction_lots');
        
        // Проверяем, что поле добавлено
        const checkFieldQuery = `
            SELECT column_name, data_type, is_nullable 
            FROM information_schema.columns 
            WHERE table_name = 'auction_lots' 
            AND column_name = 'weight';
        `;
        
        const result = await pool.query(checkFieldQuery);
        if (result.rows.length > 0) {
            console.log('📊 Информация о поле weight:', result.rows[0]);
        }
        
    } catch (error) {
        console.error('❌ Ошибка при добавлении поля weight:', error);
    } finally {
        await pool.end();
    }
}

addWeightField();

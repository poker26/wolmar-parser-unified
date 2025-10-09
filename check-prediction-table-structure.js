const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool(config.dbConfig);

async function checkPredictionTableStructure() {
    try {
        // Проверяем структуру таблицы lot_price_predictions
        const tableInfo = await pool.query(`
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns 
            WHERE table_name = 'lot_price_predictions'
            ORDER BY ordinal_position
        `);
        
        console.log('📋 Структура таблицы lot_price_predictions:');
        tableInfo.rows.forEach(row => {
            console.log(`  - ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable})`);
        });
        
        // Проверяем, есть ли данные в таблице
        const countResult = await pool.query(`
            SELECT COUNT(*) as total_count,
                   COUNT(CASE WHEN created_at IS NOT NULL THEN 1 END) as with_created_at
            FROM lot_price_predictions
        `);
        
        console.log('\n📊 Статистика таблицы lot_price_predictions:');
        console.log(`  - Всего записей: ${countResult.rows[0].total_count}`);
        console.log(`  - С датой создания: ${countResult.rows[0].with_created_at}`);
        
        // Проверяем несколько записей с датами
        const sampleResult = await pool.query(`
            SELECT lot_id, predicted_price, created_at
            FROM lot_price_predictions
            WHERE created_at IS NOT NULL
            ORDER BY created_at DESC
            LIMIT 5
        `);
        
        console.log('\n📅 Примеры записей с датами:');
        sampleResult.rows.forEach((row, index) => {
            console.log(`  ${index + 1}. Лот ${row.lot_id}: ${row.predicted_price}₽ (создан: ${row.created_at})`);
        });
        
    } catch (error) {
        console.error('❌ Ошибка:', error);
    } finally {
        await pool.end();
    }
}

checkPredictionTableStructure();

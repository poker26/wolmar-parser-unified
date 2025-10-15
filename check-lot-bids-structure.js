const { Pool } = require('pg');
const config = require('./config');

async function checkLotBidsStructure() {
    console.log('🔍 ПРОВЕРКА СТРУКТУРЫ ТАБЛИЦЫ lot_bids');
    console.log('=====================================');
    
    const pool = new Pool(config.database);
    
    try {
        console.log('\n1️⃣ Подключаемся к базе данных...');
        
        console.log('\n2️⃣ Проверяем структуру таблицы lot_bids...');
        const result = await pool.query(`
            SELECT column_name, data_type, is_nullable 
            FROM information_schema.columns 
            WHERE table_name = 'lot_bids' 
            ORDER BY ordinal_position
        `);
        
        console.log('📊 Структура таблицы lot_bids:');
        result.rows.forEach((row, index) => {
            console.log(`   ${index + 1}. ${row.column_name} (${row.data_type}) - ${row.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}`);
        });
        
        console.log('\n3️⃣ Проверяем существующие данные...');
        const countResult = await pool.query('SELECT COUNT(*) as count FROM lot_bids');
        console.log(`📊 Всего записей в lot_bids: ${countResult.rows[0].count}`);
        
        if (countResult.rows[0].count > 0) {
            const sampleResult = await pool.query('SELECT * FROM lot_bids LIMIT 3');
            console.log('\n📋 Примеры записей:');
            sampleResult.rows.forEach((row, index) => {
                console.log(`   ${index + 1}. ${JSON.stringify(row, null, 2)}`);
            });
        }
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    } finally {
        await pool.end();
    }
}

if (require.main === module) {
    checkLotBidsStructure();
}

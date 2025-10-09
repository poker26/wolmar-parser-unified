const { Pool } = require('pg');
const config = require('./config.js');

async function checkLot3374Id() {
    const pool = new Pool(config.dbConfig);
    
    try {
        const result = await pool.query("SELECT id FROM auction_lots WHERE lot_number = '3374' AND auction_number = '970'");
        console.log('🔍 ID лота 3374:', result.rows[0]?.id);
        
        // Проверим, есть ли этот ID в наших тестовых данных
        const testIds = [90224, 63217, 63219, 63220, 63221, 63222, 63223, 63224, 63225, 63226];
        const lot3374Id = result.rows[0]?.id;
        
        if (testIds.includes(lot3374Id)) {
            console.log('✅ Лот 3374 есть в наших тестовых данных');
        } else {
            console.log('❌ Лот 3374 НЕТ в наших тестовых данных');
            console.log('📋 Наши тестовые ID:', testIds);
            console.log('📋 ID лота 3374:', lot3374Id);
        }
        
    } catch (error) {
        console.error('Ошибка:', error);
    } finally {
        await pool.end();
    }
}

checkLot3374Id();

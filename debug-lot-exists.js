const { Pool } = require('pg');
const config = require('./config');

async function debugLotExists() {
    console.log('🔍 ДИАГНОСТИКА ПРОВЕРКИ СУЩЕСТВОВАНИЯ ЛОТОВ');
    console.log('==========================================');
    
    const pool = new Pool(config.dbConfig);
    
    try {
        console.log('\n1️⃣ Подключаемся к базе данных...');
        
        // Тестируем лот 4316, который парсер говорит "уже существует"
        const lotNumber = '4316';
        
        console.log(`\n2️⃣ Проверяем лот ${lotNumber} с разными номерами аукционов...`);
        
        // Проверяем с auction_number = "2070" (внутренний Wolmar ID)
        const result2070 = await pool.query(`
            SELECT auction_number, lot_number, category, coin_description
            FROM auction_lots 
            WHERE auction_number = '2070' AND lot_number = $1
        `, [lotNumber]);
        console.log(`📊 Лот ${lotNumber} с auction_number = "2070": ${result2070.rows.length} записей`);
        if (result2070.rows.length > 0) {
            result2070.rows.forEach(row => {
                console.log(`   Аукцион: ${row.auction_number} | Категория: ${row.category} | Описание: ${row.coin_description?.substring(0, 50)}...`);
            });
        }
        
        // Проверяем с auction_number = "914" (реальный номер аукциона)
        const result914 = await pool.query(`
            SELECT auction_number, lot_number, category, coin_description
            FROM auction_lots 
            WHERE auction_number = '914' AND lot_number = $1
        `, [lotNumber]);
        console.log(`📊 Лот ${lotNumber} с auction_number = "914": ${result914.rows.length} записей`);
        if (result914.rows.length > 0) {
            result914.rows.forEach(row => {
                console.log(`   Аукцион: ${row.auction_number} | Категория: ${row.category} | Описание: ${row.coin_description?.substring(0, 50)}...`);
            });
        }
        
        // Проверяем лот 4316 в любом аукционе
        const resultAny = await pool.query(`
            SELECT auction_number, lot_number, category, coin_description
            FROM auction_lots 
            WHERE lot_number = $1
        `, [lotNumber]);
        console.log(`📊 Лот ${lotNumber} в любом аукционе: ${resultAny.rows.length} записей`);
        if (resultAny.rows.length > 0) {
            resultAny.rows.forEach(row => {
                console.log(`   Аукцион: ${row.auction_number} | Категория: ${row.category} | Описание: ${row.coin_description?.substring(0, 50)}...`);
            });
        }
        
        console.log(`\n3️⃣ Проверяем лот 4317 (следующий в логах)...`);
        const lotNumber2 = '4317';
        
        const result4317 = await pool.query(`
            SELECT auction_number, lot_number, category, coin_description
            FROM auction_lots 
            WHERE lot_number = $1
        `, [lotNumber2]);
        console.log(`📊 Лот ${lotNumber2} в любом аукционе: ${result4317.rows.length} записей`);
        if (result4317.rows.length > 0) {
            result4317.rows.forEach(row => {
                console.log(`   Аукцион: ${row.auction_number} | Категория: ${row.category} | Описание: ${row.coin_description?.substring(0, 50)}...`);
            });
        }
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
        console.error('❌ Стек ошибки:', error.stack);
    } finally {
        await pool.end();
    }
}

if (require.main === module) {
    debugLotExists();
}

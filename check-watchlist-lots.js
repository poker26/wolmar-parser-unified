const { Pool } = require('pg');
const config = require('./config.js');

async function checkWatchlist() {
    const pool = new Pool(config.dbConfig);
    
    try {
        // Проверяем структуру таблицы user_sessions
        const tableInfo = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'user_sessions'
            ORDER BY ordinal_position
        `);
        
        console.log('📋 Структура таблицы user_sessions:');
        tableInfo.rows.forEach(col => {
            console.log(`  - ${col.column_name}: ${col.data_type}`);
        });
        
        // Проверяем, есть ли данные в localStorage
        const sessionsResult = await pool.query(`
            SELECT * 
            FROM user_sessions 
            LIMIT 1
        `);
        
        if (sessionsResult.rows.length === 0) {
            console.log('❌ Нет данных в localStorage');
            return;
        }
        
        const localStorageData = sessionsResult.rows[0].localStorage_data;
        console.log('📱 localStorage данные:', localStorageData);
        
        // Парсим ID лотов
        const lotIds = localStorageData.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
        console.log('📊 Найдено лотов в избранном:', lotIds.length);
        console.log('📋 ID лотов:', lotIds);
        
        if (lotIds.length === 0) {
            console.log('❌ Нет валидных ID лотов');
            return;
        }
        
        // Получаем информацию о лотах
        const lotsResult = await pool.query(`
            SELECT id, lot_number, auction_number, coin_description, metal, condition, year, weight
            FROM auction_lots 
            WHERE id = ANY($1)
            ORDER BY id
        `, [lotIds]);
        
        console.log(`📚 Найдено в базе: ${lotsResult.rows.length} лотов`);
        
        lotsResult.rows.forEach((lot, index) => {
            console.log(`${index + 1}. Лот ${lot.lot_number} (аукцион ${lot.auction_number}): ${lot.metal} ${lot.condition} ${lot.year}г.`);
            console.log(`   Описание: ${lot.coin_description?.substring(0, 80)}...`);
            console.log(`   Вес: ${lot.weight || 'не указан'}`);
            console.log('');
        });
        
    } catch (error) {
        console.error('❌ Ошибка:', error);
    } finally {
        await pool.end();
    }
}

checkWatchlist();

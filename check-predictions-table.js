const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool(config.dbConfig);

async function checkPredictions() {
    try {
        // Проверяем структуру таблицы
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
        
        // Проверяем последние записи
        const recentPredictions = await pool.query(`
            SELECT lot_id, predicted_price, created_at
            FROM lot_price_predictions
            ORDER BY created_at DESC
            LIMIT 5
        `);
        
        console.log('\n📅 Последние 5 прогнозов:');
        recentPredictions.rows.forEach((row, index) => {
            const date = new Date(row.created_at).toLocaleString('ru-RU');
            console.log(`  ${index + 1}. Лот ${row.lot_id}: ${row.predicted_price}₽ (создан: ${date})`);
        });
        
        // Проверяем, есть ли лоты в избранном
        const watchlistLots = await pool.query(`
            SELECT w.lot_id, w.user_id, w.added_at
            FROM watchlist w
            ORDER BY w.added_at DESC
        `);
        
        console.log('\n📊 Лоты в избранном:');
        watchlistLots.rows.forEach((row, index) => {
            const date = new Date(row.added_at).toLocaleString('ru-RU');
            console.log(`  ${index + 1}. Лот ${row.lot_id} (пользователь ${row.user_id}, добавлен: ${date})`);
        });
        
        // Проверяем, есть ли прогнозы для лотов из избранного
        if (watchlistLots.rows.length > 0) {
            const lotIds = watchlistLots.rows.map(row => row.lot_id);
            const watchlistPredictions = await pool.query(`
                SELECT w.lot_id, lpp.predicted_price, lpp.created_at
                FROM watchlist w
                LEFT JOIN lot_price_predictions lpp ON w.lot_id = lpp.lot_id
                WHERE w.lot_id = ANY($1)
                ORDER BY lpp.created_at DESC
            `, [lotIds]);
            
            console.log('\n📊 Прогнозы для лотов из избранного:');
            watchlistPredictions.rows.forEach((row, index) => {
                const date = row.created_at ? new Date(row.created_at).toLocaleString('ru-RU') : 'Нет прогноза';
                console.log(`  ${index + 1}. Лот ${row.lot_id}: ${row.predicted_price || 'Нет'}₽ (создан: ${date})`);
            });
        }
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    } finally {
        await pool.end();
    }
}

checkPredictions();

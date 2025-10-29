const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool(config.dbConfig);

async function checkWinnerRatingsTable() {
    try {
        console.log('🔍 Проверяем структуру таблицы winner_ratings...');
        
        // Проверяем структуру таблицы
        const structure = await pool.query(`
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns 
            WHERE table_name = 'winner_ratings'
            ORDER BY ordinal_position;
        `);
        
        console.log('\n📋 Структура таблицы winner_ratings:');
        structure.rows.forEach(row => {
            console.log(`  - ${row.column_name}: ${row.data_type} (${row.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'})`);
        });
        
        // Проверяем количество записей
        const count = await pool.query('SELECT COUNT(*) as total FROM winner_ratings');
        console.log(`\n📊 Всего записей в таблице: ${count.rows[0].total}`);
        
        // Проверяем записи с новыми колонками
        const newColumns = await pool.query(`
            SELECT 
                COUNT(*) as total_users,
                COUNT(CASE WHEN suspicious_score > 0 THEN 1 END) as users_with_suspicious_score,
                COUNT(CASE WHEN fast_bids_score > 0 THEN 1 END) as users_with_fast_bids_score,
                COUNT(CASE WHEN autobid_traps_score > 0 THEN 1 END) as users_with_autobid_traps_score,
                COUNT(CASE WHEN last_analysis_date IS NOT NULL THEN 1 END) as users_with_analysis_date
            FROM winner_ratings
        `);
        
        console.log('\n📈 Статистика по новым колонкам:');
        console.log(`  - Пользователей с suspicious_score > 0: ${newColumns.rows[0].users_with_suspicious_score}`);
        console.log(`  - Пользователей с fast_bids_score > 0: ${newColumns.rows[0].users_with_fast_bids_score}`);
        console.log(`  - Пользователей с autobid_traps_score > 0: ${newColumns.rows[0].users_with_autobid_traps_score}`);
        console.log(`  - Пользователей с last_analysis_date: ${newColumns.rows[0].users_with_analysis_date}`);
        
        // Проверяем примеры записей
        const samples = await pool.query(`
            SELECT 
                winner_login,
                suspicious_score,
                fast_bids_score,
                autobid_traps_score,
                manipulation_score,
                last_analysis_date,
                rating,
                category
            FROM winner_ratings 
            WHERE suspicious_score > 0 OR fast_bids_score > 0 OR autobid_traps_score > 0
            ORDER BY suspicious_score DESC
            LIMIT 5
        `);
        
        console.log('\n📋 Примеры записей с новыми данными:');
        samples.rows.forEach((row, index) => {
            console.log(`  ${index + 1}. ${row.winner_login}:`);
            console.log(`     - suspicious_score: ${row.suspicious_score}`);
            console.log(`     - fast_bids_score: ${row.fast_bids_score}`);
            console.log(`     - autobid_traps_score: ${row.autobid_traps_score}`);
            console.log(`     - manipulation_score: ${row.manipulation_score}`);
            console.log(`     - last_analysis_date: ${row.last_analysis_date}`);
            console.log(`     - rating: ${row.rating} (${row.category})`);
        });
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    } finally {
        await pool.end();
    }
}

checkWinnerRatingsTable();




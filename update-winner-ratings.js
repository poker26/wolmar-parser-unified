const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool(config.dbConfig);

async function addAnalyticsColumns() {
    try {
        console.log('🔧 Добавляем новые колонки для аналитики...');
        
        // Добавляем колонки для скоринга подозрительности
        await pool.query(`ALTER TABLE winner_ratings ADD COLUMN IF NOT EXISTS suspicious_score INTEGER DEFAULT 0;`);
        await pool.query(`ALTER TABLE winner_ratings ADD COLUMN IF NOT EXISTS fast_bids_score INTEGER DEFAULT 0;`);
        await pool.query(`ALTER TABLE winner_ratings ADD COLUMN IF NOT EXISTS autobid_traps_score INTEGER DEFAULT 0;`);
        await pool.query(`ALTER TABLE winner_ratings ADD COLUMN IF NOT EXISTS manipulation_score INTEGER DEFAULT 0;`);
        await pool.query(`ALTER TABLE winner_ratings ADD COLUMN IF NOT EXISTS last_analysis_date TIMESTAMP DEFAULT NULL;`);
        
        console.log('✅ Новые колонки добавлены успешно');
        
        // Проверяем текущее состояние таблицы
        const stats = await pool.query(`
            SELECT 
                COUNT(*) as total_users,
                COUNT(CASE WHEN suspicious_score > 0 THEN 1 END) as users_with_scores,
                MIN(updated_at) as oldest_update,
                MAX(updated_at) as newest_update
            FROM winner_ratings
        `);
        
        console.log('\n📊 Текущее состояние таблицы winner_ratings:');
        console.log(`  - Всего пользователей: ${stats.rows[0].total_users}`);
        console.log(`  - С баллами подозрительности: ${stats.rows[0].users_with_scores}`);
        console.log(`  - Последнее обновление: ${stats.rows[0].newest_update}`);
        
        // Проверяем количество уникальных победителей в auction_lots
        const winnersCount = await pool.query(`
            SELECT COUNT(DISTINCT winner_login) as unique_winners
            FROM auction_lots 
            WHERE winner_login IS NOT NULL 
            AND winner_login != ''
            AND winning_bid IS NOT NULL 
            AND winning_bid > 0
        `);
        
        console.log(`  - Уникальных победителей в auction_lots: ${winnersCount.rows[0].unique_winners}`);
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    } finally {
        await pool.end();
    }
}

addAnalyticsColumns();

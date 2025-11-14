const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool(config.dbConfig);

async function resetLinkedAccountsScores() {
    try {
        console.log('🔄 Обнуляем linked_accounts_score для всех пользователей...');
        
        // Обнуляем linked_accounts_score
        const updateQuery = `
            UPDATE winner_ratings 
            SET linked_accounts_score = 0
            WHERE linked_accounts_score IS NOT NULL AND linked_accounts_score != 0
        `;
        
        const result = await pool.query(updateQuery);
        
        console.log(`✅ Обновлено записей: ${result.rowCount}`);
        
        // Пересчитываем suspicious_score для всех пользователей
        console.log('🔄 Пересчитываем suspicious_score...');
        
        const recalculateQuery = `
            UPDATE winner_ratings 
            SET suspicious_score = 
                -- Критичные (×1.5)
                (COALESCE(linked_accounts_score, 0) * 1.5) +
                (COALESCE(carousel_score, 0) * 1.5) +
                (COALESCE(self_boost_score, 0) * 1.5) +
                -- Высокие (×1.2)
                (COALESCE(decoy_tactics_score, 0) * 1.2) +
                (COALESCE(pricing_strategies_score, 0) * 1.2) +
                (COALESCE(circular_buyers_score, 0) * 1.2) +
                -- Средние (×1.0)
                (COALESCE(fast_bids_score, 0) * 1.0) +
                (COALESCE(autobid_traps_score, 0) * 1.0) +
                (COALESCE(abandonment_score, 0) * 1.0) +
                -- Низкие (×0.8)
                (COALESCE(technical_bidders_score, 0) * 0.8)
        `;
        
        const recalculateResult = await pool.query(recalculateQuery);
        console.log(`✅ Пересчитано suspicious_score для ${recalculateResult.rowCount} пользователей`);
        
        // Показываем статистику
        const statsQuery = `
            SELECT 
                COUNT(*) as total_users,
                COUNT(CASE WHEN linked_accounts_score > 0 THEN 1 END) as users_with_score,
                SUM(linked_accounts_score) as total_score
            FROM winner_ratings
        `;
        
        const statsResult = await pool.query(statsQuery);
        const stats = statsResult.rows[0];
        
        console.log('\n📊 Статистика после обнуления:');
        console.log(`   Всего пользователей: ${stats.total_users}`);
        console.log(`   Пользователей с linked_accounts_score > 0: ${stats.users_with_score}`);
        console.log(`   Общая сумма linked_accounts_score: ${stats.total_score || 0}`);
        
        console.log('\n✅ Обнуление завершено успешно!');
        
    } catch (error) {
        console.error('❌ Ошибка обнуления linked_accounts_score:', error);
        throw error;
    } finally {
        await pool.end();
    }
}

// Запускаем обнуление
resetLinkedAccountsScores()
    .then(() => {
        console.log('✅ Скрипт завершен');
        process.exit(0);
    })
    .catch(error => {
        console.error('❌ Критическая ошибка:', error);
        process.exit(1);
    });


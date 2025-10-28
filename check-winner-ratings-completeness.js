const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool(config.dbConfig);

async function checkWinnerRatingsCompleteness() {
    try {
        console.log('🔍 Проверяем полноту данных в таблице winner_ratings...');
        
        // 1. Считаем уникальных победителей в auction_lots
        const uniqueWinnersInLots = await pool.query(`
            SELECT COUNT(DISTINCT winner_login) as unique_winners
            FROM auction_lots 
            WHERE winner_login IS NOT NULL 
            AND winner_login != ''
            AND winning_bid IS NOT NULL 
            AND winning_bid > 0
        `);
        
        console.log(`\n📊 Уникальных победителей в auction_lots: ${uniqueWinnersInLots.rows[0].unique_winners}`);
        
        // 2. Считаем пользователей в winner_ratings
        const usersInRatings = await pool.query(`
            SELECT COUNT(*) as total_users
            FROM winner_ratings
        `);
        
        console.log(`📊 Пользователей в winner_ratings: ${usersInRatings.rows[0].total_users}`);
        
        // 3. Находим пользователей, которых нет в winner_ratings
        const missingUsers = await pool.query(`
            SELECT DISTINCT al.winner_login
            FROM auction_lots al
            WHERE al.winner_login IS NOT NULL 
            AND al.winner_login != ''
            AND al.winning_bid IS NOT NULL 
            AND al.winning_bid > 0
            AND NOT EXISTS (
                SELECT 1 FROM winner_ratings wr 
                WHERE wr.winner_login = al.winner_login
            )
            ORDER BY al.winner_login
            LIMIT 20
        `);
        
        console.log(`\n❌ Пользователей НЕТ в winner_ratings: ${missingUsers.rows.length}`);
        if (missingUsers.rows.length > 0) {
            console.log('📋 Примеры отсутствующих пользователей:');
            missingUsers.rows.forEach((user, index) => {
                console.log(`  ${index + 1}. ${user.winner_login}`);
            });
        }
        
        // 4. Проверяем статистику по датам
        const dateStats = await pool.query(`
            SELECT 
                MIN(auction_end_date) as earliest_auction,
                MAX(auction_end_date) as latest_auction,
                COUNT(DISTINCT auction_number) as total_auctions
            FROM auction_lots 
            WHERE auction_end_date IS NOT NULL
        `);
        
        console.log(`\n📅 Статистика по аукционам:`);
        console.log(`  - Самый ранний аукцион: ${dateStats.rows[0].earliest_auction}`);
        console.log(`  - Самый поздний аукцион: ${dateStats.rows[0].latest_auction}`);
        console.log(`  - Всего аукционов: ${dateStats.rows[0].total_auctions}`);
        
        // 5. Проверяем даты обновления в winner_ratings
        const ratingsDateStats = await pool.query(`
            SELECT 
                MIN(updated_at) as earliest_update,
                MAX(updated_at) as latest_update,
                COUNT(CASE WHEN updated_at IS NOT NULL THEN 1 END) as users_with_updates
            FROM winner_ratings
        `);
        
        console.log(`\n📅 Статистика по winner_ratings:`);
        console.log(`  - Самое раннее обновление: ${ratingsDateStats.rows[0].earliest_update}`);
        console.log(`  - Самое позднее обновление: ${ratingsDateStats.rows[0].latest_update}`);
        console.log(`  - Пользователей с обновлениями: ${ratingsDateStats.rows[0].users_with_updates}`);
        
        // 6. Находим пользователей из недавних аукционов
        const recentUsers = await pool.query(`
            SELECT DISTINCT al.winner_login, al.auction_number, al.auction_end_date
            FROM auction_lots al
            WHERE al.winner_login IS NOT NULL 
            AND al.winner_login != ''
            AND al.winning_bid IS NOT NULL 
            AND al.winning_bid > 0
            AND al.auction_end_date > '2024-01-01'
            AND NOT EXISTS (
                SELECT 1 FROM winner_ratings wr 
                WHERE wr.winner_login = al.winner_login
            )
            ORDER BY al.auction_end_date DESC
            LIMIT 10
        `);
        
        console.log(`\n🆕 Пользователи из аукционов 2024+ (отсутствуют в winner_ratings): ${recentUsers.rows.length}`);
        if (recentUsers.rows.length > 0) {
            console.log('📋 Примеры:');
            recentUsers.rows.forEach((user, index) => {
                console.log(`  ${index + 1}. ${user.winner_login} (аукцион ${user.auction_number}, ${user.auction_end_date})`);
            });
        }
        
        // 7. Рекомендации
        const missingCount = missingUsers.rows.length;
        if (missingCount > 0) {
            console.log(`\n⚠️  РЕКОМЕНДАЦИИ:`);
            console.log(`  - В таблице winner_ratings отсутствует ${missingCount} пользователей`);
            console.log(`  - Необходимо запустить массовое обновление рейтингов`);
            console.log(`  - Команда: node update-all-ratings.js`);
        } else {
            console.log(`\n✅ Все пользователи присутствуют в winner_ratings!`);
        }
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    } finally {
        await pool.end();
    }
}

checkWinnerRatingsCompleteness();

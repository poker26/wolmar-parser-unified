const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool(config.dbConfig);

async function updateAllRatings() {
    try {
        console.log('🔄 Начинаем массовое обновление рейтингов...');
        
        // Получаем всех уникальных победителей
        const winnersQuery = `
            SELECT DISTINCT winner_login 
            FROM auction_lots 
            WHERE winner_login IS NOT NULL 
            AND winner_login != ''
            AND winning_bid IS NOT NULL 
            AND winning_bid > 0
            ORDER BY winner_login
        `;
        
        const result = await pool.query(winnersQuery);
        const winners = result.rows.map(row => row.winner_login);
        
        console.log(`📊 Найдено ${winners.length} победителей для обновления рейтингов`);
        
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
        
        let updated = 0;
        let errors = 0;
        
        for (const winnerLogin of winners) {
            try {
                await updateWinnerRating(winnerLogin);
                updated++;
                
                if (updated % 100 === 0) {
                    console.log(`📈 Обновлено ${updated}/${winners.length} рейтингов`);
                }
                
            } catch (error) {
                errors++;
                console.error(`❌ Ошибка обновления рейтинга для ${winnerLogin}:`, error.message);
            }
        }
        
        console.log(`✅ Массовое обновление завершено: ${updated} успешно, ${errors} ошибок`);
        
    } catch (error) {
        console.error('❌ Ошибка массового обновления рейтингов:', error);
    } finally {
        await pool.end();
    }
}

async function updateWinnerRating(winnerLogin) {
    try {
        // Получаем статистику
        const stats = await pool.query(`
            SELECT 
                winner_login,
                COUNT(*) as total_lots,
                SUM(winning_bid) as total_spent,
                AVG(winning_bid) as avg_lot_price,
                MAX(winning_bid) as max_lot_price,
                COUNT(DISTINCT auction_number) as unique_auctions,
                MIN(auction_end_date) as first_auction_date,
                MAX(auction_end_date) as last_auction_date
            FROM auction_lots 
            WHERE winner_login = $1 
            AND winning_bid IS NOT NULL 
            AND winning_bid > 0
            GROUP BY winner_login
        `, [winnerLogin]);
        
        if (stats.rows.length === 0) {
            return null;
        }
        
        const winnerData = stats.rows[0];
        
        // Рассчитываем рейтинг
        const rating = calculateRating(winnerData);
        const category = getRatingCategory(rating);
        const activityDays = winnerData.first_auction_date && winnerData.last_auction_date 
            ? Math.round((new Date(winnerData.last_auction_date) - new Date(winnerData.first_auction_date)) / (1000 * 60 * 60 * 24))
            : 0;

        // Сохраняем/обновляем рейтинг
        const upsertQuery = `
            INSERT INTO winner_ratings (
                winner_login, total_spent, total_lots, unique_auctions,
                avg_lot_price, max_lot_price, first_auction_date, last_auction_date,
                activity_days, rating, category, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
            ON CONFLICT (winner_login) DO UPDATE SET
                total_spent = EXCLUDED.total_spent,
                total_lots = EXCLUDED.total_lots,
                unique_auctions = EXCLUDED.unique_auctions,
                avg_lot_price = EXCLUDED.avg_lot_price,
                max_lot_price = EXCLUDED.max_lot_price,
                first_auction_date = EXCLUDED.first_auction_date,
                last_auction_date = EXCLUDED.last_auction_date,
                activity_days = EXCLUDED.activity_days,
                rating = EXCLUDED.rating,
                category = EXCLUDED.category,
                updated_at = NOW()
        `;

        await pool.query(upsertQuery, [
            winnerLogin,
            winnerData.total_spent,
            winnerData.total_lots,
            winnerData.unique_auctions,
            winnerData.avg_lot_price,
            winnerData.max_lot_price,
            winnerData.first_auction_date,
            winnerData.last_auction_date,
            activityDays,
            rating,
            category.category
        ]);

    } catch (error) {
        console.error(`Ошибка обновления рейтинга для ${winnerLogin}:`, error);
        throw error;
    }
}

function calculateRating(winnerData) {
    const {
        total_spent,
        total_lots,
        unique_auctions,
        avg_lot_price,
        max_lot_price,
        first_auction_date,
        last_auction_date
    } = winnerData;

    // Временной фактор (активность в днях)
    const daysActive = first_auction_date && last_auction_date 
        ? (new Date(last_auction_date) - new Date(first_auction_date)) / (1000 * 60 * 60 * 24)
        : 0;
    const activityScore = Math.min(100, (daysActive / 365) * 100); // 1 год = 100 баллов

    // Факторы с нормализацией (0-100) на основе реальных данных
    const factors = {
        // Траты: 10М = 100 баллов (для самых топовых), 5М = 50 баллов, 1М = 10 баллов
        spending: Math.min(100, (total_spent / 10000000) * 100),
        
        // Лоты: 100 = 100 баллов, 50 = 50 баллов, 20 = 20 баллов
        volume: Math.min(100, (total_lots / 100) * 100),
        
        // Аукционы: 10 = 100 баллов, 5 = 50 баллов, 2 = 20 баллов
        diversity: Math.min(100, (unique_auctions / 10) * 100),
        
        // Средняя цена: 500К = 100 баллов, 100К = 20 баллов, 10К = 2 балла
        consistency: Math.min(100, (avg_lot_price / 500000) * 100),
        
        // Активность во времени
        activity: activityScore
    };

    // Взвешенная сумма
    const rating = Math.round(
        factors.spending * 0.35 +      // 35% - общая сумма
        factors.volume * 0.25 +         // 25% - количество лотов
        factors.diversity * 0.15 +      // 15% - разнообразие аукционов
        factors.consistency * 0.15 +   // 15% - средняя цена лота
        factors.activity * 0.10        // 10% - активность во времени
    );

    return Math.max(1, Math.min(100, rating));
}

function getRatingCategory(rating) {
    if (rating >= 85) return { category: 'Эксперт', color: '#FFD700', icon: '👑' };
    if (rating >= 70) return { category: 'Профи', color: '#C0C0C0', icon: '🥇' };
    if (rating >= 50) return { category: 'Опытный', color: '#CD7F32', icon: '🥈' };
    if (rating >= 30) return { category: 'Активный', color: '#4CAF50', icon: '🥉' };
    if (rating >= 15) return { category: 'Начинающий', color: '#2196F3', icon: '⭐' };
    return { category: 'Новичок', color: '#9E9E9E', icon: '🌱' };
}

updateAllRatings();




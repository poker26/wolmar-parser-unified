const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool(config.dbConfig);

class WinnerRatingsService {
    constructor() {
        this.pool = pool;
    }

    // Создание таблицы для рейтингов победителей
    async createRatingsTable() {
        try {
            const createTableQuery = `
                CREATE TABLE IF NOT EXISTS winner_ratings (
                    id SERIAL PRIMARY KEY,
                    winner_login VARCHAR(100) UNIQUE NOT NULL,
                    total_spent DECIMAL(15, 2) DEFAULT 0,
                    total_lots INTEGER DEFAULT 0,
                    unique_auctions INTEGER DEFAULT 0,
                    avg_lot_price DECIMAL(12, 2) DEFAULT 0,
                    max_lot_price DECIMAL(12, 2) DEFAULT 0,
                    first_auction_date TIMESTAMP,
                    last_auction_date TIMESTAMP,
                    activity_days INTEGER DEFAULT 0,
                    rating INTEGER DEFAULT 1,
                    category VARCHAR(20) DEFAULT 'Новичок',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            `;
            
            await this.pool.query(createTableQuery);
            console.log('✅ Таблица winner_ratings создана/проверена');
            
            // Создаем индекс для быстрого поиска
            await this.pool.query(`
                CREATE INDEX IF NOT EXISTS idx_winner_ratings_login ON winner_ratings(winner_login);
            `);
            
        } catch (error) {
            console.error('Ошибка создания таблицы рейтингов:', error);
            throw error;
        }
    }

    // Получение статистики победителя
    async getWinnerStats(winnerLogin) {
        try {
            const statsQuery = `
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
            `;
            
            const result = await this.pool.query(statsQuery, [winnerLogin]);
            return result.rows[0] || null;
            
        } catch (error) {
            console.error('Ошибка получения статистики победителя:', error);
            throw error;
        }
    }

    // Расчет рейтинга по многофакторной модели
    calculateRating(winnerData) {
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

    // Определение категории рейтинга (обновленные пороги)
    getRatingCategory(rating) {
        if (rating >= 85) return { category: 'Эксперт', color: '#FFD700', icon: '👑' };      // 8М+ трат
        if (rating >= 70) return { category: 'Профи', color: '#C0C0C0', icon: '🥇' };        // 5М+ трат
        if (rating >= 50) return { category: 'Опытный', color: '#CD7F32', icon: '🥈' };      // 2М+ трат
        if (rating >= 30) return { category: 'Активный', color: '#4CAF50', icon: '🥉' };      // 1М+ трат
        if (rating >= 15) return { category: 'Начинающий', color: '#2196F3', icon: '⭐' };    // 500К+ трат
        return { category: 'Новичок', color: '#9E9E9E', icon: '🌱' };                        // <500К трат
    }

    // Обновление рейтинга победителя
    async updateWinnerRating(winnerLogin) {
        try {
            // Получаем статистику
            const stats = await this.getWinnerStats(winnerLogin);
            if (!stats) {
                console.log(`Победитель ${winnerLogin} не найден или нет данных`);
                return null;
            }

            // Рассчитываем рейтинг
            const rating = this.calculateRating(stats);
            const category = this.getRatingCategory(rating);
            const activityDays = stats.first_auction_date && stats.last_auction_date 
                ? Math.round((new Date(stats.last_auction_date) - new Date(stats.first_auction_date)) / (1000 * 60 * 60 * 24))
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

            await this.pool.query(upsertQuery, [
                winnerLogin,
                stats.total_spent,
                stats.total_lots,
                stats.unique_auctions,
                stats.avg_lot_price,
                stats.max_lot_price,
                stats.first_auction_date,
                stats.last_auction_date,
                activityDays,
                rating,
                category.category
            ]);

            console.log(`✅ Рейтинг обновлен для ${winnerLogin}: ${rating} (${category.category})`);
            
            return {
                winnerLogin,
                rating,
                category: category.category,
                color: category.color,
                icon: category.icon,
                stats
            };

        } catch (error) {
            console.error(`Ошибка обновления рейтинга для ${winnerLogin}:`, error);
            throw error;
        }
    }

    // Получение рейтинга победителя
    async getWinnerRating(winnerLogin) {
        try {
            const query = `
                SELECT rating, category, total_spent, total_lots, unique_auctions,
                       suspicious_score, fast_bids_score, autobid_traps_score, manipulation_score
                FROM winner_ratings 
                WHERE winner_login = $1
            `;
            
            const result = await this.pool.query(query, [winnerLogin]);
            if (result.rows.length === 0) {
                return null;
            }

            const rating = result.rows[0];
            const category = this.getRatingCategory(rating.rating);
            
            // Определяем уровень подозрительности
            let suspiciousLevel = null;
            if (rating.suspicious_score > 0) {
                if (rating.suspicious_score >= 80) {
                    suspiciousLevel = {
                        level: 'КРИТИЧЕСКИ ПОДОЗРИТЕЛЬНО',
                        color: '#dc2626', // red-600
                        icon: '⚠️'
                    };
                } else if (rating.suspicious_score >= 50) {
                    suspiciousLevel = {
                        level: 'ПОДОЗРИТЕЛЬНО',
                        color: '#ea580c', // orange-600
                        icon: '🔍'
                    };
                } else if (rating.suspicious_score >= 30) {
                    suspiciousLevel = {
                        level: 'ВНИМАНИЕ',
                        color: '#d97706', // amber-600
                        icon: '👁️'
                    };
                } else {
                    suspiciousLevel = {
                        level: 'НИЗКИЙ РИСК',
                        color: '#16a34a', // green-600
                        icon: '✅'
                    };
                }
            }
            
            return {
                rating: rating.rating,
                category: category.category,
                color: category.color,
                icon: category.icon,
                totalSpent: rating.total_spent,
                totalLots: rating.total_lots,
                uniqueAuctions: rating.unique_auctions,
                suspiciousScore: rating.suspicious_score,
                suspiciousLevel: suspiciousLevel,
                fastBidsScore: rating.fast_bids_score,
                autobidTrapsScore: rating.autobid_traps_score,
                manipulationScore: rating.manipulation_score
            };

        } catch (error) {
            console.error(`Ошибка получения рейтинга для ${winnerLogin}:`, error);
            throw error;
        }
    }

    // Массовое обновление всех рейтингов
    async updateAllRatings() {
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
            
            const result = await this.pool.query(winnersQuery);
            const winners = result.rows.map(row => row.winner_login);
            
            console.log(`📊 Найдено ${winners.length} победителей для обновления рейтингов`);
            
            let updated = 0;
            let errors = 0;
            
            for (const winnerLogin of winners) {
                try {
                    await this.updateWinnerRating(winnerLogin);
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
            
            return { updated, errors, total: winners.length };

        } catch (error) {
            console.error('Ошибка массового обновления рейтингов:', error);
            throw error;
        }
    }

    // Получение топ победителей по рейтингу
    async getTopWinners(limit = 20) {
        try {
            const query = `
                SELECT 
                    winner_login,
                    rating,
                    category,
                    total_spent,
                    total_lots,
                    unique_auctions
                FROM winner_ratings 
                ORDER BY rating DESC, total_spent DESC
                LIMIT $1
            `;
            
            const result = await this.pool.query(query, [limit]);
            
            return result.rows.map(row => ({
                winnerLogin: row.winner_login,
                rating: row.rating,
                category: this.getRatingCategory(row.rating),
                totalSpent: row.total_spent,
                totalLots: row.total_lots,
                uniqueAuctions: row.unique_auctions
            }));

        } catch (error) {
            console.error('Ошибка получения топ победителей:', error);
            throw error;
        }
    }
}

module.exports = WinnerRatingsService;

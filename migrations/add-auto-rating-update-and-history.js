const { Pool } = require('pg');
const config = require('../config');

const pool = new Pool({
    ...config.dbConfig,
    statement_timeout: 300000, // 5 минут для длительных операций
    query_timeout: 300000
});

/**
 * Миграция: Автоматическое обновление рейтингов и история изменений
 * 
 * Создает:
 * 1. Таблицу rating_history для аудита изменений рейтингов
 * 2. SQL-функцию для расчета финансового рейтинга
 * 3. Триггер для автоматического обновления рейтинга при изменении auction_lots
 */
async function addAutoRatingUpdateAndHistory() {
    try {
        console.log('🚀 Создание системы автоматического обновления рейтингов...\n');
        
        // Шаг 1: Создаем таблицу для истории изменений рейтинга
        console.log('📊 Шаг 1: Создание таблицы rating_history...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS rating_history (
                id SERIAL PRIMARY KEY,
                winner_login VARCHAR(100) NOT NULL,
                rating INTEGER NOT NULL,
                category VARCHAR(20) NOT NULL,
                total_spent DECIMAL(15, 2),
                total_lots INTEGER,
                unique_auctions INTEGER,
                avg_lot_price DECIMAL(12, 2),
                max_lot_price DECIMAL(12, 2),
                activity_days INTEGER,
                changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                change_reason VARCHAR(100) DEFAULT 'auto_update'
            );
        `);
        console.log('✅ Таблица rating_history создана');
        
        // Создаем индексы для быстрого поиска
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_rating_history_login ON rating_history(winner_login);
            CREATE INDEX IF NOT EXISTS idx_rating_history_changed_at ON rating_history(changed_at DESC);
        `);
        console.log('✅ Индексы для rating_history созданы');
        
        // Шаг 2: Создаем SQL-функцию для расчета финансового рейтинга
        console.log('\n📊 Шаг 2: Создание функции calculate_financial_rating...');
        await pool.query(`
            CREATE OR REPLACE FUNCTION calculate_financial_rating(
                p_total_spent DECIMAL,
                p_total_lots INTEGER,
                p_unique_auctions INTEGER,
                p_avg_lot_price DECIMAL,
                p_max_lot_price DECIMAL,
                p_first_auction_date TIMESTAMP,
                p_last_auction_date TIMESTAMP
            ) RETURNS INTEGER AS $$
            DECLARE
                v_days_active DECIMAL;
                v_activity_score DECIMAL;
                v_spending_score DECIMAL;
                v_volume_score DECIMAL;
                v_diversity_score DECIMAL;
                v_consistency_score DECIMAL;
                v_rating INTEGER;
            BEGIN
                -- Временной фактор (активность в днях)
                IF p_first_auction_date IS NOT NULL AND p_last_auction_date IS NOT NULL THEN
                    v_days_active := EXTRACT(EPOCH FROM (p_last_auction_date - p_first_auction_date)) / 86400.0;
                    v_activity_score := LEAST(100, (v_days_active / 365.0) * 100);
                ELSE
                    v_days_active := 0;
                    v_activity_score := 0;
                END IF;
                
                -- Факторы с нормализацией (0-100)
                -- Траты: 10М = 100 баллов, 5М = 50 баллов, 1М = 10 баллов
                v_spending_score := LEAST(100, (COALESCE(p_total_spent, 0) / 10000000.0) * 100);
                
                -- Лоты: 100 = 100 баллов, 50 = 50 баллов, 20 = 20 баллов
                v_volume_score := LEAST(100, (COALESCE(p_total_lots, 0)::DECIMAL / 100.0) * 100);
                
                -- Аукционы: 10 = 100 баллов, 5 = 50 баллов, 2 = 20 баллов
                v_diversity_score := LEAST(100, (COALESCE(p_unique_auctions, 0)::DECIMAL / 10.0) * 100);
                
                -- Средняя цена: 500К = 100 баллов, 100К = 20 баллов, 10К = 2 балла
                v_consistency_score := LEAST(100, (COALESCE(p_avg_lot_price, 0) / 500000.0) * 100);
                
                -- Взвешенная сумма
                v_rating := ROUND(
                    v_spending_score * 0.35 +      -- 35% - общая сумма
                    v_volume_score * 0.25 +       -- 25% - количество лотов
                    v_diversity_score * 0.15 +    -- 15% - разнообразие аукционов
                    v_consistency_score * 0.15 +  -- 15% - средняя цена лота
                    v_activity_score * 0.10       -- 10% - активность во времени
                );
                
                -- Ограничиваем диапазон 1-100
                RETURN GREATEST(1, LEAST(100, v_rating));
            END;
            $$ LANGUAGE plpgsql;
        `);
        console.log('✅ Функция calculate_financial_rating создана');
        
        // Шаг 3: Создаем функцию для определения категории рейтинга
        console.log('\n📊 Шаг 3: Создание функции get_rating_category...');
        await pool.query(`
            CREATE OR REPLACE FUNCTION get_rating_category(p_rating INTEGER) RETURNS VARCHAR(20) AS $$
            BEGIN
                IF p_rating >= 80 THEN
                    RETURN 'VIP';
                ELSIF p_rating >= 60 THEN
                    RETURN 'Премиум';
                ELSIF p_rating >= 40 THEN
                    RETURN 'Стандарт';
                ELSIF p_rating >= 20 THEN
                    RETURN 'Базовый';
                ELSE
                    RETURN 'Новичок';
                END IF;
            END;
            $$ LANGUAGE plpgsql;
        `);
        console.log('✅ Функция get_rating_category создана');
        
        // Шаг 4: Создаем функцию для обновления рейтинга победителя
        console.log('\n📊 Шаг 4: Создание функции update_winner_rating...');
        await pool.query(`
            CREATE OR REPLACE FUNCTION update_winner_rating(p_winner_login VARCHAR(100)) RETURNS VOID AS $$
            DECLARE
                v_stats RECORD;
                v_rating INTEGER;
                v_category VARCHAR(20);
                v_activity_days INTEGER;
                v_old_rating INTEGER;
                v_old_category VARCHAR(20);
            BEGIN
                -- Получаем статистику победителя
                SELECT 
                    COUNT(*)::INTEGER as total_lots,
                    COALESCE(SUM(winning_bid), 0) as total_spent,
                    COUNT(DISTINCT auction_number)::INTEGER as unique_auctions,
                    COALESCE(AVG(winning_bid), 0) as avg_lot_price,
                    COALESCE(MAX(winning_bid), 0) as max_lot_price,
                    MIN(auction_end_date) as first_auction_date,
                    MAX(auction_end_date) as last_auction_date
                INTO v_stats
                FROM auction_lots 
                WHERE winner_login = p_winner_login
                  AND winning_bid IS NOT NULL 
                  AND winning_bid > 0;
                
                -- Если нет данных, выходим
                IF v_stats.total_lots = 0 THEN
                    RETURN;
                END IF;
                
                -- Рассчитываем активность в днях
                IF v_stats.first_auction_date IS NOT NULL AND v_stats.last_auction_date IS NOT NULL THEN
                    v_activity_days := EXTRACT(EPOCH FROM (v_stats.last_auction_date - v_stats.first_auction_date)) / 86400;
                ELSE
                    v_activity_days := 0;
                END IF;
                
                -- Рассчитываем рейтинг
                v_rating := calculate_financial_rating(
                    v_stats.total_spent,
                    v_stats.total_lots,
                    v_stats.unique_auctions,
                    v_stats.avg_lot_price,
                    v_stats.max_lot_price,
                    v_stats.first_auction_date,
                    v_stats.last_auction_date
                );
                
                -- Определяем категорию
                v_category := get_rating_category(v_rating);
                
                -- Получаем старые значения для истории (если есть)
                SELECT rating, category INTO v_old_rating, v_old_category
                FROM winner_ratings
                WHERE winner_login = p_winner_login;
                
                -- Обновляем или создаем запись в winner_ratings
                INSERT INTO winner_ratings (
                    winner_login, 
                    total_spent, 
                    total_lots, 
                    unique_auctions,
                    avg_lot_price, 
                    max_lot_price, 
                    first_auction_date, 
                    last_auction_date,
                    activity_days, 
                    rating, 
                    category, 
                    updated_at
                ) VALUES (
                    p_winner_login,
                    v_stats.total_spent,
                    v_stats.total_lots,
                    v_stats.unique_auctions,
                    v_stats.avg_lot_price,
                    v_stats.max_lot_price,
                    v_stats.first_auction_date,
                    v_stats.last_auction_date,
                    v_activity_days,
                    v_rating,
                    v_category,
                    NOW()
                )
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
                    updated_at = NOW();
                
                -- Сохраняем в историю только если рейтинг изменился
                IF v_old_rating IS NULL OR v_old_rating != v_rating OR v_old_category != v_category THEN
                    INSERT INTO rating_history (
                        winner_login,
                        rating,
                        category,
                        total_spent,
                        total_lots,
                        unique_auctions,
                        avg_lot_price,
                        max_lot_price,
                        activity_days,
                        change_reason
                    ) VALUES (
                        p_winner_login,
                        v_rating,
                        v_category,
                        v_stats.total_spent,
                        v_stats.total_lots,
                        v_stats.unique_auctions,
                        v_stats.avg_lot_price,
                        v_stats.max_lot_price,
                        v_activity_days,
                        'auto_update'
                    );
                END IF;
            END;
            $$ LANGUAGE plpgsql;
        `);
        console.log('✅ Функция update_winner_rating создана');
        
        // Шаг 5: Создаем функцию-триггер
        console.log('\n📊 Шаг 5: Создание функции-триггера...');
        await pool.query(`
            CREATE OR REPLACE FUNCTION update_winner_rating_trigger() RETURNS TRIGGER AS $$
            BEGIN
                -- Обновляем рейтинг для нового победителя
                IF NEW.winner_login IS NOT NULL AND NEW.winner_login != '' THEN
                    PERFORM update_winner_rating(NEW.winner_login);
                END IF;
                
                -- Если изменился winner_login, обновляем рейтинг для старого победителя тоже
                IF TG_OP = 'UPDATE' AND OLD.winner_login IS NOT NULL AND OLD.winner_login != '' 
                   AND OLD.winner_login != NEW.winner_login THEN
                    PERFORM update_winner_rating(OLD.winner_login);
                END IF;
                
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql;
        `);
        console.log('✅ Функция-триггер update_winner_rating_trigger создана');
        
        // Создаем триггер для автоматического обновления рейтинга
        console.log('\n📊 Шаг 6: Создание триггера для автоматического обновления...');
        
        // Удаляем старый триггер, если существует (без проверки существования, чтобы избежать блокировок)
        try {
            await pool.query(`
                DROP TRIGGER IF EXISTS trigger_auto_update_winner_rating ON auction_lots;
            `);
        } catch (error) {
            console.log('   Предупреждение: не удалось удалить старый триггер (возможно, его не было)');
        }
        
        // Создаем триггер с более простым условием
        try {
            await pool.query(`
                CREATE TRIGGER trigger_auto_update_winner_rating
                AFTER INSERT OR UPDATE OF winner_login, winning_bid, auction_end_date ON auction_lots
                FOR EACH ROW
                WHEN (NEW.winner_login IS NOT NULL AND NEW.winner_login != '' AND NEW.winning_bid IS NOT NULL AND NEW.winning_bid > 0)
                EXECUTE FUNCTION update_winner_rating_trigger();
            `);
            console.log('✅ Триггер trigger_auto_update_winner_rating создан');
        } catch (error) {
            // Если триггер уже существует, это не критично
            if (error.code === '42P07') {
                console.log('   Триггер уже существует, пропускаем создание');
            } else {
                throw error;
            }
        }
        
        // Шаг 7: Пересчитываем рейтинги для всех существующих победителей (батчами)
        console.log('\n📊 Шаг 7: Пересчет рейтингов для всех существующих победителей...');
        const updateResult = await pool.query(`
            SELECT DISTINCT winner_login 
            FROM auction_lots 
            WHERE winner_login IS NOT NULL 
              AND winner_login != '' 
              AND winning_bid IS NOT NULL 
              AND winning_bid > 0
            ORDER BY winner_login
        `);
        
        console.log(`   Найдено ${updateResult.rows.length} победителей для пересчета...`);
        console.log('   Пересчет будет выполнен батчами по 50 пользователей...');
        
        let updated = 0;
        const batchSize = 50;
        
        for (let i = 0; i < updateResult.rows.length; i += batchSize) {
            const batch = updateResult.rows.slice(i, i + batchSize);
            console.log(`   Обрабатываем батч ${Math.floor(i / batchSize) + 1} (${batch.length} пользователей)...`);
            
            for (const row of batch) {
                try {
                    await pool.query('SELECT update_winner_rating($1)', [row.winner_login]);
                    updated++;
                } catch (error) {
                    console.error(`   Ошибка при обновлении рейтинга для ${row.winner_login}:`, error.message);
                }
            }
            
            // Небольшая пауза между батчами
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        console.log(`✅ Пересчитано рейтингов: ${updated}`);
        
        // Шаг 8: Проверяем результаты
        console.log('\n📊 Шаг 8: Проверка результатов...');
        const stats = await pool.query(`
            SELECT 
                COUNT(*) as total_users,
                COUNT(CASE WHEN rating >= 80 THEN 1 END) as vip_users,
                COUNT(CASE WHEN rating >= 60 AND rating < 80 THEN 1 END) as premium_users,
                COUNT(CASE WHEN rating >= 40 AND rating < 60 THEN 1 END) as standard_users,
                COUNT(CASE WHEN rating >= 20 AND rating < 40 THEN 1 END) as basic_users,
                COUNT(CASE WHEN rating < 20 THEN 1 END) as newbie_users,
                COUNT(*) FILTER (WHERE updated_at >= NOW() - INTERVAL '1 hour') as recently_updated
            FROM winner_ratings
        `);
        
        const s = stats.rows[0];
        console.log('\n📈 Статистика рейтингов:');
        console.log(`   Всего пользователей: ${s.total_users}`);
        console.log(`   VIP (80+): ${s.vip_users}`);
        console.log(`   Премиум (60-79): ${s.premium_users}`);
        console.log(`   Стандарт (40-59): ${s.standard_users}`);
        console.log(`   Базовый (20-39): ${s.basic_users}`);
        console.log(`   Новичок (<20): ${s.newbie_users}`);
        console.log(`   Обновлено за последний час: ${s.recently_updated}`);
        
        const historyStats = await pool.query(`
            SELECT COUNT(*) as total_history_records
            FROM rating_history
        `);
        console.log(`\n📜 Записей в истории изменений: ${historyStats.rows[0].total_history_records}`);
        
        console.log('\n✅ Миграция завершена успешно!');
        
    } catch (error) {
        console.error('❌ Ошибка при выполнении миграции:', error);
        throw error;
    } finally {
        await pool.end();
    }
}

if (require.main === module) {
    addAutoRatingUpdateAndHistory()
        .then(() => {
            console.log('\n✅ Скрипт завершен');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n❌ Критическая ошибка:', error);
            process.exit(1);
        });
}

module.exports = { addAutoRatingUpdateAndHistory };


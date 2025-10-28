const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.ANALYTICS_PORT || 3002;

// Настройка CORS
app.use(cors());
app.use(express.json());

// Статические файлы
app.use(express.static('public'));

// Подключение к базе данных (Supabase)
const pool = new Pool({
    user: 'postgres.xkwgspqwebfeteoblayu',
    host: 'aws-0-eu-north-1.pooler.supabase.com',
    database: 'postgres',
    password: 'Gopapopa326+',
    port: 6543,
    ssl: {
        rejectUnauthorized: false
    },
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    max: 10,
    allowExitOnIdle: true
});

// Проверка подключения к БД
pool.on('connect', () => {
    console.log('🔗 Analytics Service: Подключение к базе данных установлено');
});

pool.on('error', (err) => {
    console.error('❌ Analytics Service: Ошибка подключения к БД:', err);
});

// API для получения статистики дашборда
app.get('/api/analytics/dashboard-stats', async (req, res) => {
    try {
        const queries = {
            totalBids: 'SELECT COUNT(*) as count FROM lot_bids',
            totalLots: 'SELECT COUNT(*) as count FROM auction_lots',
            totalBidders: 'SELECT COUNT(DISTINCT bidder_login) as count FROM lot_bids',
            manualBids: 'SELECT COUNT(*) as count FROM lot_bids WHERE is_auto_bid = false',
            autobids: 'SELECT COUNT(*) as count FROM lot_bids WHERE is_auto_bid = true'
        };
        
        const results = {};
        for (const [key, query] of Object.entries(queries)) {
            const result = await pool.query(query);
            results[key] = parseInt(result.rows[0].count);
        }
        
        results.manualBidPercentage = results.totalBids > 0 
            ? Math.round((results.manualBids / results.totalBids) * 100) 
            : 0;
        
        res.json({
            success: true,
            data: results
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения статистики дашборда:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Ошибка получения статистики дашборда',
            details: error.message 
        });
    }
});

// API для анализа быстрых ручных ставок
app.get('/api/analytics/fast-manual-bids', async (req, res) => {
    try {
        const query = `
            WITH suspicious_users AS (
                -- Получаем уже выявленных подозрительных пользователей
                SELECT winner_login
                FROM winner_ratings 
                WHERE fast_bids_score > 0
            ),
            lots_with_suspicious_users AS (
                -- Находим лоты, где участвовали подозрительные пользователи
                SELECT DISTINCT lot_id
                FROM lot_bids 
                WHERE bidder_login IN (SELECT winner_login FROM suspicious_users)
            ),
            manual_bids_only AS (
                SELECT 
                    lot_id,
                    auction_number,
                    lot_number,
                    bidder_login,
                    bid_amount,
                    bid_timestamp,
                    is_auto_bid
                FROM lot_bids 
                WHERE is_auto_bid = false
                  AND lot_id IN (SELECT lot_id FROM lots_with_suspicious_users)
            ),
            bid_intervals AS (
                SELECT 
                    lot_id,
                    auction_number,
                    lot_number,
                    bidder_login,
                    bid_amount,
                    bid_timestamp,
                    is_auto_bid,
                    LAG(bid_timestamp) OVER (PARTITION BY lot_id ORDER BY bid_timestamp) as prev_bid_timestamp,
                    LAG(bidder_login) OVER (PARTITION BY lot_id ORDER BY bid_timestamp) as prev_bidder_login,
                    EXTRACT(EPOCH FROM (bid_timestamp - LAG(bid_timestamp) OVER (PARTITION BY lot_id ORDER BY bid_timestamp))) as seconds_between_bids
                FROM manual_bids_only
            )
            SELECT 
                bidder_login,
                COUNT(*) as suspicious_bids_count,
                MIN(seconds_between_bids) as fastest_interval,
                ROUND(AVG(seconds_between_bids), 2) as avg_interval,
                COUNT(CASE WHEN seconds_between_bids < 1 THEN 1 END) as critical_count,
                COUNT(CASE WHEN seconds_between_bids < 5 THEN 1 END) as suspicious_count,
                COUNT(CASE WHEN seconds_between_bids < 30 THEN 1 END) as warning_count,
                CASE 
                    WHEN COUNT(CASE WHEN seconds_between_bids < 1 THEN 1 END) > 0 THEN 'КРИТИЧЕСКИ ПОДОЗРИТЕЛЬНО'
                    WHEN COUNT(CASE WHEN seconds_between_bids < 5 THEN 1 END) > 5 THEN 'ПОДОЗРИТЕЛЬНО'
                    WHEN COUNT(*) > 10 THEN 'ВНИМАНИЕ'
                    ELSE 'НОРМА'
                END as risk_level
            FROM bid_intervals
            WHERE seconds_between_bids < 30
              AND seconds_between_bids IS NOT NULL
            GROUP BY bidder_login
            ORDER BY 
                CASE 
                    WHEN COUNT(CASE WHEN seconds_between_bids < 1 THEN 1 END) > 0 THEN 1
                    WHEN COUNT(CASE WHEN seconds_between_bids < 5 THEN 1 END) > 5 THEN 2
                    WHEN COUNT(*) > 10 THEN 3
                    ELSE 4
                END ASC,
                suspicious_bids_count DESC,
                critical_count DESC,
                suspicious_count DESC;
        `;
        
        const { rows } = await pool.query(query);
        
        // Обновляем fast_bids_score в winner_ratings
        console.log(`📊 Найдено ${rows.length} пользователей с быстрыми ставками, обновляем скоринг...`);
        
        // Если нет подозрительных пользователей, делаем полный анализ
        if (rows.length === 0) {
            console.log('⚠️ Подозрительных пользователей не найдено, выполняем полный анализ...');
            
            const fullAnalysisQuery = `
                WITH manual_bids_only AS (
                    SELECT 
                        lot_id,
                        auction_number,
                        lot_number,
                        bidder_login,
                        bid_amount,
                        bid_timestamp,
                        is_auto_bid
                    FROM lot_bids 
                    WHERE is_auto_bid = false
                      AND lot_id IN (
                        SELECT lot_id 
                        FROM lot_bids 
                        WHERE is_auto_bid = false
                        GROUP BY lot_id 
                        HAVING COUNT(*) > 3
                      )
                ),
                bid_intervals AS (
                    SELECT 
                        lot_id,
                        auction_number,
                        lot_number,
                        bidder_login,
                        bid_amount,
                        bid_timestamp,
                        is_auto_bid,
                        LAG(bid_timestamp) OVER (PARTITION BY lot_id ORDER BY bid_timestamp) as prev_bid_timestamp,
                        LAG(bidder_login) OVER (PARTITION BY lot_id ORDER BY bid_timestamp) as prev_bidder_login,
                        EXTRACT(EPOCH FROM (bid_timestamp - LAG(bid_timestamp) OVER (PARTITION BY lot_id ORDER BY bid_timestamp))) as seconds_between_bids
                    FROM manual_bids_only
                )
                SELECT 
                    bidder_login,
                    COUNT(*) as suspicious_bids_count,
                    MIN(seconds_between_bids) as fastest_interval,
                    ROUND(AVG(seconds_between_bids), 2) as avg_interval,
                    COUNT(CASE WHEN seconds_between_bids < 1 THEN 1 END) as critical_count,
                    COUNT(CASE WHEN seconds_between_bids < 5 THEN 1 END) as suspicious_count,
                    COUNT(CASE WHEN seconds_between_bids < 30 THEN 1 END) as warning_count,
                    CASE 
                        WHEN COUNT(CASE WHEN seconds_between_bids < 1 THEN 1 END) > 0 THEN 'КРИТИЧЕСКИ ПОДОЗРИТЕЛЬНО'
                        WHEN COUNT(CASE WHEN seconds_between_bids < 5 THEN 1 END) > 5 THEN 'ПОДОЗРИТЕЛЬНО'
                        WHEN COUNT(*) > 10 THEN 'ВНИМАНИЕ'
                        ELSE 'НОРМА'
                    END as risk_level
                FROM bid_intervals
                WHERE seconds_between_bids < 30
                  AND seconds_between_bids IS NOT NULL
                GROUP BY bidder_login
                ORDER BY 
                    CASE 
                        WHEN COUNT(CASE WHEN seconds_between_bids < 1 THEN 1 END) > 0 THEN 1
                        WHEN COUNT(CASE WHEN seconds_between_bids < 5 THEN 1 END) > 5 THEN 2
                        WHEN COUNT(*) > 10 THEN 3
                        ELSE 4
                    END ASC,
                    suspicious_bids_count DESC,
                    critical_count DESC,
                    suspicious_count DESC;
            `;
            
            const fullAnalysisResult = await pool.query(fullAnalysisQuery);
            rows.push(...fullAnalysisResult.rows);
            console.log(`📊 Полный анализ: найдено ${fullAnalysisResult.rows.length} дополнительных пользователей`);
        }
        
        for (const user of rows) {
            let fastBidsScore = 0;
            
            if (user.critical_count > 0) {
                fastBidsScore = 50; // Максимальный балл за критические ставки
            } else if (user.suspicious_count > 5) {
                fastBidsScore = 30; // Высокий балл за подозрительные ставки
            } else if (user.suspicious_bids_count > 10) {
                fastBidsScore = 15; // Средний балл за много быстрых ставок
            }
            
            // Обновляем или создаем запись в winner_ratings
            await pool.query(`
                INSERT INTO winner_ratings (winner_login, fast_bids_score, last_analysis_date)
                VALUES ($1, $2, NOW())
                ON CONFLICT (winner_login) DO UPDATE SET
                    fast_bids_score = EXCLUDED.fast_bids_score,
                    last_analysis_date = EXCLUDED.last_analysis_date
            `, [user.bidder_login, fastBidsScore]);
        }
        
        // Обновляем общий скоринг подозрительности
        await pool.query(`
            UPDATE winner_ratings 
            SET suspicious_score = COALESCE(fast_bids_score, 0) + COALESCE(autobid_traps_score, 0) + COALESCE(manipulation_score, 0),
                last_analysis_date = NOW()
        `);
        
        console.log(`✅ Скоринг быстрых ставок обновлен для ${rows.length} пользователей`);
        
        res.json({
            success: true,
            data: rows,
            count: rows.length,
            message: `Обновлен скоринг для ${rows.length} пользователей`
        });
        
    } catch (error) {
        console.error('❌ Ошибка анализа быстрых ручных ставок:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Ошибка анализа быстрых ручных ставок',
            details: error.message 
        });
    }
});

// API для анализа ловушек автобида
app.get('/api/analytics/autobid-traps', async (req, res) => {
    try {
        const query = `
            WITH lot_stats AS (
                SELECT 
                    al.id as lot_id,
                    al.auction_number,
                    al.lot_number,
                    al.winner_login,
                    al.winning_bid,
                    al.starting_bid,
                    al.category,
                    lpp.predicted_price,
                    COUNT(lb.id) as total_bids,
                    COUNT(DISTINCT lb.bidder_login) as unique_bidders,
                    COUNT(CASE WHEN lb.is_auto_bid = true THEN 1 END) as autobid_count,
                    COUNT(CASE WHEN lb.is_auto_bid = false THEN 1 END) as manual_bid_count,
                    MIN(lb.bid_amount) as min_bid,
                    ROUND(al.winning_bid / NULLIF(MIN(lb.bid_amount), 0), 2) as price_multiplier,
                    ROUND(al.winning_bid / NULLIF(lpp.predicted_price, 0), 2) as predicted_price_multiplier
                FROM auction_lots al
                LEFT JOIN lot_bids lb ON al.id = lb.lot_id
                LEFT JOIN lot_price_predictions lpp ON al.id = lpp.lot_id
                WHERE al.winning_bid IS NOT NULL
                  AND al.winning_bid > 0
                  AND lb.bid_amount IS NOT NULL
                  AND lb.bid_amount > 0
                GROUP BY al.id, al.auction_number, al.lot_number, al.winner_login, 
                         al.winning_bid, al.starting_bid, al.category, lpp.predicted_price
                HAVING COUNT(lb.id) > 0
            ),
            winner_autobid_check AS (
                SELECT 
                    ls.*,
                    CASE 
                        WHEN EXISTS (
                            SELECT 1 FROM lot_bids lb 
                            WHERE lb.lot_id = ls.lot_id 
                              AND lb.bidder_login = ls.winner_login 
                              AND lb.is_auto_bid = true
                        ) THEN true 
                        ELSE false 
                    END as winner_used_autobid
                FROM lot_stats ls
            ),
            suspicious_bidders AS (
                SELECT DISTINCT bidder_login
                FROM lot_bids lb
                WHERE lb.is_auto_bid = false
                  AND lb.lot_id IN (
                    SELECT lot_id 
                    FROM lot_bids 
                    WHERE is_auto_bid = false
                    GROUP BY lot_id 
                    HAVING COUNT(*) > 3
                  )
                  AND EXISTS (
                    SELECT 1 FROM lot_bids lb2
                    WHERE lb2.lot_id = lb.lot_id
                      AND lb2.bidder_login = lb.bidder_login
                      AND lb2.bid_timestamp > lb.bid_timestamp
                      AND EXTRACT(EPOCH FROM (lb2.bid_timestamp - lb.bid_timestamp)) < 30
                  )
            ),
            suspicious_lots AS (
                SELECT 
                    wac.*,
                    CASE 
                        WHEN sb.bidder_login IS NOT NULL THEN 'ЕСТЬ_ПОДОЗРИТЕЛЬНЫЙ_УЧАСТНИК'
                        ELSE 'НЕТ_ПОДОЗРИТЕЛЬНЫХ'
                    END as has_suspicious_bidder,
                    CASE 
                        WHEN wac.total_bids >= 15 AND wac.unique_bidders >= 4 AND 
                             wac.winner_used_autobid = true AND wac.predicted_price_multiplier >= 2.0 AND
                             sb.bidder_login IS NOT NULL THEN 'КРИТИЧЕСКИ ПОДОЗРИТЕЛЬНО'
                        WHEN wac.total_bids >= 10 AND wac.unique_bidders >= 3 AND 
                             wac.winner_used_autobid = true AND wac.predicted_price_multiplier >= 1.5 AND
                             sb.bidder_login IS NOT NULL THEN 'ПОДОЗРИТЕЛЬНО'
                        WHEN wac.total_bids >= 8 AND wac.unique_bidders >= 3 AND 
                             wac.winner_used_autobid = true AND wac.predicted_price_multiplier >= 1.2 AND
                             sb.bidder_login IS NOT NULL THEN 'ВНИМАНИЕ'
                        ELSE 'НОРМА'
                    END as risk_level
                FROM winner_autobid_check wac
                LEFT JOIN suspicious_bidders sb ON EXISTS (
                    SELECT 1 FROM lot_bids lb 
                    WHERE lb.lot_id = wac.lot_id 
                      AND lb.bidder_login = sb.bidder_login
                )
            )
            SELECT 
                lot_id,
                auction_number,
                lot_number,
                winner_login,
                winning_bid,
                predicted_price,
                min_bid,
                price_multiplier,
                predicted_price_multiplier,
                total_bids,
                unique_bidders,
                autobid_count,
                manual_bid_count,
                winner_used_autobid,
                has_suspicious_bidder,
                risk_level
            FROM suspicious_lots
            WHERE risk_level != 'НОРМА'
            ORDER BY 
                CASE risk_level
                    WHEN 'КРИТИЧЕСКИ ПОДОЗРИТЕЛЬНО' THEN 1
                    WHEN 'ПОДОЗРИТЕЛЬНО' THEN 2
                    WHEN 'ВНИМАНИЕ' THEN 3
                END,
                predicted_price_multiplier DESC,
                total_bids DESC;
        `;
        
        const { rows } = await pool.query(query);
        
        res.json({
            success: true,
            data: rows,
            count: rows.length
        });
        
    } catch (error) {
        console.error('❌ Ошибка анализа ловушек автобида:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Ошибка анализа ловушек автобида',
            details: error.message 
        });
    }
});

// API для обновления скоринга подозрительности
app.post('/api/analytics/update-suspicious-scores', async (req, res) => {
    try {
        console.log('🔄 Начинаем обновление скоринга подозрительности (только ловушки автобида)...');
        
        // Получаем подозрительные лоты из ловушек автобида
        const autobidTrapsQuery = `
            WITH lot_stats AS (
                SELECT 
                    al.winner_login,
                    al.winning_bid,
                    lpp.predicted_price,
                    COUNT(lb.id) as total_bids,
                    COUNT(DISTINCT lb.bidder_login) as unique_bidders,
                    ROUND(al.winning_bid / NULLIF(lpp.predicted_price, 0), 2) as predicted_price_multiplier
                FROM auction_lots al
                LEFT JOIN lot_bids lb ON al.id = lb.lot_id
                LEFT JOIN lot_price_predictions lpp ON al.id = lpp.lot_id
                WHERE al.winning_bid IS NOT NULL
                  AND al.winning_bid > 0
                  AND lpp.predicted_price IS NOT NULL
                  AND lpp.predicted_price > 0
                GROUP BY al.winner_login, al.winning_bid, lpp.predicted_price
                HAVING COUNT(lb.id) > 0
            ),
            winner_autobid_check AS (
                SELECT 
                    ls.*,
                    CASE 
                        WHEN EXISTS (
                            SELECT 1 FROM lot_bids lb 
                            WHERE lb.lot_id = al.id 
                              AND lb.bidder_login = ls.winner_login 
                              AND lb.is_auto_bid = true
                        ) THEN true 
                        ELSE false 
                    END as winner_used_autobid
                FROM lot_stats ls
                LEFT JOIN auction_lots al ON al.winner_login = ls.winner_login
            )
            SELECT 
                winner_login,
                COUNT(*) as suspicious_lots,
                AVG(predicted_price_multiplier) as avg_price_multiplier,
                MAX(predicted_price_multiplier) as max_price_multiplier
            FROM winner_autobid_check
            WHERE winner_used_autobid = true
              AND predicted_price_multiplier >= 1.5
              AND total_bids >= 8
            GROUP BY winner_login
        `;
        
        const autobidTrapsResult = await pool.query(autobidTrapsQuery);
        
        // Обновляем скоринг для ловушек автобида
        for (const user of autobidTrapsResult.rows) {
            let autobidTrapsScore = 0;
            
            if (user.max_price_multiplier >= 3.0) {
                autobidTrapsScore = 50; // Максимальный балл за очень высокие цены
            } else if (user.max_price_multiplier >= 2.0) {
                autobidTrapsScore = 30; // Высокий балл за высокие цены
            } else if (user.avg_price_multiplier >= 1.5) {
                autobidTrapsScore = 15; // Средний балл за завышенные цены
            }
            
            // Обновляем запись в winner_ratings
            await pool.query(`
                UPDATE winner_ratings 
                SET autobid_traps_score = $2,
                    last_analysis_date = NOW()
                WHERE winner_login = $1
            `, [user.winner_login, autobidTrapsScore]);
        }
        
        // Обновляем общий скоринг подозрительности
        await pool.query(`
            UPDATE winner_ratings 
            SET suspicious_score = COALESCE(fast_bids_score, 0) + COALESCE(autobid_traps_score, 0) + COALESCE(manipulation_score, 0),
                last_analysis_date = NOW()
        `);
        
        // Получаем статистику обновления
        const stats = await pool.query(`
            SELECT 
                COUNT(*) as total_users,
                COUNT(CASE WHEN suspicious_score > 0 THEN 1 END) as suspicious_users,
                COUNT(CASE WHEN fast_bids_score > 0 THEN 1 END) as fast_bids_users,
                COUNT(CASE WHEN autobid_traps_score > 0 THEN 1 END) as autobid_traps_users,
                AVG(suspicious_score) as avg_suspicious_score,
                MAX(suspicious_score) as max_suspicious_score
            FROM winner_ratings
        `);
        
        res.json({
            success: true,
            message: 'Скоринг ловушек автобида обновлен успешно',
            stats: stats.rows[0],
            updated_autobid_traps: autobidTrapsResult.rows.length
        });
        
    } catch (error) {
        console.error('❌ Ошибка обновления скоринга подозрительности:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Ошибка обновления скоринга',
            details: error.message 
        });
    }
});

// API для получения пользователей с высоким скорингом подозрительности
app.get('/api/analytics/suspicious-users', async (req, res) => {
    try {
        const threshold = parseInt(req.query.threshold) || 30;
        
        const query = `
            SELECT 
                winner_login,
                suspicious_score,
                fast_bids_score,
                autobid_traps_score,
                manipulation_score,
                rating,
                category,
                total_spent,
                total_lots,
                last_analysis_date
            FROM winner_ratings
            WHERE suspicious_score >= $1
            ORDER BY suspicious_score DESC, fast_bids_score DESC, autobid_traps_score DESC
            LIMIT 100
        `;
        
        const { rows } = await pool.query(query, [threshold]);
        
        res.json({
            success: true,
            data: rows,
            count: rows.length,
            threshold: threshold
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения подозрительных пользователей:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Ошибка получения подозрительных пользователей',
            details: error.message 
        });
    }
});

// Диагностический API для проверки ловушек автобида
app.get('/api/analytics/autobid-traps-debug', async (req, res) => {
    try {
        // Проверяем базовую статистику
        const basicStats = await pool.query(`
            SELECT 
                COUNT(*) as total_lots,
                COUNT(CASE WHEN winning_bid IS NOT NULL THEN 1 END) as lots_with_winner,
                COUNT(CASE WHEN starting_bid IS NOT NULL AND starting_bid > 0 THEN 1 END) as lots_with_starting_bid,
                AVG(winning_bid) as avg_winning_bid,
                AVG(starting_bid) as avg_starting_bid
            FROM auction_lots
        `);

        // Проверяем лоты с автобидами
        const autobidStats = await pool.query(`
            SELECT 
                COUNT(DISTINCT lb.lot_id) as lots_with_autobids,
                COUNT(CASE WHEN lb.is_auto_bid = true THEN 1 END) as total_autobids
            FROM lot_bids lb
            WHERE lb.is_auto_bid = true
        `);

        // Проверяем лоты с высокой активностью
        const activityStats = await pool.query(`
            SELECT 
                al.id,
                al.auction_number,
                al.lot_number,
                al.winner_login,
                al.winning_bid,
                al.starting_bid,
                COUNT(lb.id) as total_bids,
                COUNT(DISTINCT lb.bidder_login) as unique_bidders,
                ROUND(al.winning_bid / NULLIF(al.starting_bid, 0), 2) as price_multiplier
            FROM auction_lots al
            LEFT JOIN lot_bids lb ON al.id = lb.lot_id
            WHERE al.winning_bid IS NOT NULL
              AND al.starting_bid IS NOT NULL
              AND al.winning_bid > 0
              AND al.starting_bid > 0
            GROUP BY al.id, al.auction_number, al.lot_number, al.winner_login, 
                     al.winning_bid, al.starting_bid
            HAVING COUNT(lb.id) >= 10
            ORDER BY total_bids DESC
            LIMIT 10
        `);

        res.json({
            success: true,
            debug: {
                basic_stats: basicStats.rows[0],
                autobid_stats: autobidStats.rows[0],
                high_activity_lots: activityStats.rows
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка диагностики ловушек автобида:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Ошибка диагностики',
            details: error.message 
        });
    }
});

// Страница аналитики
app.get('/analytics', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'analytics.html'));
});

// Запуск сервера
app.listen(PORT, () => {
    console.log(`🚀 Analytics Service запущен на порту ${PORT}`);
    console.log(`📊 Аналитика доступна по адресу: http://localhost:${PORT}/analytics`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Analytics Service: Получен сигнал завершения, закрываем соединения...');
    await pool.end();
    process.exit(0);
});

module.exports = app;

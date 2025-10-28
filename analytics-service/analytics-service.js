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
        
        const { rows } = await pool.query(query);
        
        res.json({
            success: true,
            data: rows,
            count: rows.length
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
                    COUNT(lb.id) as total_bids,
                    COUNT(DISTINCT lb.bidder_login) as unique_bidders,
                    COUNT(CASE WHEN lb.is_auto_bid = true THEN 1 END) as autobid_count,
                    COUNT(CASE WHEN lb.is_auto_bid = false THEN 1 END) as manual_bid_count,
                    MIN(lb.bid_amount) as min_bid,
                    ROUND(al.winning_bid / NULLIF(MIN(lb.bid_amount), 0), 2) as price_multiplier
                FROM auction_lots al
                LEFT JOIN lot_bids lb ON al.id = lb.lot_id
                WHERE al.winning_bid IS NOT NULL
                  AND al.winning_bid > 0
                  AND lb.bid_amount IS NOT NULL
                  AND lb.bid_amount > 0
                GROUP BY al.id, al.auction_number, al.lot_number, al.winner_login, 
                         al.winning_bid, al.starting_bid, al.category
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
            suspicious_lots AS (
                SELECT 
                    wac.*,
                    CASE 
                        WHEN wac.total_bids >= 15 AND wac.unique_bidders >= 4 AND 
                             wac.winner_used_autobid = true AND wac.price_multiplier >= 2.0 THEN 'КРИТИЧЕСКИ ПОДОЗРИТЕЛЬНО'
                        WHEN wac.total_bids >= 10 AND wac.unique_bidders >= 3 AND 
                             wac.winner_used_autobid = true AND wac.price_multiplier >= 1.5 THEN 'ПОДОЗРИТЕЛЬНО'
                        WHEN wac.total_bids >= 8 AND wac.unique_bidders >= 3 AND 
                             wac.winner_used_autobid = true AND wac.price_multiplier >= 1.2 THEN 'ВНИМАНИЕ'
                        ELSE 'НОРМА'
                    END as risk_level
                FROM winner_autobid_check wac
            )
            SELECT 
                lot_id,
                auction_number,
                lot_number,
                winner_login,
                winning_bid,
                min_bid,
                price_multiplier,
                total_bids,
                unique_bidders,
                autobid_count,
                manual_bid_count,
                winner_used_autobid,
                risk_level
            FROM suspicious_lots
            WHERE risk_level != 'НОРМА'
            ORDER BY 
                CASE risk_level
                    WHEN 'КРИТИЧЕСКИ ПОДОЗРИТЕЛЬНО' THEN 1
                    WHEN 'ПОДОЗРИТЕЛЬНО' THEN 2
                    WHEN 'ВНИМАНИЕ' THEN 3
                END,
                price_multiplier DESC,
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

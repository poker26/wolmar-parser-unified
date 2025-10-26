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

// Подключение к базе данных (используем те же настройки, что и в основном сервисе)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/wolmar_parser',
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Проверка подключения к БД
pool.on('connect', () => {
    console.log('🔗 Analytics Service: Подключение к базе данных установлено');
});

pool.on('error', (err) => {
    console.error('❌ Analytics Service: Ошибка подключения к БД:', err);
});

// ============================================================================
// API ENDPOINTS ДЛЯ АНАЛИЗА ПОДОЗРИТЕЛЬНЫХ СТАВОК
// ============================================================================

// 1. Анализ быстрых ручных ставок
app.get('/api/analytics/fast-manual-bids', async (req, res) => {
    try {
        const { limit = 100, minInterval = 5 } = req.query;
        
        const query = `
            WITH bid_intervals AS (
                SELECT 
                    lb.lot_id,
                    lb.bidder_login,
                    lb.bid_amount,
                    lb.bid_timestamp,
                    lb.is_auto_bid,
                    al.lot_number,
                    al.auction_number,
                    LAG(lb.bid_timestamp) OVER (PARTITION BY lb.lot_id ORDER BY lb.bid_timestamp) as prev_bid_timestamp,
                    EXTRACT(EPOCH FROM (lb.bid_timestamp - LAG(lb.bid_timestamp) OVER (PARTITION BY lb.lot_id ORDER BY lb.bid_timestamp))) as seconds_between_bids
                FROM lot_bids lb
                JOIN auction_lots al ON lb.lot_id = al.id
                WHERE lb.lot_id IN (
                    SELECT lot_id 
                    FROM lot_bids 
                    GROUP BY lot_id 
                    HAVING COUNT(*) > 5
                )
            )
            SELECT 
                lot_id,
                lot_number,
                auction_number,
                bidder_login,
                bid_amount,
                bid_timestamp,
                is_auto_bid,
                seconds_between_bids,
                CASE 
                    WHEN is_auto_bid = false AND seconds_between_bids < 1 THEN 'КРИТИЧЕСКИ ПОДОЗРИТЕЛЬНО'
                    WHEN is_auto_bid = false AND seconds_between_bids < 5 THEN 'ПОДОЗРИТЕЛЬНО'
                    WHEN is_auto_bid = false AND seconds_between_bids < 30 THEN 'ВНИМАНИЕ'
                END as suspicious_level
            FROM bid_intervals
            WHERE is_auto_bid = false 
              AND seconds_between_bids < $1
              AND seconds_between_bids IS NOT NULL
            ORDER BY seconds_between_bids ASC, lot_id, bid_timestamp
            LIMIT $2
        `;
        
        const result = await pool.query(query, [minInterval, limit]);
        
        res.json({
            success: true,
            data: result.rows,
            count: result.rows.length,
            filters: { limit, minInterval }
        });
        
    } catch (error) {
        console.error('❌ Ошибка анализа быстрых ставок:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Ошибка анализа быстрых ставок',
            details: error.message 
        });
    }
});

// 2. Анализ "ловушек автобида"
app.get('/api/analytics/autobid-traps', async (req, res) => {
    try {
        const { limit = 100 } = req.query;
        
        const query = `
            SELECT 
                lb.lot_id,
                al.lot_number,
                al.auction_number,
                lb.bidder_login,
                lb.bid_amount,
                lb.bid_timestamp,
                lb.is_auto_bid,
                al.winning_bid,
                al.winner_login,
                CASE 
                    WHEN lb.is_auto_bid = false AND lb.bid_amount = al.winning_bid THEN 'ПОДОЗРИТЕЛЬНО: ручная ставка = финальная цена'
                    WHEN lb.is_auto_bid = false AND lb.bid_amount = al.winning_bid - 1 THEN 'ПОДОЗРИТЕЛЬНО: ручная ставка = финальная цена - 1'
                    WHEN lb.is_auto_bid = false AND lb.bid_amount > al.winning_bid * 0.95 THEN 'ВНИМАНИЕ: ручная ставка близко к финальной цене'
                END as suspicious_pattern
            FROM lot_bids lb
            JOIN auction_lots al ON lb.lot_id = al.id
            WHERE lb.is_auto_bid = false 
              AND lb.bid_amount >= al.winning_bid * 0.95
              AND al.winning_bid IS NOT NULL
            ORDER BY lb.lot_id, lb.bid_timestamp
            LIMIT $1
        `;
        
        const result = await pool.query(query, [limit]);
        
        res.json({
            success: true,
            data: result.rows,
            count: result.rows.length
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

// 3. Анализ временных паттернов
app.get('/api/analytics/time-patterns', async (req, res) => {
    try {
        const { bidderLogin } = req.query;
        
        let whereClause = 'WHERE is_auto_bid = false';
        let params = [];
        
        if (bidderLogin) {
            whereClause += ' AND bidder_login = $1';
            params.push(bidderLogin);
        }
        
        const query = `
            SELECT 
                bidder_login,
                EXTRACT(HOUR FROM bid_timestamp) as hour_of_day,
                EXTRACT(DOW FROM bid_timestamp) as day_of_week,
                COUNT(*) as manual_bid_count,
                AVG(bid_amount) as avg_bid_amount,
                MIN(bid_amount) as min_bid_amount,
                MAX(bid_amount) as max_bid_amount
            FROM lot_bids
            ${whereClause}
            GROUP BY bidder_login, EXTRACT(HOUR FROM bid_timestamp), EXTRACT(DOW FROM bid_timestamp)
            HAVING COUNT(*) > 5
            ORDER BY bidder_login, hour_of_day
        `;
        
        const result = await pool.query(query, params);
        
        res.json({
            success: true,
            data: result.rows,
            count: result.rows.length
        });
        
    } catch (error) {
        console.error('❌ Ошибка анализа временных паттернов:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Ошибка анализа временных паттернов',
            details: error.message 
        });
    }
});

// 4. Анализ соотношения автобидов к ручным ставкам
app.get('/api/analytics/bid-ratios', async (req, res) => {
    try {
        const { minBids = 10, minManualRatio = 80 } = req.query;
        
        const query = `
            SELECT 
                bidder_login,
                COUNT(*) as total_bids,
                SUM(CASE WHEN is_auto_bid = true THEN 1 ELSE 0 END) as autobid_count,
                SUM(CASE WHEN is_auto_bid = false THEN 1 ELSE 0 END) as manual_bid_count,
                ROUND(
                    SUM(CASE WHEN is_auto_bid = true THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 
                    2
                ) as autobid_percentage,
                ROUND(
                    SUM(CASE WHEN is_auto_bid = false THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 
                    2
                ) as manual_bid_percentage
            FROM lot_bids
            GROUP BY bidder_login
            HAVING COUNT(*) > $1 
              AND SUM(CASE WHEN is_auto_bid = false THEN 1 ELSE 0 END) * 100.0 / COUNT(*) > $2
            ORDER BY manual_bid_percentage DESC
        `;
        
        const result = await pool.query(query, [minBids, minManualRatio]);
        
        res.json({
            success: true,
            data: result.rows,
            count: result.rows.length,
            filters: { minBids, minManualRatio }
        });
        
    } catch (error) {
        console.error('❌ Ошибка анализа соотношения ставок:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Ошибка анализа соотношения ставок',
            details: error.message 
        });
    }
});

// 5. Анализ повторных перебиваний
app.get('/api/analytics/bidder-conflicts', async (req, res) => {
    try {
        const { minConflicts = 3, limit = 100 } = req.query;
        
        const query = `
            WITH bid_sequences AS (
                SELECT 
                    lb.lot_id,
                    lb.bidder_login,
                    lb.bid_amount,
                    lb.bid_timestamp,
                    lb.is_auto_bid,
                    al.lot_number,
                    al.auction_number,
                    ROW_NUMBER() OVER (PARTITION BY lb.lot_id ORDER BY lb.bid_timestamp) as bid_order,
                    LAG(lb.bidder_login) OVER (PARTITION BY lb.lot_id ORDER BY lb.bid_timestamp) as prev_bidder
                FROM lot_bids lb
                JOIN auction_lots al ON lb.lot_id = al.id
            ),
            bidder_pairs AS (
                SELECT 
                    lot_id,
                    lot_number,
                    auction_number,
                    bidder_login,
                    prev_bidder,
                    COUNT(*) as bid_count,
                    MIN(bid_timestamp) as first_bid,
                    MAX(bid_timestamp) as last_bid
                FROM bid_sequences
                WHERE bidder_login != prev_bidder 
                  AND bid_order > 1
                GROUP BY lot_id, lot_number, auction_number, bidder_login, prev_bidder
                HAVING COUNT(*) > $1
            )
            SELECT 
                lot_id,
                lot_number,
                auction_number,
                bidder_login,
                prev_bidder,
                bid_count,
                first_bid,
                last_bid,
                EXTRACT(EPOCH FROM (last_bid - first_bid)) as duration_seconds
            FROM bidder_pairs
            ORDER BY bid_count DESC, lot_id
            LIMIT $2
        `;
        
        const result = await pool.query(query, [minConflicts, limit]);
        
        res.json({
            success: true,
            data: result.rows,
            count: result.rows.length,
            filters: { minConflicts, limit }
        });
        
    } catch (error) {
        console.error('❌ Ошибка анализа конфликтов ставщиков:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Ошибка анализа конфликтов ставщиков',
            details: error.message 
        });
    }
});

// 6. Система скоринга подозрительности
app.get('/api/analytics/suspicious-scoring', async (req, res) => {
    try {
        const { minBids = 20, limit = 100 } = req.query;
        
        const query = `
            WITH user_scores AS (
                SELECT 
                    bidder_login,
                    COUNT(*) as total_bids,
                    SUM(CASE WHEN is_auto_bid = false THEN 1 ELSE 0 END) as manual_bids,
                    -- Быстрые ручные ставки (упрощенная версия)
                    SUM(CASE 
                        WHEN is_auto_bid = false AND 
                             EXTRACT(HOUR FROM bid_timestamp) BETWEEN 22 AND 6 
                        THEN 10 
                        ELSE 0 
                    END) as night_bids_score,
                    
                    -- Высокий процент ручных ставок
                    CASE 
                        WHEN COUNT(*) > 100 AND 
                             SUM(CASE WHEN is_auto_bid = false THEN 1 ELSE 0 END) * 100.0 / COUNT(*) > 80 
                        THEN 20 
                        ELSE 0 
                    END as high_manual_ratio_score
                FROM lot_bids
                GROUP BY bidder_login
                HAVING COUNT(*) > $1
            )
            SELECT 
                bidder_login,
                total_bids,
                manual_bids,
                ROUND(manual_bids * 100.0 / total_bids, 2) as manual_bid_percentage,
                night_bids_score,
                high_manual_ratio_score,
                (night_bids_score + high_manual_ratio_score) as total_suspicious_score,
                CASE 
                    WHEN (night_bids_score + high_manual_ratio_score) > 50 THEN 'ВЫСОКИЙ РИСК'
                    WHEN (night_bids_score + high_manual_ratio_score) > 20 THEN 'СРЕДНИЙ РИСК'
                    ELSE 'НИЗКИЙ РИСК'
                END as risk_level
            FROM user_scores
            ORDER BY total_suspicious_score DESC
            LIMIT $2
        `;
        
        const result = await pool.query(query, [minBids, limit]);
        
        res.json({
            success: true,
            data: result.rows,
            count: result.rows.length,
            filters: { minBids, limit }
        });
        
    } catch (error) {
        console.error('❌ Ошибка скоринга подозрительности:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Ошибка скоринга подозрительности',
            details: error.message 
        });
    }
});

// 7. Общая статистика для дашборда
app.get('/api/analytics/dashboard-stats', async (req, res) => {
    try {
        const queries = {
            totalBids: 'SELECT COUNT(*) as count FROM lot_bids',
            totalLots: 'SELECT COUNT(*) as count FROM auction_lots',
            totalBidders: 'SELECT COUNT(DISTINCT bidder_login) as count FROM lot_bids',
            manualBids: 'SELECT COUNT(*) as count FROM lot_bids WHERE is_auto_bid = false',
            autobids: 'SELECT COUNT(*) as count FROM lot_bids WHERE is_auto_bid = true',
            suspiciousUsers: `
                WITH user_scores AS (
                    SELECT 
                        bidder_login,
                        COUNT(*) as total_bids,
                        SUM(CASE WHEN is_auto_bid = false THEN 1 ELSE 0 END) as manual_bids,
                        SUM(CASE 
                            WHEN is_auto_bid = false AND 
                                 EXTRACT(HOUR FROM bid_timestamp) BETWEEN 22 AND 6 
                            THEN 10 
                            ELSE 0 
                        END) as night_bids_score,
                        CASE 
                            WHEN COUNT(*) > 100 AND 
                                 SUM(CASE WHEN is_auto_bid = false THEN 1 ELSE 0 END) * 100.0 / COUNT(*) > 80 
                            THEN 20 
                            ELSE 0 
                        END as high_manual_ratio_score
                    FROM lot_bids
                    GROUP BY bidder_login
                    HAVING COUNT(*) > 20
                )
                SELECT COUNT(*) as count
                FROM user_scores
                WHERE (night_bids_score + high_manual_ratio_score) > 20
            `
        };
        
        const results = {};
        for (const [key, query] of Object.entries(queries)) {
            const result = await pool.query(query);
            results[key] = parseInt(result.rows[0].count);
        }
        
        // Дополнительные расчеты
        results.manualBidPercentage = results.totalBids > 0 
            ? Math.round((results.manualBids / results.totalBids) * 100) 
            : 0;
        results.suspiciousPercentage = results.totalBidders > 0 
            ? Math.round((results.suspiciousUsers / results.totalBidders) * 100) 
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

// ============================================================================
// СТРАНИЦА АНАЛИТИКИ
// ============================================================================

app.get('/analytics', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'analytics.html'));
});

// ============================================================================
// ЗАПУСК СЕРВЕРА
// ============================================================================

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

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
        // Сначала проверяем, есть ли пользователи в winner_ratings
        const checkUsersQuery = `
            SELECT COUNT(*) as user_count
            FROM winner_ratings 
            WHERE fast_bids_score > 0
        `;
        
        const userCheckResult = await pool.query(checkUsersQuery);
        const userCount = parseInt(userCheckResult.rows[0].user_count);
        
        if (userCount === 0) {
            return res.json({
                success: false,
                error: 'Анализ невозможен',
                message: 'Анализ невозможен, запустите анализ быстрых ставок',
                data: [],
                count: 0
            });
        }
        
        console.log(`📊 Найдено ${userCount} подозрительных пользователей в winner_ratings`);
        
        // Шаг 1: Получаем подозрительных пользователей
        console.log('🔍 Шаг 1: Получаем подозрительных пользователей...');
        const suspiciousUsersQuery = `
            SELECT winner_login
            FROM winner_ratings 
            WHERE fast_bids_score = 50
            LIMIT 50
        `;
        const suspiciousUsersResult = await pool.query(suspiciousUsersQuery);
        const suspiciousUsers = suspiciousUsersResult.rows.map(row => row.winner_login);
        console.log(`✅ Найдено ${suspiciousUsers.length} подозрительных пользователей`);
        
        if (suspiciousUsers.length === 0) {
            return res.json({
                success: false,
                error: 'Нет данных',
                message: 'Нет пользователей с максимальным скорингом (50)',
                data: [],
                count: 0
            });
        }
        
        // Шаг 2: Находим лоты с подозрительными пользователями
        console.log('🔍 Шаг 2: Находим лоты с подозрительными пользователями...');
        const lotsQuery = `
            SELECT DISTINCT lot_id
            FROM lot_bids 
            WHERE bidder_login = ANY($1)
        `;
        const lotsResult = await pool.query(lotsQuery, [suspiciousUsers]);
        const lotIds = lotsResult.rows.map(row => row.lot_id);
        console.log(`✅ Найдено ${lotIds.length} лотов с подозрительными пользователями`);
        
        if (lotIds.length === 0) {
            return res.json({
                success: false,
                error: 'Нет данных',
                message: 'Нет лотов с подозрительными пользователями',
                data: [],
                count: 0
            });
        }
        
        // Шаг 3: Получаем ручные ставки по найденным лотам
        console.log('🔍 Шаг 3: Получаем ручные ставки по найденным лотам...');
        const manualBidsQuery = `
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
              AND lot_id = ANY($1)
            ORDER BY lot_id, bid_timestamp
        `;
        const manualBidsResult = await pool.query(manualBidsQuery, [lotIds]);
        console.log(`✅ Найдено ${manualBidsResult.rows.length} ручных ставок`);
        
        // Шаг 4: Вычисляем интервалы между ставками
        console.log('🔍 Шаг 4: Вычисляем интервалы между ставками...');
        const rows = [];
        const userStats = new Map();
        
        for (let i = 1; i < manualBidsResult.rows.length; i++) {
            const current = manualBidsResult.rows[i];
            const previous = manualBidsResult.rows[i-1];
            
            // Проверяем, что это тот же лот и тот же пользователь
            if (current.lot_id === previous.lot_id && current.bidder_login === previous.bidder_login) {
                const secondsBetween = (new Date(current.bid_timestamp) - new Date(previous.bid_timestamp)) / 1000;
                
                if (secondsBetween < 30) {
                    if (!userStats.has(current.bidder_login)) {
                        userStats.set(current.bidder_login, {
                            bidder_login: current.bidder_login,
                            suspicious_bids_count: 0,
                            fastest_interval: Infinity,
                            intervals: [],
                            critical_count: 0,
                            suspicious_count: 0,
                            warning_count: 0
                        });
                    }
                    
                    const stats = userStats.get(current.bidder_login);
                    stats.suspicious_bids_count++;
                    stats.intervals.push(secondsBetween);
                    stats.fastest_interval = Math.min(stats.fastest_interval, secondsBetween);
                    
                    if (secondsBetween < 1) {
                        stats.critical_count++;
                    } else if (secondsBetween < 5) {
                        stats.suspicious_count++;
                    } else {
                        stats.warning_count++;
                    }
                }
            }
        }
        
        // Шаг 5: Формируем финальные результаты
        console.log('🔍 Шаг 5: Формируем финальные результаты...');
        for (const [bidderLogin, stats] of userStats) {
            const avgInterval = stats.intervals.length > 0 
                ? Math.round(stats.intervals.reduce((a, b) => a + b, 0) / stats.intervals.length * 100) / 100
                : 0;
            
            let riskLevel = 'НОРМА';
            if (stats.critical_count > 0) {
                riskLevel = 'КРИТИЧЕСКИ ПОДОЗРИТЕЛЬНО';
            } else if (stats.suspicious_count > 5) {
                riskLevel = 'ПОДОЗРИТЕЛЬНО';
            } else if (stats.suspicious_bids_count > 10) {
                riskLevel = 'ВНИМАНИЕ';
            }
            
            rows.push({
                bidder_login: bidderLogin,
                suspicious_bids_count: stats.suspicious_bids_count,
                fastest_interval: stats.fastest_interval === Infinity ? 0 : stats.fastest_interval,
                avg_interval: avgInterval,
                critical_count: stats.critical_count,
                suspicious_count: stats.suspicious_count,
                warning_count: stats.warning_count,
                risk_level: riskLevel
            });
        }
        
        // Сортируем результаты
        rows.sort((a, b) => {
            const riskOrder = { 'КРИТИЧЕСКИ ПОДОЗРИТЕЛЬНО': 1, 'ПОДОЗРИТЕЛЬНО': 2, 'ВНИМАНИЕ': 3, 'НОРМА': 4 };
            if (riskOrder[a.risk_level] !== riskOrder[b.risk_level]) {
                return riskOrder[a.risk_level] - riskOrder[b.risk_level];
            }
            return b.suspicious_bids_count - a.suspicious_bids_count;
        });
        
        console.log(`✅ Обработано ${rows.length} пользователей с быстрыми ставками`);
        
        // Обновляем fast_bids_score в winner_ratings
        console.log(`📊 Найдено ${rows.length} пользователей с быстрыми ставками, обновляем скоринг...`);
        
        let updatedCount = 0;
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
            
            updatedCount++;
            if (updatedCount % 10 === 0) {
                console.log(`📝 Обновлено ${updatedCount}/${rows.length} пользователей...`);
            }
        }
        
        console.log(`✅ Обновлено ${updatedCount} пользователей в winner_ratings`);
        
        // Обновляем общий скоринг подозрительности
        console.log('🔍 Обновляем общий скоринг подозрительности...');
        await pool.query(`
            UPDATE winner_ratings 
            SET suspicious_score = COALESCE(fast_bids_score, 0) + COALESCE(autobid_traps_score, 0) + COALESCE(manipulation_score, 0),
                last_analysis_date = NOW()
        `);
        console.log('✅ Общий скоринг подозрительности обновлен');
        
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
        console.log('🔍 Начинаем анализ ловушек автобида...');
        
        // Шаг 1: Получаем лоты с прогнозными ценами
        console.log('🔍 Шаг 1: Получаем лоты с прогнозными ценами...');
        const lotsWithPredictionsQuery = `
            SELECT 
                al.id as lot_id,
                al.auction_number,
                al.lot_number,
                al.winner_login,
                al.winning_bid,
                al.starting_bid,
                al.category,
                lpp.predicted_price
            FROM auction_lots al
            LEFT JOIN lot_price_predictions lpp ON al.id = lpp.lot_id
            WHERE al.winning_bid IS NOT NULL
              AND al.winning_bid > 0
              AND lpp.predicted_price IS NOT NULL
              AND lpp.predicted_price > 0
            -- LIMIT 1000  -- Убрано для полного анализа всех лотов
        `;
        const lotsResult = await pool.query(lotsWithPredictionsQuery);
        console.log(`✅ Найдено ${lotsResult.rows.length} лотов с прогнозными ценами`);
        
        if (lotsResult.rows.length === 0) {
            return res.json({
                success: false,
                error: 'Нет данных',
                message: 'Нет лотов с прогнозными ценами',
                data: [],
                count: 0
            });
        }
        
        const lotIds = lotsResult.rows.map(row => row.lot_id);
        
        // Шаг 2: Получаем статистику по ставкам для этих лотов
        console.log('🔍 Шаг 2: Получаем статистику по ставкам...');
        const bidsStatsQuery = `
            SELECT 
                lot_id,
                COUNT(*) as total_bids,
                COUNT(DISTINCT bidder_login) as unique_bidders,
                COUNT(CASE WHEN is_auto_bid = true THEN 1 END) as autobid_count,
                COUNT(CASE WHEN is_auto_bid = false THEN 1 END) as manual_bid_count,
                MIN(bid_amount) as min_bid
            FROM lot_bids 
            WHERE lot_id = ANY($1)
            GROUP BY lot_id
        `;
        const bidsStatsResult = await pool.query(bidsStatsQuery, [lotIds]);
        console.log(`✅ Получена статистика для ${bidsStatsResult.rows.length} лотов`);
        
        // Создаем Map для быстрого поиска статистики
        const bidsStatsMap = new Map();
        bidsStatsResult.rows.forEach(row => {
            bidsStatsMap.set(row.lot_id, row);
        });
        
        // Шаг 3: Проверяем, использовал ли победитель автобид
        console.log('🔍 Шаг 3: Проверяем использование автобида победителями...');
        const winnerAutobidQuery = `
            SELECT DISTINCT lot_id, bidder_login
            FROM lot_bids 
            WHERE lot_id = ANY($1)
              AND is_auto_bid = true
        `;
        const winnerAutobidResult = await pool.query(winnerAutobidQuery, [lotIds]);
        console.log(`✅ Найдено ${winnerAutobidResult.rows.length} автобидов`);
        
        // Создаем Set для быстрой проверки автобидов
        const autobidSet = new Set();
        winnerAutobidResult.rows.forEach(row => {
            autobidSet.add(`${row.lot_id}_${row.bidder_login}`);
        });
        
        // Шаг 4: Получаем подозрительных участников (накрутчиков)
        console.log('🔍 Шаг 4: Получаем подозрительных участников (накрутчиков)...');
        const suspiciousBiddersQuery = `
            SELECT DISTINCT winner_login
            FROM winner_ratings 
            WHERE fast_bids_score > 0
            LIMIT 100
        `;
        const suspiciousBiddersResult = await pool.query(suspiciousBiddersQuery);
        const suspiciousBidders = new Set(suspiciousBiddersResult.rows.map(row => row.winner_login));
        console.log(`✅ Найдено ${suspiciousBidders.size} подозрительных участников (накрутчиков)`);
        
        // Шаг 4.1: Получаем участников каждого лота для проверки наличия накрутчиков
        console.log('🔍 Шаг 4.1: Получаем участников каждого лота...');
        const lotParticipantsQuery = `
            SELECT lot_id, bidder_login
            FROM lot_bids 
            WHERE lot_id = ANY($1)
        `;
        const lotParticipantsResult = await pool.query(lotParticipantsQuery, [lotIds]);
        
        // Создаем Map: lot_id -> Set участников
        const lotParticipantsMap = new Map();
        lotParticipantsResult.rows.forEach(row => {
            if (!lotParticipantsMap.has(row.lot_id)) {
                lotParticipantsMap.set(row.lot_id, new Set());
            }
            lotParticipantsMap.get(row.lot_id).add(row.bidder_login);
        });
        console.log(`✅ Получены участники для ${lotParticipantsMap.size} лотов`);
        
        // Шаг 5: Формируем результаты
        console.log('🔍 Шаг 5: Формируем результаты...');
        const rows = [];
        
        for (const lot of lotsResult.rows) {
            const stats = bidsStatsMap.get(lot.lot_id);
            if (!stats) continue;
            
            const priceMultiplier = Math.round((lot.winning_bid / stats.min_bid) * 100) / 100;
            const predictedPriceMultiplier = Math.round((lot.winning_bid / lot.predicted_price) * 100) / 100;
            
            const winnerUsedAutobid = autobidSet.has(`${lot.lot_id}_${lot.winner_login}`);
            
            // Проверяем, есть ли подозрительные участники (накрутчики) в этом лоте
            const lotParticipants = lotParticipantsMap.get(lot.lot_id) || new Set();
            const hasSuspiciousBidder = Array.from(lotParticipants).some(participant => 
                suspiciousBidders.has(participant)
            );
            
            // Логика ловушки автобида:
            // 1. Победитель использовал автобид (может быть неопытным)
            // 2. В лоте участвовали накрутчики (подозрительные пользователи)
            // 3. Цена значительно превышает прогнозную
            // 4. Высокая активность в лоте
            let riskLevel = 'НОРМА';
            if (stats.total_bids >= 15 && stats.unique_bidders >= 4 && 
                winnerUsedAutobid && predictedPriceMultiplier >= 2.0 && hasSuspiciousBidder) {
                riskLevel = 'КРИТИЧЕСКИ ПОДОЗРИТЕЛЬНО';
            } else if (stats.total_bids >= 10 && stats.unique_bidders >= 3 && 
                       winnerUsedAutobid && predictedPriceMultiplier >= 1.5 && hasSuspiciousBidder) {
                riskLevel = 'ПОДОЗРИТЕЛЬНО';
            } else if (stats.total_bids >= 8 && stats.unique_bidders >= 3 && 
                       winnerUsedAutobid && predictedPriceMultiplier >= 1.2 && hasSuspiciousBidder) {
                riskLevel = 'ВНИМАНИЕ';
            }
            
            if (riskLevel !== 'НОРМА') {
                rows.push({
                    lot_id: lot.lot_id,
                    auction_number: lot.auction_number,
                    lot_number: lot.lot_number,
                    winner_login: lot.winner_login,
                    winning_bid: lot.winning_bid,
                    predicted_price: lot.predicted_price,
                    min_bid: stats.min_bid,
                    price_multiplier: priceMultiplier,
                    predicted_price_multiplier: predictedPriceMultiplier,
                    total_bids: stats.total_bids,
                    unique_bidders: stats.unique_bidders,
                    autobid_count: stats.autobid_count,
                    manual_bid_count: stats.manual_bid_count,
                    winner_used_autobid: winnerUsedAutobid,
                    has_suspicious_bidder: hasSuspiciousBidder ? 'ЕСТЬ_ПОДОЗРИТЕЛЬНЫЙ_УЧАСТНИК' : 'НЕТ_ПОДОЗРИТЕЛЬНЫХ',
                    risk_level: riskLevel
                });
            }
        }
        
        // Сортируем результаты
        rows.sort((a, b) => {
            const riskOrder = { 'КРИТИЧЕСКИ ПОДОЗРИТЕЛЬНО': 1, 'ПОДОЗРИТЕЛЬНО': 2, 'ВНИМАНИЕ': 3 };
            if (riskOrder[a.risk_level] !== riskOrder[b.risk_level]) {
                return riskOrder[a.risk_level] - riskOrder[b.risk_level];
            }
            return b.predicted_price_multiplier - a.predicted_price_multiplier;
        });
        
        console.log(`✅ Найдено ${rows.length} лотов с ловушками автобида (победитель использовал автобид + участвовали накрутчики)`);
        
        // Автоматически обновляем скоринг для найденных ловушек автобида
        console.log('🔄 Автоматически обновляем скоринг для ловушек автобида...');
        
        // Создаем Map для подсчета ловушек по пользователям
        const userTrapsMap = new Map();
        for (const lot of rows) {
            if (!userTrapsMap.has(lot.winner_login)) {
                userTrapsMap.set(lot.winner_login, {
                    count: 0,
                    max_multiplier: 0,
                    avg_multiplier: 0,
                    multipliers: []
                });
            }
            
            const userStats = userTrapsMap.get(lot.winner_login);
            userStats.count++;
            userStats.multipliers.push(lot.predicted_price_multiplier);
            userStats.max_multiplier = Math.max(userStats.max_multiplier, lot.predicted_price_multiplier);
        }
        
        // Вычисляем средние множители
        for (const [user, stats] of userTrapsMap) {
            stats.avg_multiplier = stats.multipliers.reduce((a, b) => a + b, 0) / stats.multipliers.length;
        }
        
        // Обновляем скоринг в базе данных
        let updatedUsers = 0;
        for (const [winnerLogin, stats] of userTrapsMap) {
            let autobidTrapsScore = 0;
            
            if (stats.max_multiplier >= 3.0) {
                autobidTrapsScore = 50; // Максимальный балл за очень высокие цены
            } else if (stats.max_multiplier >= 2.0) {
                autobidTrapsScore = 30; // Высокий балл за высокие цены
            } else if (stats.avg_multiplier >= 1.5) {
                autobidTrapsScore = 15; // Средний балл за завышенные цены
            }
            
            // Обновляем или создаем запись в winner_ratings
            await pool.query(`
                INSERT INTO winner_ratings (winner_login, autobid_traps_score, last_analysis_date)
                VALUES ($1, $2, NOW())
                ON CONFLICT (winner_login) DO UPDATE SET
                    autobid_traps_score = EXCLUDED.autobid_traps_score,
                    last_analysis_date = EXCLUDED.last_analysis_date
            `, [winnerLogin, autobidTrapsScore]);
            
            updatedUsers++;
        }
        
        // Обновляем общий скоринг подозрительности
        await pool.query(`
            UPDATE winner_ratings 
            SET suspicious_score = COALESCE(fast_bids_score, 0) + COALESCE(autobid_traps_score, 0) + COALESCE(manipulation_score, 0),
                last_analysis_date = NOW()
        `);
        
        console.log(`✅ Автоматически обновлен скоринг для ${updatedUsers} пользователей`);
        
        res.json({
            success: true,
            data: rows,
            count: rows.length,
            updated_users: updatedUsers,
            message: `Найдено ${rows.length} ловушек автобида, обновлен скоринг для ${updatedUsers} пользователей`
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

// API для получения лотов пары пользователей из временных паттернов
app.get('/api/analytics/temporal-pattern-lots', async (req, res) => {
    try {
        const { user1, user2 } = req.query;
        
        if (!user1 || !user2) {
            return res.status(400).json({
                success: false,
                error: 'Необходимо указать user1 и user2'
            });
        }
        
        console.log(`🔍 Загружаем лоты для пары пользователей: ${user1} ↔ ${user2}`);
        
        const lotsQuery = `
            WITH suspicious_users AS (
                SELECT DISTINCT winner_login
                FROM winner_ratings
                WHERE suspicious_score > 40
            ),
            lb1 AS (
                SELECT b.bidder_login, b.bid_timestamp, b.lot_id
                FROM lot_bids b
                JOIN suspicious_users su ON su.winner_login = b.bidder_login
                WHERE b.is_auto_bid = false
                    AND b.bid_timestamp IS NOT NULL
                    AND b.bidder_login = $1
            ),
            synchronous_pairs AS (
                SELECT
                    l1.lot_id,
                    l1.bidder_login AS user1,
                    l2.bidder_login AS user2,
                    l1.bid_timestamp AS timestamp1,
                    l2.bid_timestamp AS timestamp2,
                    ABS(EXTRACT(EPOCH FROM (l2.bid_timestamp - l1.bid_timestamp))) AS time_diff_seconds
                FROM lb1 l1
                CROSS JOIN LATERAL (
                    SELECT b.bidder_login, b.bid_timestamp, b.lot_id
                    FROM lot_bids b
                    JOIN suspicious_users su2 ON su2.winner_login = b.bidder_login
                    WHERE b.is_auto_bid = false
                        AND b.bid_timestamp BETWEEN l1.bid_timestamp - INTERVAL '2 seconds'
                                               AND l1.bid_timestamp + INTERVAL '2 seconds'
                        AND b.bid_timestamp IS NOT NULL
                        AND b.bidder_login = $2
                        AND b.lot_id <> l1.lot_id
                ) l2
            )
            SELECT DISTINCT
                sp.lot_id,
                sp.user1,
                sp.user2,
                MIN(sp.timestamp1) AS timestamp1,
                MIN(sp.timestamp2) AS timestamp2,
                MIN(sp.time_diff_seconds) AS time_diff_seconds,
                al.auction_number,
                al.winning_bid,
                al.winner_login,
                al.category
            FROM synchronous_pairs sp
            LEFT JOIN auction_lots al ON al.id = sp.lot_id
            GROUP BY sp.lot_id, sp.user1, sp.user2, al.auction_number, al.winning_bid, al.winner_login, al.category
            ORDER BY MIN(sp.timestamp1) DESC
        `;
        
        const result = await pool.query(lotsQuery, [user1, user2]);
        
        res.json({
            success: true,
            data: result.rows,
            count: result.rows.length,
            message: `Найдено ${result.rows.length} лотов для пары ${user1} ↔ ${user2}`
        });
        
    } catch (error) {
        console.error('❌ Ошибка загрузки лотов пары пользователей:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка загрузки лотов пары пользователей',
            details: error.message
        });
    }
});

// API для анализа временных паттернов (синхронные ставки)
app.get('/api/analytics/temporal-patterns', async (req, res) => {
    try {
        console.log('🔍 Начинаем анализ временных паттернов (синхронные ставки)...');
        
        // Шаг 1: Ищем синхронные РУЧНЫЕ ставки на разных лотах (оптимизированный запрос Supabase)
        console.log('🔍 Шаг 1: Ищем синхронные РУЧНЫЕ ставки подозрительных пользователей на разных лотах (≤2 сек, без автобидов)...');
        const synchronousBidsQuery = `
            WITH suspicious_users AS (
                SELECT DISTINCT winner_login
                FROM winner_ratings
                WHERE suspicious_score > 40
            ),
            lb1 AS (
                SELECT b.*
                FROM lot_bids b
                JOIN suspicious_users su ON su.winner_login = b.bidder_login
                WHERE b.is_auto_bid = false
                    AND b.bid_timestamp IS NOT NULL
            )
            SELECT
                l1.bidder_login AS user1,
                l2.bidder_login AS user2,
                l1.bid_timestamp AS timestamp1,
                l2.bid_timestamp AS timestamp2,
                l1.lot_id AS lot1,
                l2.lot_id AS lot2,
                ABS(EXTRACT(EPOCH FROM (l2.bid_timestamp - l1.bid_timestamp))) AS time_diff_seconds
            FROM lb1 l1
            CROSS JOIN LATERAL (
                SELECT b.*
                FROM lot_bids b
                JOIN suspicious_users su2 ON su2.winner_login = b.bidder_login
                WHERE b.is_auto_bid = false
                    AND b.bid_timestamp BETWEEN l1.bid_timestamp - INTERVAL '2 seconds'
                                           AND l1.bid_timestamp + INTERVAL '2 seconds'
                    AND b.bid_timestamp IS NOT NULL
                    AND b.bidder_login > l1.bidder_login
                    AND b.lot_id <> l1.lot_id
            ) l2
            ORDER BY l1.bid_timestamp DESC
        `;
        
        const synchronousResult = await pool.query(synchronousBidsQuery);
        console.log(`✅ Найдено ${synchronousResult.rows.length} синхронных ставок`);
        
        // Шаг 2: Группируем пользователей по синхронности
        console.log('🔍 Шаг 2: Группируем пользователей по синхронности...');
        const userGroups = new Map();
        
        synchronousResult.rows.forEach(pair => {
            // Дополнительная проверка на валидность данных
            if (!pair.user1 || !pair.user2 || !pair.time_diff_seconds) {
                console.log(`⚠️ Пропускаем невалидную пару: ${pair.user1} - ${pair.user2}, time_diff: ${pair.time_diff_seconds}`);
                return;
            }
            
            const key1 = `${pair.user1}_${pair.user2}`;
            const key2 = `${pair.user2}_${pair.user1}`;
            
            if (!userGroups.has(key1) && !userGroups.has(key2)) {
                userGroups.set(key1, {
                    users: [pair.user1, pair.user2],
                    synchronous_count: 0,
                    time_diffs: [],
                    lots: new Set()
                });
            }
            
            const groupKey = userGroups.has(key1) ? key1 : key2;
            const group = userGroups.get(groupKey);
            
            group.synchronous_count++;
            // Добавляем только валидные значения времени (≤2 сек по оптимизированному запросу)
            const timeDiff = parseFloat(pair.time_diff_seconds);
            if (!isNaN(timeDiff) && timeDiff >= 0 && timeDiff <= 2) {
                group.time_diffs.push(timeDiff);
            } else {
                console.log(`⚠️ Пропускаем медленную пару ${pair.user1}-${pair.user2}: ${pair.time_diff_seconds}с (только ≤2с по оптимизированному запросу)`);
            }
            group.lots.add(pair.lot1);
            group.lots.add(pair.lot2);
        });
        
                // Шаг 3: Формируем результаты
                console.log('🔍 Шаг 3: Формируем результаты...');
                const groups = Array.from(userGroups.values()).map(group => {
                    const validTimeDiffs = group.time_diffs.filter(t => t !== null && !isNaN(t) && t >= 0 && t <= 2);
                    const avgTimeDiff = validTimeDiffs.length > 0 
                        ? Math.round(validTimeDiffs.reduce((a, b) => a + b, 0) / validTimeDiffs.length * 10) / 10
                        : 0;
                    
                    console.log(`Группа ${group.users.join(', ')}: ${group.synchronous_count} ставок, ${validTimeDiffs.length} валидных интервалов, средний: ${avgTimeDiff}с`);
                    console.log(`  Временные интервалы: [${validTimeDiffs.slice(0, 5).join(', ')}${validTimeDiffs.length > 5 ? '...' : ''}]`);
                    
                    let suspicionLevel = 'НОРМА';
                    // Оптимизированная гипотеза: синхронные ставки на разных лотах (≤2 сек)
                    if (group.synchronous_count >= 5 && avgTimeDiff <= 1) {
                        suspicionLevel = 'КРИТИЧЕСКИ ПОДОЗРИТЕЛЬНО'; // очень быстрые синхронные ставки
                    } else if (group.synchronous_count >= 3 && avgTimeDiff <= 2) {
                        suspicionLevel = 'ПОДОЗРИТЕЛЬНО'; // быстрые синхронные ставки
                    } else if (group.synchronous_count >= 2) {
                        suspicionLevel = 'ВНИМАНИЕ'; // несколько синхронных ставок
                    }
                    
                    return {
                        users: group.users,
                        synchronous_count: group.synchronous_count,
                        avg_time_diff: avgTimeDiff,
                        unique_lots: group.lots.size,
                        suspicion_level: suspicionLevel
                    };
                });
                
                // Шаг 4: Формируем данные для графа
                console.log('🔍 Шаг 4: Формируем данные для графа...');
                const graphData = {
                    nodes: [],
                    links: []
                };
                
                // Создаем связи (пары пользователей) сначала
                groups.forEach(group => {
                    if (group.users.length === 2) {
                        graphData.links.push({
                            source: group.users[0],
                            target: group.users[1],
                            synchronous_count: group.synchronous_count,
                            avg_time_diff: group.avg_time_diff,
                            unique_lots: group.unique_lots
                        });
                    }
                });
                
                // Создаем узлы только для пользователей, которые имеют связи
                const userMap = new Map();
                const usersWithLinks = new Set();
                
                // Собираем всех пользователей, которые участвуют в связях
                graphData.links.forEach(link => {
                    usersWithLinks.add(link.source);
                    usersWithLinks.add(link.target);
                });
                
                // Получаем рейтинги пользователей из базы данных
                const userLogins = Array.from(usersWithLinks);
                const userRatingsQuery = `
                    SELECT winner_login, suspicious_score
                    FROM winner_ratings 
                    WHERE winner_login = ANY($1)
                `;
                const userRatingsResult = await pool.query(userRatingsQuery, [userLogins]);
                const userRatingsMap = new Map();
                userRatingsResult.rows.forEach(row => {
                    userRatingsMap.set(row.winner_login, row.suspicious_score);
                });

                // Создаем узлы только для пользователей со связями
                usersWithLinks.forEach(user => {
                    // Находим группы, где участвует этот пользователь
                    const userGroups = groups.filter(g => g.users.includes(user));
                    
                    // Подсчитываем общее количество синхронных ставок для пользователя
                    // Это должно быть количество уникальных синхронных событий, а не сумма всех групп
                    const totalSynchronousBids = userGroups.length;
                    
                    // Получаем реальный уровень подозрительности из базы данных
                    let suspicionLevel = 'НОРМА';
                    const suspiciousScore = userRatingsMap.get(user);
                    if (suspiciousScore && suspiciousScore > 0) {
                        if (suspiciousScore >= 80) {
                            suspicionLevel = 'КРИТИЧЕСКИ ПОДОЗРИТЕЛЬНО';
                        } else if (suspiciousScore >= 50) {
                            suspicionLevel = 'ПОДОЗРИТЕЛЬНО';
                        } else if (suspiciousScore >= 30) {
                            suspicionLevel = 'ВНИМАНИЕ';
                        } else {
                            suspicionLevel = 'НОРМА';
                        }
                    }
                    
                    userMap.set(user, {
                        id: user,
                        name: user,
                        totalSynchronousBids: totalSynchronousBids,
                        suspicionLevel: suspicionLevel
                    });
                });
                
                graphData.nodes = Array.from(userMap.values());
                
                console.log(`✅ Граф: ${graphData.nodes.length} узлов, ${graphData.links.length} связей`);
        
        // Фильтруем только подозрительные группы (убираем НОРМА)
        const suspiciousGroups = groups.filter(group => group.suspicion_level !== 'НОРМА');
        
        // Сортируем по уровню подозрительности
        suspiciousGroups.sort((a, b) => {
            const levelOrder = { 'КРИТИЧЕСКИ ПОДОЗРИТЕЛЬНО': 1, 'ПОДОЗРИТЕЛЬНО': 2, 'ВНИМАНИЕ': 3 };
            if (levelOrder[a.suspicion_level] !== levelOrder[b.suspicion_level]) {
                return levelOrder[a.suspicion_level] - levelOrder[b.suspicion_level];
            }
            return b.synchronous_count - a.synchronous_count;
        });
        
        console.log(`✅ Сформировано ${groups.length} групп синхронных пользователей, из них ${suspiciousGroups.length} подозрительных`);
        
                res.json({
                    success: true,
                    data: suspiciousGroups,
                    graphData: graphData,
                    count: suspiciousGroups.length,
                    message: `Найдено ${suspiciousGroups.length} подозрительных групп синхронных пользователей из ${synchronousResult.rows.length} синхронных ставок`
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

// API для анализа круговых покупок (Гипотеза 1)
app.get('/api/analytics/circular-buyers', async (req, res) => {
    try {
        console.log('🔍 Начинаем анализ круговых покупок (фиктивные покупатели)...');
        
        const minPurchases = parseInt(req.query.min_purchases) || 3;
        const months = parseInt(req.query.months) || 6;
        
        // Шаг 1: Находим пользователей, покупающих одинаковые монеты
        console.log(`🔍 Шаг 1: Ищем пользователей с ${minPurchases}+ покупками одинаковых монет за ${months} месяцев...`);
        const circularBuyersQuery = `
            SELECT 
                al.winner_login,
                al.coin_description,
                al.year,
                al.condition,
                COUNT(*) as purchase_count,
                AVG(al.winning_bid) as avg_price,
                MIN(al.winning_bid) as min_price,
                MAX(al.winning_bid) as max_price,
                STDDEV(al.winning_bid) / NULLIF(AVG(al.winning_bid), 0) * 100 as price_variance_pct,
                AVG(al.bids_count) as avg_competition,
                EXTRACT(DAYS FROM MAX(al.auction_end_date) - MIN(al.auction_end_date)) / 7 as weeks_span,
                STRING_AGG(DISTINCT al.auction_number::text, ', ' ORDER BY al.auction_number::text) as auctions,
                MIN(al.auction_end_date) as first_purchase,
                MAX(al.auction_end_date) as last_purchase
            FROM auction_lots al
            WHERE al.winner_login IS NOT NULL
              AND al.winning_bid IS NOT NULL
              AND al.winning_bid > 0
              AND al.auction_end_date >= NOW() - INTERVAL '${months} months'
            GROUP BY al.winner_login, al.coin_description, al.year, al.condition
            HAVING COUNT(*) >= $1
            ORDER BY COUNT(*) DESC, AVG(al.winning_bid) DESC
        `;
        
        const result = await pool.query(circularBuyersQuery, [minPurchases]);
        console.log(`✅ Найдено ${result.rows.length} случаев круговых покупок`);
        
        // Шаг 2: Вычисляем индекс подозрительности
        console.log('🔍 Шаг 2: Вычисляем индекс подозрительности...');
        const suspiciousCases = [];
        
        for (const row of result.rows) {
            let suspicionScore = 0;
            let riskLevel = 'НОРМА';
            
            // Признак 1: Короткий период между покупками
            if (row.weeks_span < 12) { // Менее 3 месяцев
                suspicionScore += 20;
            }
            
            // Признак 2: Низкая конкуренция
            if (row.avg_competition < 5) {
                suspicionScore += 15;
            }
            
            // Признак 3: Стабильные цены (низкая вариация)
            if (row.price_variance_pct < 10) {
                suspicionScore += 20;
            }
            
            // Признак 4: Много покупок
            if (row.purchase_count >= 5) {
                suspicionScore += 25;
            } else if (row.purchase_count >= 3) {
                suspicionScore += 15;
            }
            
            // Признак 5: Высокие цены при низкой конкуренции
            if (row.avg_competition < 3 && row.avg_price > 1000) {
                suspicionScore += 30;
            }
            
            // Определяем уровень риска
            if (suspicionScore >= 80) {
                riskLevel = 'КРИТИЧЕСКИ ПОДОЗРИТЕЛЬНО';
            } else if (suspicionScore >= 50) {
                riskLevel = 'ПОДОЗРИТЕЛЬНО';
            } else if (suspicionScore >= 30) {
                riskLevel = 'ВНИМАНИЕ';
            }
            
            // Добавляем только подозрительные случаи
            if (riskLevel !== 'НОРМА') {
                suspiciousCases.push({
                    winner_login: row.winner_login,
                    coin_description: row.coin_description,
                    year: row.year,
                    condition: row.condition,
                    purchase_count: parseInt(row.purchase_count),
                    avg_price: parseFloat(row.avg_price),
                    min_price: parseFloat(row.min_price),
                    max_price: parseFloat(row.max_price),
                    price_variance_pct: parseFloat(row.price_variance_pct) || 0,
                    avg_competition: parseFloat(row.avg_competition) || 0,
                    weeks_span: parseFloat(row.weeks_span),
                    auctions: row.auctions,
                    first_purchase: row.first_purchase,
                    last_purchase: row.last_purchase,
                    suspicion_score: suspicionScore,
                    risk_level: riskLevel
                });
            }
        }
        
        // Сортируем по индексу подозрительности
        suspiciousCases.sort((a, b) => b.suspicion_score - a.suspicion_score);
        
        console.log(`✅ Найдено ${suspiciousCases.length} подозрительных случаев круговых покупок`);
        
        res.json({
            success: true,
            data: suspiciousCases,
            count: suspiciousCases.length,
            parameters: {
                min_purchases: minPurchases,
                months: months
            },
            message: `Найдено ${suspiciousCases.length} подозрительных случаев круговых покупок`
        });
        
    } catch (error) {
        console.error('❌ Ошибка анализа круговых покупок:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Ошибка анализа круговых покупок',
            details: error.message 
        });
    }
});

// API для анализа связанных аккаунтов (Гипотеза 2)
app.get('/api/analytics/linked-accounts', async (req, res) => {
    try {
        console.log('🔍 Начинаем анализ связанных аккаунтов...');
        
        const similarityThreshold = parseFloat(req.query.similarity_threshold) || 0.70;
        const minBids = parseInt(req.query.min_bids) || 10;
        const months = parseInt(req.query.months) || 3;
        
        // Шаг 0: Проверяем данные по автобидам
        console.log(`🔍 Шаг 0: Проверяем данные по автобидам...`);
        const autobidCheckQuery = `
            SELECT 
                COUNT(*) as total_bids,
                COUNT(CASE WHEN is_auto_bid = true THEN 1 END) as autobid_count,
                COUNT(CASE WHEN is_auto_bid = false THEN 1 END) as manual_bid_count,
                COUNT(CASE WHEN is_auto_bid IS NULL THEN 1 END) as null_bid_count,
                AVG(CASE WHEN is_auto_bid = true THEN 1 ELSE 0 END) as autobid_ratio
            FROM lot_bids
            WHERE bid_timestamp >= NOW() - INTERVAL '${months} months'
        `;
        const autobidCheck = await pool.query(autobidCheckQuery);
        console.log(`📊 Общая статистика автобидов за ${months} месяцев:`);
        console.log(`   Всего ставок: ${autobidCheck.rows[0].total_bids}`);
        console.log(`   Автобидов: ${autobidCheck.rows[0].autobid_count}`);
        console.log(`   Ручных ставок: ${autobidCheck.rows[0].manual_bid_count}`);
        console.log(`   NULL значений: ${autobidCheck.rows[0].null_bid_count}`);
        console.log(`   Соотношение автобидов: ${(autobidCheck.rows[0].autobid_ratio * 100).toFixed(1)}%`);
        
        // Шаг 1: Получаем профили подозрительных пользователей
        console.log(`🔍 Шаг 1: Строим профили подозрительных пользователей за ${months} месяцев...`);
        const userProfilesQuery = `
            WITH suspicious_users AS (
                SELECT winner_login
                FROM winner_ratings
                WHERE suspicious_score > 30
                ORDER BY suspicious_score DESC
                LIMIT 200
            ),
            user_stats AS (
                SELECT 
                    lb.bidder_login,
                    EXTRACT(HOUR FROM lb.bid_timestamp) as hour,
                    COUNT(*) as bids_at_hour,
                    AVG(CASE WHEN lb.is_auto_bid = true THEN 1 ELSE 0 END) as auto_bid_ratio,
                    COUNT(DISTINCT lb.lot_id) as unique_lots,
                    COUNT(*) as total_bids
                FROM lot_bids lb
                JOIN suspicious_users su ON su.winner_login = lb.bidder_login
                WHERE lb.bid_timestamp >= NOW() - INTERVAL '${months} months'
                  AND lb.bid_timestamp IS NOT NULL
                GROUP BY lb.bidder_login, EXTRACT(HOUR FROM lb.bid_timestamp)
            ),
            user_aggregated AS (
                SELECT 
                    bidder_login,
                    SUM(bids_at_hour) as total_bids,
                    AVG(auto_bid_ratio) as avg_auto_bid_ratio,
                    SUM(unique_lots) as total_unique_lots,
                    ARRAY_AGG(
                        JSON_BUILD_OBJECT(
                            'hour', hour,
                            'bids', bids_at_hour
                        ) ORDER BY hour
                    ) as hourly_pattern
                FROM user_stats
                GROUP BY bidder_login
                HAVING SUM(bids_at_hour) >= $1
            )
            SELECT 
                bidder_login,
                total_bids,
                avg_auto_bid_ratio,
                total_unique_lots,
                hourly_pattern
            FROM user_aggregated
            ORDER BY total_bids DESC
        `;
        
        const profilesResult = await pool.query(userProfilesQuery, [minBids]);
        console.log(`✅ Получены профили для ${profilesResult.rows.length} подозрительных пользователей`);
        console.log(`🔢 Будет выполнено ${profilesResult.rows.length * (profilesResult.rows.length - 1) / 2} сравнений`);
        
        // Отладочная информация о автобидах
        if (profilesResult.rows.length > 0) {
            const autobidRatios = profilesResult.rows
                .map(user => user.avg_auto_bid_ratio)
                .filter(ratio => ratio !== null && !isNaN(ratio));
            
            if (autobidRatios.length > 0) {
                const avgAutobidRatio = autobidRatios.reduce((a, b) => a + b, 0) / autobidRatios.length;
                const maxAutobidRatio = Math.max(...autobidRatios);
                const minAutobidRatio = Math.min(...autobidRatios);
                
                console.log(`📊 Статистика автобидов:`);
                console.log(`   Средний % автобидов: ${(avgAutobidRatio * 100).toFixed(1)}%`);
                console.log(`   Максимальный %: ${(maxAutobidRatio * 100).toFixed(1)}%`);
                console.log(`   Минимальный %: ${(minAutobidRatio * 100).toFixed(1)}%`);
                console.log(`   Пользователей с данными: ${autobidRatios.length}/${profilesResult.rows.length}`);
            } else {
                console.log(`⚠️ Нет валидных данных по автобидам`);
            }
        }
        
        if (profilesResult.rows.length < 2) {
            return res.json({
                success: false,
                error: 'Недостаточно данных',
                message: 'Недостаточно пользователей для анализа связанных аккаунтов',
                data: [],
                count: 0
            });
        }
        
        // Шаг 2: Вычисляем похожесть между всеми парами пользователей
        console.log('🔍 Шаг 2: Вычисляем похожесть между парами пользователей...');
        const linkedAccounts = [];
        
        for (let i = 0; i < profilesResult.rows.length; i++) {
            for (let j = i + 1; j < profilesResult.rows.length; j++) {
                const user1 = profilesResult.rows[i];
                const user2 = profilesResult.rows[j];
                
                // Вычисляем похожесть временных паттернов
                const hourlySim = calculateHourlySimilarity(user1.hourly_pattern, user2.hourly_pattern);
                
                // Вычисляем похожесть автобидов (обрабатываем null значения)
                const user1Autobid = user1.avg_auto_bid_ratio || 0;
                const user2Autobid = user2.avg_auto_bid_ratio || 0;
                const autoBidDiff = Math.abs(user1Autobid - user2Autobid);
                const autoBidSim = 1 - autoBidDiff;
                
                // Общая похожесть (70% временные паттерны, 30% автобиды)
                const similarity = (hourlySim * 0.7) + (autoBidSim * 0.3);
                
                if (similarity >= similarityThreshold) {
                    linkedAccounts.push({
                        user1: user1.bidder_login,
                        user2: user2.bidder_login,
                        similarity: Math.round(similarity * 100) / 100,
                        hourly_similarity: Math.round(hourlySim * 100) / 100,
                        autobid_similarity: Math.round(autoBidSim * 100) / 100,
                        user1_bids: user1.total_bids,
                        user2_bids: user2.total_bids,
                        user1_autobid_ratio: Math.round(user1.avg_auto_bid_ratio * 100) / 100,
                        user2_autobid_ratio: Math.round(user2.avg_auto_bid_ratio * 100) / 100,
                        risk_level: similarity >= 0.90 ? 'КРИТИЧЕСКИ ПОДОЗРИТЕЛЬНО' : 
                                   similarity >= 0.85 ? 'ПОДОЗРИТЕЛЬНО' : 'ВНИМАНИЕ'
                    });
                }
            }
        }
        
        // Сортируем по похожести
        linkedAccounts.sort((a, b) => b.similarity - a.similarity);
        
        console.log(`✅ Найдено ${linkedAccounts.length} пар связанных аккаунтов`);
        console.log(`📊 Общее количество строк в выдаче: ${linkedAccounts.length}`);
        
        res.json({
            success: true,
            data: linkedAccounts,
            count: linkedAccounts.length,
            parameters: {
                similarity_threshold: similarityThreshold,
                min_bids: minBids,
                months: months
            },
            message: `Найдено ${linkedAccounts.length} пар связанных аккаунтов`
        });
        
    } catch (error) {
        console.error('❌ Ошибка анализа связанных аккаунтов:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Ошибка анализа связанных аккаунтов',
            details: error.message 
        });
    }
});

// Функция для вычисления похожести временных паттернов (корреляция Пирсона + евклидово расстояние)
function calculateHourlySimilarity(pattern1, pattern2) {
    // Создаем массивы по 24 часа
    const hours1 = new Array(24).fill(0);
    const hours2 = new Array(24).fill(0);
    
    // Заполняем данные из паттернов
    pattern1.forEach(item => {
        if (item.hour >= 0 && item.hour < 24) {
            hours1[item.hour] = item.bids;
        }
    });
    
    pattern2.forEach(item => {
        if (item.hour >= 0 && item.hour < 24) {
            hours2[item.hour] = item.bids;
        }
    });
    
    // 1. Вычисляем корреляцию Пирсона
    const n = 24;
    const sum1 = hours1.reduce((a, b) => a + b, 0);
    const sum2 = hours2.reduce((a, b) => a + b, 0);
    const mean1 = sum1 / n;
    const mean2 = sum2 / n;
    
    let numerator = 0;
    let denom1 = 0;
    let denom2 = 0;
    
    for (let i = 0; i < n; i++) {
        const diff1 = hours1[i] - mean1;
        const diff2 = hours2[i] - mean2;
        numerator += diff1 * diff2;
        denom1 += diff1 * diff1;
        denom2 += diff2 * diff2;
    }
    
    let pearsonCorrelation = 0;
    if (denom1 !== 0 && denom2 !== 0) {
        pearsonCorrelation = numerator / Math.sqrt(denom1 * denom2);
    }
    
    // Преобразуем корреляцию в похожесть (0-1)
    const pearsonSimilarity = Math.max(0, pearsonCorrelation);
    
    // 2. Вычисляем евклидово расстояние
    let euclideanDistance = 0;
    for (let i = 0; i < n; i++) {
        euclideanDistance += Math.pow(hours1[i] - hours2[i], 2);
    }
    euclideanDistance = Math.sqrt(euclideanDistance);
    
    // Преобразуем евклидово расстояние в похожесть (0-1)
    // Максимально возможное расстояние для нормализации
    const maxPossibleDistance = Math.sqrt(n * Math.pow(Math.max(...hours1, ...hours2), 2));
    const euclideanSimilarity = maxPossibleDistance > 0 ? 
        Math.max(0, 1 - (euclideanDistance / maxPossibleDistance)) : 0;
    
    // 3. Усредняем два метода (50% корреляция + 50% евклидово расстояние)
    const combinedSimilarity = (pearsonSimilarity * 0.5) + (euclideanSimilarity * 0.5);
    
    return combinedSimilarity;
}

// API для анализа карусели перепродаж (Гипотеза 8)
app.get('/api/analytics/carousel-analysis', async (req, res) => {
    try {
        console.log('🔍 Начинаем анализ карусели перепродаж...');
        
        const minSales = parseInt(req.query.min_sales) || 3;
        const maxWeeks = parseInt(req.query.max_weeks) || 4;
        const months = parseInt(req.query.months) || 6;
        
        // Шаг 1: Находим монеты, проданные несколько раз
        console.log(`🔍 Шаг 1: Ищем монеты с ${minSales}+ продажами за ${months} месяцев...`);
        const coinSalesQuery = `
            SELECT 
                al.coin_description,
                al.year,
                al.condition,
                COUNT(*) as sales_count,
                ARRAY_AGG(al.winner_login ORDER BY al.auction_end_date) as winners,
                ARRAY_AGG(al.auction_number ORDER BY al.auction_end_date) as auctions,
                ARRAY_AGG(al.winning_bid ORDER BY al.auction_end_date) as prices,
                ARRAY_AGG(al.auction_end_date ORDER BY al.auction_end_date) as dates,
                MIN(al.auction_end_date) as first_sale,
                MAX(al.auction_end_date) as last_sale
            FROM auction_lots al
            WHERE al.winner_login IS NOT NULL
              AND al.winning_bid IS NOT NULL
              AND al.winning_bid > 0
              AND al.auction_end_date >= NOW() - INTERVAL '${months} months'
            GROUP BY al.coin_description, al.year, al.condition
            HAVING COUNT(*) >= $1
            ORDER BY COUNT(*) DESC
        `;
        
        const coinSalesResult = await pool.query(coinSalesQuery, [minSales]);
        console.log(`✅ Найдено ${coinSalesResult.rows.length} монет с множественными продажами`);
        
        // Шаг 2: Анализируем каждую монету на предмет карусели
        console.log('🔍 Шаг 2: Анализируем карусели перепродаж...');
        const carousels = [];
        
        for (const coin of coinSalesResult.rows) {
            const winners = coin.winners;
            const prices = coin.prices;
            const dates = coin.dates;
            const auctions = coin.auctions;
            
            // Проверяем признаки карусели
            const uniqueWinners = [...new Set(winners)];
            const timeSpanWeeks = (new Date(coin.last_sale) - new Date(coin.first_sale)) / (1000 * 60 * 60 * 24 * 7);
            
            // Признаки карусели
            let carouselScore = 0;
            let riskLevel = 'НОРМА';
            
            // 1. Мало уникальных победителей относительно количества продаж
            const winnerRatio = uniqueWinners.length / winners.length;
            if (winnerRatio < 0.5) {
                carouselScore += 30;
            } else if (winnerRatio < 0.7) {
                carouselScore += 20;
            }
            
            // 2. Короткий период между продажами
            if (timeSpanWeeks < maxWeeks) {
                carouselScore += 25;
            }
            
            // 3. Постепенный рост цены
            let priceGrowth = 0;
            if (prices.length > 1) {
                const firstPrice = prices[0];
                const lastPrice = prices[prices.length - 1];
                priceGrowth = ((lastPrice - firstPrice) / firstPrice) * 100;
                
                if (priceGrowth > 50) {
                    carouselScore += 20;
                } else if (priceGrowth > 20) {
                    carouselScore += 10;
                }
            }
            
            // 4. Повторяющиеся победители
            const winnerCounts = {};
            winners.forEach(winner => {
                winnerCounts[winner] = (winnerCounts[winner] || 0) + 1;
            });
            
            const maxWins = Math.max(...Object.values(winnerCounts));
            if (maxWins >= 3) {
                carouselScore += 25;
            } else if (maxWins >= 2) {
                carouselScore += 15;
            }
            
            // 5. Проверяем, участвуют ли одни и те же люди в торгах
            // (это требует дополнительного запроса к lot_bids)
            const biddersQuery = `
                SELECT DISTINCT lb.bidder_login
                FROM lot_bids lb
                JOIN auction_lots al ON lb.lot_id = al.id
                WHERE al.coin_description = $1
                  AND al.year = $2
                  AND al.condition = $3
                  AND al.auction_number = ANY($4)
            `;
            
            const biddersResult = await pool.query(biddersQuery, [
                coin.coin_description,
                coin.year,
                coin.condition,
                auctions
            ]);
            
            const allBidders = biddersResult.rows.map(row => row.bidder_login);
            const uniqueBidders = [...new Set(allBidders)];
            
            // Если участников торгов мало и они совпадают с победителями
            const biddersOverlap = uniqueBidders.filter(bidder => uniqueWinners.includes(bidder)).length;
            const overlapRatio = biddersOverlap / uniqueWinners.length;
            
            if (overlapRatio > 0.8) {
                carouselScore += 20;
            } else if (overlapRatio > 0.6) {
                carouselScore += 10;
            }
            
            // Определяем уровень риска
            if (carouselScore >= 80) {
                riskLevel = 'КРИТИЧЕСКИ ПОДОЗРИТЕЛЬНО';
            } else if (carouselScore >= 50) {
                riskLevel = 'ПОДОЗРИТЕЛЬНО';
            } else if (carouselScore >= 30) {
                riskLevel = 'ВНИМАНИЕ';
            }
            
            // Добавляем только подозрительные карусели
            if (riskLevel !== 'НОРМА') {
                carousels.push({
                    coin_description: coin.coin_description,
                    year: coin.year,
                    condition: coin.condition,
                    sales_count: coin.sales_count,
                    unique_winners: uniqueWinners.length,
                    winner_ratio: Math.round(winnerRatio * 100) / 100,
                    time_span_weeks: Math.round(timeSpanWeeks * 10) / 10,
                    price_growth_pct: Math.round(priceGrowth * 10) / 10,
                    max_wins_per_user: maxWins,
                    bidders_overlap_ratio: Math.round(overlapRatio * 100) / 100,
                    winners: uniqueWinners,
                    auctions: auctions,
                    prices: prices,
                    dates: dates,
                    carousel_score: carouselScore,
                    risk_level: riskLevel
                });
            }
        }
        
        // Сортируем по индексу карусели
        carousels.sort((a, b) => b.carousel_score - a.carousel_score);
        
        console.log(`✅ Найдено ${carousels.length} подозрительных каруселей перепродаж`);
        
        res.json({
            success: true,
            data: carousels,
            count: carousels.length,
            parameters: {
                min_sales: minSales,
                max_weeks: maxWeeks,
                months: months
            },
            message: `Найдено ${carousels.length} подозрительных каруселей перепродаж`
        });
        
    } catch (error) {
        console.error('❌ Ошибка анализа карусели перепродаж:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Ошибка анализа карусели перепродаж',
            details: error.message 
        });
    }
});

// API для анализа заглохания торгов (Гипотеза 3)
app.get('/api/analytics/abandonment-analysis', async (req, res) => {
    try {
        console.log('🔍 Начинаем анализ заглохания торгов...');
        
        const minBids = parseInt(req.query.min_bids) || 5;
        const maxSeconds = parseInt(req.query.max_seconds) || 30;
        const months = parseInt(req.query.months) || 3;
        
        // Шаг 1: Находим лоты с резким прекращением торгов
        console.log(`🔍 Шаг 1: Ищем лоты с заглоханием торгов за ${months} месяцев...`);
        const abandonmentQuery = `
            WITH lot_bid_sequences AS (
                SELECT 
                    lb.lot_id,
                    lb.auction_number,
                    lb.lot_number,
                    lb.bidder_login,
                    lb.bid_amount,
                    lb.bid_timestamp,
                    lb.is_auto_bid,
                    ROW_NUMBER() OVER (PARTITION BY lb.lot_id ORDER BY lb.bid_timestamp) as bid_sequence,
                    LAG(lb.bid_timestamp) OVER (PARTITION BY lb.lot_id ORDER BY lb.bid_timestamp) as prev_bid_time,
                    EXTRACT(EPOCH FROM (lb.bid_timestamp - LAG(lb.bid_timestamp) OVER (PARTITION BY lb.lot_id ORDER BY lb.bid_timestamp))) as seconds_since_prev
                FROM lot_bids lb
                JOIN auction_lots al ON lb.lot_id = al.id
                WHERE lb.bid_timestamp >= NOW() - INTERVAL '${months} months'
                  AND lb.bid_timestamp IS NOT NULL
                  AND al.winning_bid IS NOT NULL
            ),
            lot_stats AS (
                SELECT 
                    lot_id,
                    auction_number,
                    lot_number,
                    COUNT(*) as total_bids,
                    COUNT(DISTINCT bidder_login) as unique_bidders,
                    MAX(bid_sequence) as max_sequence,
                    MAX(seconds_since_prev) as max_gap_seconds,
                    AVG(seconds_since_prev) as avg_gap_seconds,
                    ARRAY_AGG(
                        JSON_BUILD_OBJECT(
                            'bidder', bidder_login,
                            'amount', bid_amount,
                            'timestamp', bid_timestamp,
                            'is_auto', is_auto_bid,
                            'sequence', bid_sequence,
                            'gap_seconds', seconds_since_prev
                        ) ORDER BY bid_timestamp
                    ) as bid_sequence_data
                FROM lot_bid_sequences
                GROUP BY lot_id, auction_number, lot_number
                HAVING COUNT(*) >= $1
            )
            SELECT 
                ls.*,
                al.winner_login,
                al.winning_bid,
                al.starting_bid,
                al.bids_count,
                al.category
            FROM lot_stats ls
            JOIN auction_lots al ON ls.lot_id = al.id
            WHERE ls.max_gap_seconds > $2
            ORDER BY ls.max_gap_seconds DESC
        `;
        
        const result = await pool.query(abandonmentQuery, [minBids, maxSeconds]);
        console.log(`✅ Найдено ${result.rows.length} лотов с заглоханием торгов`);
        
        // Шаг 2: Анализируем паттерны заглохания
        console.log('🔍 Шаг 2: Анализируем паттерны заглохания...');
        const abandonmentCases = [];
        
        for (const row of result.rows) {
            const bidData = row.bid_sequence_data;
            let abandonmentScore = 0;
            let riskLevel = 'НОРМА';
            
            // Анализируем последовательность ставок
            let suspiciousPatterns = [];
            
            // 1. Резкое прекращение после активных торгов
            if (row.max_gap_seconds > 300) { // Более 5 минут
                abandonmentScore += 25;
                suspiciousPatterns.push('ДЛИТЕЛЬНАЯ_ПАУЗА');
            }
            
            // 2. Заглохание после ручных ставок
            const manualBids = bidData.filter(bid => !bid.is_auto).length;
            const autoBids = bidData.filter(bid => bid.is_auto).length;
            
            if (manualBids > 0 && autoBids === 0) {
                abandonmentScore += 20;
                suspiciousPatterns.push('ТОЛЬКО_РУЧНЫЕ_СТАВКИ');
            }
            
            // 3. Заглохание после быстрых ставок
            const fastBids = bidData.filter(bid => bid.gap_seconds && bid.gap_seconds < 10).length;
            if (fastBids > 2 && row.max_gap_seconds > 60) {
                abandonmentScore += 30;
                suspiciousPatterns.push('БЫСТРЫЕ_СТАВКИ_ПЕРЕД_ЗАГЛОХАНИЕМ');
            }
            
            // 4. Низкая конкуренция
            if (row.unique_bidders < 3) {
                abandonmentScore += 15;
                suspiciousPatterns.push('НИЗКАЯ_КОНКУРЕНЦИЯ');
            }
            
            // 5. Заглохание после достижения определенной цены
            const priceMultiplier = row.winning_bid / row.starting_bid;
            if (priceMultiplier > 2.0 && row.max_gap_seconds > 120) {
                abandonmentScore += 20;
                suspiciousPatterns.push('ЗАГЛОХАНИЕ_ПОСЛЕ_ВЫСОКОЙ_ЦЕНЫ');
            }
            
            // Определяем уровень риска
            if (abandonmentScore >= 70) {
                riskLevel = 'КРИТИЧЕСКИ ПОДОЗРИТЕЛЬНО';
            } else if (abandonmentScore >= 40) {
                riskLevel = 'ПОДОЗРИТЕЛЬНО';
            } else if (abandonmentScore >= 20) {
                riskLevel = 'ВНИМАНИЕ';
            }
            
            // Добавляем только подозрительные случаи
            if (riskLevel !== 'НОРМА') {
                abandonmentCases.push({
                    lot_id: row.lot_id,
                    auction_number: row.auction_number,
                    lot_number: row.lot_number,
                    winner_login: row.winner_login,
                    winning_bid: row.winning_bid,
                    starting_bid: row.starting_bid,
                    total_bids: row.total_bids,
                    unique_bidders: row.unique_bidders,
                    max_gap_seconds: Math.round(row.max_gap_seconds),
                    avg_gap_seconds: Math.round(row.avg_gap_seconds * 10) / 10,
                    price_multiplier: Math.round(priceMultiplier * 100) / 100,
                    manual_bids: manualBids,
                    auto_bids: autoBids,
                    suspicious_patterns: suspiciousPatterns,
                    abandonment_score: abandonmentScore,
                    risk_level: riskLevel,
                    category: row.category
                });
            }
        }
        
        // Сортируем по индексу заглохания
        abandonmentCases.sort((a, b) => b.abandonment_score - a.abandonment_score);
        
        console.log(`✅ Найдено ${abandonmentCases.length} подозрительных случаев заглохания торгов`);
        
        res.json({
            success: true,
            data: abandonmentCases,
            count: abandonmentCases.length,
            parameters: {
                min_bids: minBids,
                max_seconds: maxSeconds,
                months: months
            },
            message: `Найдено ${abandonmentCases.length} подозрительных случаев заглохания торгов`
        });
        
    } catch (error) {
        console.error('❌ Ошибка анализа заглохания торгов:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Ошибка анализа заглохания торгов',
            details: error.message 
        });
    }
});

// API для анализа прощупывания автобидов (Гипотеза 4)
app.get('/api/analytics/autobid-probing', async (req, res) => {
    try {
        console.log('🔍 Начинаем анализ прощупывания автобидов...');
        
        const minBids = parseInt(req.query.min_bids) || 3;
        const maxSeconds = parseInt(req.query.max_seconds) || 60;
        const months = parseInt(req.query.months) || 3;
        
        // Шаг 1: Находим лоты с подозрительными паттернами ставок
        console.log(`🔍 Шаг 1: Ищем лоты с прощупыванием автобидов за ${months} месяцев...`);
        const probingQuery = `
            WITH lot_bid_analysis AS (
                SELECT 
                    lb.lot_id,
                    lb.auction_number,
                    lb.lot_number,
                    lb.bidder_login,
                    lb.bid_amount,
                    lb.bid_timestamp,
                    lb.is_auto_bid,
                    ROW_NUMBER() OVER (PARTITION BY lb.lot_id ORDER BY lb.bid_timestamp) as bid_sequence,
                    LAG(lb.bid_amount) OVER (PARTITION BY lb.lot_id ORDER BY lb.bid_timestamp) as prev_bid_amount,
                    LAG(lb.bidder_login) OVER (PARTITION BY lb.lot_id ORDER BY lb.bid_timestamp) as prev_bidder,
                    EXTRACT(EPOCH FROM (lb.bid_timestamp - LAG(lb.bid_timestamp) OVER (PARTITION BY lb.lot_id ORDER BY lb.bid_timestamp))) as seconds_since_prev,
                    lb.bid_amount - LAG(lb.bid_amount) OVER (PARTITION BY lb.lot_id ORDER BY lb.bid_timestamp) as bid_increment
                FROM lot_bids lb
                JOIN auction_lots al ON lb.lot_id = al.id
                WHERE lb.bid_timestamp >= NOW() - INTERVAL '${months} months'
                  AND lb.bid_timestamp IS NOT NULL
                  AND al.winning_bid IS NOT NULL
            ),
            lot_stats AS (
                SELECT 
                    lot_id,
                    auction_number,
                    lot_number,
                    COUNT(*) as total_bids,
                    COUNT(DISTINCT bidder_login) as unique_bidders,
                    COUNT(CASE WHEN is_auto_bid = true THEN 1 END) as autobid_count,
                    COUNT(CASE WHEN is_auto_bid = false THEN 1 END) as manual_bid_count,
                    AVG(seconds_since_prev) as avg_interval_seconds,
                    MIN(seconds_since_prev) as min_interval_seconds,
                    MAX(seconds_since_prev) as max_interval_seconds,
                    AVG(bid_increment) as avg_increment,
                    STDDEV(bid_increment) as increment_stddev,
                    ARRAY_AGG(
                        JSON_BUILD_OBJECT(
                            'bidder', bidder_login,
                            'amount', bid_amount,
                            'timestamp', bid_timestamp,
                            'is_auto', is_auto_bid,
                            'sequence', bid_sequence,
                            'increment', bid_increment,
                            'interval_seconds', seconds_since_prev
                        ) ORDER BY bid_timestamp
                    ) as bid_sequence_data
                FROM lot_bid_analysis
                GROUP BY lot_id, auction_number, lot_number
                HAVING COUNT(*) >= $1
            )
            SELECT 
                ls.*,
                al.winner_login,
                al.winning_bid,
                al.starting_bid,
                al.bids_count,
                al.category
            FROM lot_stats ls
            JOIN auction_lots al ON ls.lot_id = al.id
            WHERE ls.manual_bid_count > 0 
              AND ls.autobid_count > 0
              AND ls.avg_interval_seconds < $2
            ORDER BY ls.avg_interval_seconds ASC
        `;
        
        const result = await pool.query(probingQuery, [minBids, maxSeconds]);
        console.log(`✅ Найдено ${result.rows.length} лотов с потенциальным прощупыванием автобидов`);
        
        // Шаг 2: Анализируем паттерны прощупывания
        console.log('🔍 Шаг 2: Анализируем паттерны прощупывания автобидов...');
        const probingCases = [];
        
        for (const row of result.rows) {
            const bidData = row.bid_sequence_data;
            let probingScore = 0;
            let riskLevel = 'НОРМА';
            
            // Анализируем последовательность ставок
            let suspiciousPatterns = [];
            
            // 1. Быстрые ставки после автобидов
            let quickBidsAfterAutobid = 0;
            for (let i = 1; i < bidData.length; i++) {
                const current = bidData[i];
                const previous = bidData[i-1];
                
                if (previous.is_auto && !current.is_auto && current.interval_seconds < 30) {
                    quickBidsAfterAutobid++;
                }
            }
            
            if (quickBidsAfterAutobid > 0) {
                probingScore += 25;
                suspiciousPatterns.push('БЫСТРЫЕ_СТАВКИ_ПОСЛЕ_АВТОБИДОВ');
            }
            
            // 2. Постепенное увеличение ставок
            const increments = bidData.filter(bid => bid.increment && bid.increment > 0).map(bid => bid.increment);
            if (increments.length > 2) {
                const isIncreasing = increments.every((inc, i) => i === 0 || inc >= increments[i-1] * 0.8);
                if (isIncreasing) {
                    probingScore += 20;
                    suspiciousPatterns.push('ПОСТЕПЕННОЕ_УВЕЛИЧЕНИЕ_СТАВОК');
                }
            }
            
            // 3. Низкая вариация инкрементов (систематичность)
            if (row.increment_stddev && row.increment_stddev < row.avg_increment * 0.3) {
                probingScore += 15;
                suspiciousPatterns.push('СИСТЕМАТИЧНЫЕ_ИНКРЕМЕНТЫ');
            }
            
            // 4. Высокая активность с автобидами
            const autobidRatio = row.autobid_count / row.total_bids;
            if (autobidRatio > 0.5 && row.avg_interval_seconds < 20) {
                probingScore += 30;
                suspiciousPatterns.push('ВЫСОКАЯ_АКТИВНОСТЬ_С_АВТОБИДАМИ');
            }
            
            // 5. Резкое прекращение после достижения цели
            const lastBids = bidData.slice(-3);
            const hasAutobidInLastBids = lastBids.some(bid => bid.is_auto);
            if (hasAutobidInLastBids && row.max_interval_seconds > 300) {
                probingScore += 20;
                suspiciousPatterns.push('РЕЗКОЕ_ПРЕКРАЩЕНИЕ_ПОСЛЕ_АВТОБИДА');
            }
            
            // 6. Цена значительно превышает стартовую
            const priceMultiplier = row.winning_bid / row.starting_bid;
            if (priceMultiplier > 3.0 && probingScore > 0) {
                probingScore += 25;
                suspiciousPatterns.push('ЗНАЧИТЕЛЬНОЕ_ПРЕВЫШЕНИЕ_ЦЕНЫ');
            }
            
            // Определяем уровень риска
            if (probingScore >= 80) {
                riskLevel = 'КРИТИЧЕСКИ ПОДОЗРИТЕЛЬНО';
            } else if (probingScore >= 50) {
                riskLevel = 'ПОДОЗРИТЕЛЬНО';
            } else if (probingScore >= 30) {
                riskLevel = 'ВНИМАНИЕ';
            }
            
            // Добавляем только подозрительные случаи
            if (riskLevel !== 'НОРМА') {
                probingCases.push({
                    lot_id: row.lot_id,
                    auction_number: row.auction_number,
                    lot_number: row.lot_number,
                    winner_login: row.winner_login,
                    winning_bid: row.winning_bid,
                    starting_bid: row.starting_bid,
                    total_bids: row.total_bids,
                    unique_bidders: row.unique_bidders,
                    autobid_count: row.autobid_count,
                    manual_bid_count: row.manual_bid_count,
                    autobid_ratio: Math.round(autobidRatio * 100) / 100,
                    avg_interval_seconds: Math.round(row.avg_interval_seconds * 10) / 10,
                    price_multiplier: Math.round(priceMultiplier * 100) / 100,
                    quick_bids_after_autobid: quickBidsAfterAutobid,
                    suspicious_patterns: suspiciousPatterns,
                    probing_score: probingScore,
                    risk_level: riskLevel,
                    category: row.category
                });
            }
        }
        
        // Сортируем по индексу прощупывания
        probingCases.sort((a, b) => b.probing_score - a.probing_score);
        
        console.log(`✅ Найдено ${probingCases.length} подозрительных случаев прощупывания автобидов`);
        
        res.json({
            success: true,
            data: probingCases,
            count: probingCases.length,
            parameters: {
                min_bids: minBids,
                max_seconds: maxSeconds,
                months: months
            },
            message: `Найдено ${probingCases.length} подозрительных случаев прощупывания автобидов`
        });
        
    } catch (error) {
        console.error('❌ Ошибка анализа прощупывания автобидов:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Ошибка анализа прощупывания автобидов',
            details: error.message 
        });
    }
});

// API для анализа стратегий разгона цен (Гипотеза 5)
app.get('/api/analytics/pricing-strategies', async (req, res) => {
    try {
        console.log('🔍 Начинаем анализ стратегий разгона цен...');
        
        const minBids = parseInt(req.query.min_bids) || 5;
        const minPriceMultiplier = parseFloat(req.query.min_price_multiplier) || 2.0;
        const months = parseInt(req.query.months) || 6;
        
        // Шаг 1: Находим лоты с высоким разгоном цен
        console.log(`🔍 Шаг 1: Ищем лоты с разгоном цен за ${months} месяцев...`);
        const pricingQuery = `
            WITH lot_bid_analysis AS (
                SELECT 
                    lb.lot_id,
                    lb.auction_number,
                    lb.lot_number,
                    lb.bidder_login,
                    lb.bid_amount,
                    lb.bid_timestamp,
                    lb.is_auto_bid,
                    ROW_NUMBER() OVER (PARTITION BY lb.lot_id ORDER BY lb.bid_timestamp) as bid_sequence,
                    LAG(lb.bid_amount) OVER (PARTITION BY lb.lot_id ORDER BY lb.bid_timestamp) as prev_bid_amount,
                    LAG(lb.bidder_login) OVER (PARTITION BY lb.lot_id ORDER BY lb.bid_timestamp) as prev_bidder,
                    EXTRACT(EPOCH FROM (lb.bid_timestamp - LAG(lb.bid_timestamp) OVER (PARTITION BY lb.lot_id ORDER BY lb.bid_timestamp))) as seconds_since_prev,
                    lb.bid_amount - LAG(lb.bid_amount) OVER (PARTITION BY lb.lot_id ORDER BY lb.bid_timestamp) as bid_increment,
                    (lb.bid_amount - al.starting_bid) / NULLIF(al.starting_bid, 0) as price_multiplier_at_bid
                FROM lot_bids lb
                JOIN auction_lots al ON lb.lot_id = al.id
                WHERE lb.bid_timestamp >= NOW() - INTERVAL '${months} months'
                  AND lb.bid_timestamp IS NOT NULL
                  AND al.winning_bid IS NOT NULL
                  AND al.starting_bid IS NOT NULL
                  AND al.starting_bid > 0
            ),
            lot_stats AS (
                SELECT 
                    lot_id,
                    auction_number,
                    lot_number,
                    COUNT(*) as total_bids,
                    COUNT(DISTINCT bidder_login) as unique_bidders,
                    COUNT(CASE WHEN is_auto_bid = true THEN 1 END) as autobid_count,
                    COUNT(CASE WHEN is_auto_bid = false THEN 1 END) as manual_bid_count,
                    AVG(seconds_since_prev) as avg_interval_seconds,
                    MIN(seconds_since_prev) as min_interval_seconds,
                    MAX(seconds_since_prev) as max_interval_seconds,
                    AVG(bid_increment) as avg_increment,
                    STDDEV(bid_increment) as increment_stddev,
                    MAX(price_multiplier_at_bid) as max_price_multiplier,
                    ARRAY_AGG(
                        JSON_BUILD_OBJECT(
                            'bidder', bidder_login,
                            'amount', bid_amount,
                            'timestamp', bid_timestamp,
                            'is_auto', is_auto_bid,
                            'sequence', bid_sequence,
                            'increment', bid_increment,
                            'interval_seconds', seconds_since_prev,
                            'price_multiplier', price_multiplier_at_bid
                        ) ORDER BY bid_timestamp
                    ) as bid_sequence_data
                FROM lot_bid_analysis
                GROUP BY lot_id, auction_number, lot_number
                HAVING COUNT(*) >= $1
            )
            SELECT 
                ls.*,
                al.winner_login,
                al.winning_bid,
                al.starting_bid,
                al.bids_count,
                al.category,
                (al.winning_bid / al.starting_bid) as final_price_multiplier
            FROM lot_stats ls
            JOIN auction_lots al ON ls.lot_id = al.id
            WHERE (al.winning_bid / al.starting_bid) >= $2
            ORDER BY (al.winning_bid / al.starting_bid) DESC
        `;
        
        const result = await pool.query(pricingQuery, [minBids, minPriceMultiplier]);
        console.log(`✅ Найдено ${result.rows.length} лотов с высоким разгоном цен`);
        
        // Шаг 2: Анализируем стратегии разгона
        console.log('🔍 Шаг 2: Анализируем стратегии разгона цен...');
        const pricingStrategies = [];
        
        for (const row of result.rows) {
            const bidData = row.bid_sequence_data;
            let strategyScore = 0;
            let riskLevel = 'НОРМА';
            let strategyType = 'НЕИЗВЕСТНО';
            
            // Анализируем паттерны разгона
            let suspiciousPatterns = [];
            
            // 1. Стратегия "Группа А": Сразу разгоняет цену
            const earlyBids = bidData.slice(0, Math.min(3, bidData.length));
            const earlyPriceMultiplier = earlyBids.length > 0 ? 
                Math.max(...earlyBids.map(bid => bid.price_multiplier || 0)) : 0;
            
            if (earlyPriceMultiplier > 1.5) {
                strategyScore += 30;
                strategyType = 'ГРУППА_А_БЫСТРЫЙ_РАЗГОН';
                suspiciousPatterns.push('БЫСТРЫЙ_РАЗГОН_В_НАЧАЛЕ');
            }
            
            // 2. Стратегия "Группа Б": Дает "повладеть" неделю, потом резко поднимает
            const midPoint = Math.floor(bidData.length / 2);
            const earlyPhase = bidData.slice(0, midPoint);
            const latePhase = bidData.slice(midPoint);
            
            const earlyMaxMultiplier = earlyPhase.length > 0 ? 
                Math.max(...earlyPhase.map(bid => bid.price_multiplier || 0)) : 0;
            const lateMaxMultiplier = latePhase.length > 0 ? 
                Math.max(...latePhase.map(bid => bid.price_multiplier || 0)) : 0;
            
            if (lateMaxMultiplier > earlyMaxMultiplier * 1.5) {
                strategyScore += 25;
                strategyType = 'ГРУППА_Б_ОТЛОЖЕННЫЙ_РАЗГОН';
                suspiciousPatterns.push('ОТЛОЖЕННЫЙ_РАЗГОН_ЦЕНЫ');
            }
            
            // 3. Систематические инкременты (роботизированное поведение)
            if (row.increment_stddev && row.increment_stddev < row.avg_increment * 0.2) {
                strategyScore += 20;
                suspiciousPatterns.push('СИСТЕМАТИЧНЫЕ_ИНКРЕМЕНТЫ');
            }
            
            // 4. Высокая активность с быстрыми ставками
            const fastBids = bidData.filter(bid => bid.interval_seconds && bid.interval_seconds < 30).length;
            const fastBidRatio = fastBids / bidData.length;
            
            if (fastBidRatio > 0.7) {
                strategyScore += 25;
                suspiciousPatterns.push('ВЫСОКАЯ_АКТИВНОСТЬ_БЫСТРЫХ_СТАВОК');
            }
            
            // 5. Концентрация ставок от одного пользователя
            const bidderCounts = {};
            bidData.forEach(bid => {
                bidderCounts[bid.bidder] = (bidderCounts[bid.bidder] || 0) + 1;
            });
            
            const maxBidsPerUser = Math.max(...Object.values(bidderCounts));
            const concentrationRatio = maxBidsPerUser / bidData.length;
            
            if (concentrationRatio > 0.6) {
                strategyScore += 20;
                suspiciousPatterns.push('КОНЦЕНТРАЦИЯ_СТАВОК_ОДНОГО_ПОЛЬЗОВАТЕЛЯ');
            }
            
            // 6. Резкие скачки цен
            const largeIncrements = bidData.filter(bid => 
                bid.increment && bid.increment > row.avg_increment * 2
            ).length;
            
            if (largeIncrements > 2) {
                strategyScore += 15;
                suspiciousPatterns.push('РЕЗКИЕ_СКАЧКИ_ЦЕН');
            }
            
            // 7. Очень высокий финальный множитель
            if (row.final_price_multiplier > 5.0) {
                strategyScore += 30;
                suspiciousPatterns.push('КРИТИЧЕСКИ_ВЫСОКИЙ_МНОЖИТЕЛЬ');
            } else if (row.final_price_multiplier > 3.0) {
                strategyScore += 20;
                suspiciousPatterns.push('ВЫСОКИЙ_МНОЖИТЕЛЬ');
            }
            
            // Определяем уровень риска
            if (strategyScore >= 80) {
                riskLevel = 'КРИТИЧЕСКИ ПОДОЗРИТЕЛЬНО';
            } else if (strategyScore >= 50) {
                riskLevel = 'ПОДОЗРИТЕЛЬНО';
            } else if (strategyScore >= 30) {
                riskLevel = 'ВНИМАНИЕ';
            }
            
            // Добавляем только подозрительные случаи
            if (riskLevel !== 'НОРМА') {
                pricingStrategies.push({
                    lot_id: row.lot_id,
                    auction_number: row.auction_number,
                    lot_number: row.lot_number,
                    winner_login: row.winner_login,
                    winning_bid: row.winning_bid,
                    starting_bid: row.starting_bid,
                    final_price_multiplier: Math.round(row.final_price_multiplier * 100) / 100,
                    total_bids: row.total_bids,
                    unique_bidders: row.unique_bidders,
                    autobid_count: row.autobid_count,
                    manual_bid_count: row.manual_bid_count,
                    avg_interval_seconds: Math.round(row.avg_interval_seconds * 10) / 10,
                    fast_bid_ratio: Math.round(fastBidRatio * 100) / 100,
                    concentration_ratio: Math.round(concentrationRatio * 100) / 100,
                    large_increments_count: largeIncrements,
                    strategy_type: strategyType,
                    suspicious_patterns: suspiciousPatterns,
                    strategy_score: strategyScore,
                    risk_level: riskLevel,
                    category: row.category
                });
            }
        }
        
        // Сортируем по индексу стратегии
        pricingStrategies.sort((a, b) => b.strategy_score - a.strategy_score);
        
        console.log(`✅ Найдено ${pricingStrategies.length} подозрительных стратегий разгона цен`);
        
        res.json({
            success: true,
            data: pricingStrategies,
            count: pricingStrategies.length,
            parameters: {
                min_bids: minBids,
                min_price_multiplier: minPriceMultiplier,
                months: months
            },
            message: `Найдено ${pricingStrategies.length} подозрительных стратегий разгона цен`
        });
        
    } catch (error) {
        console.error('❌ Ошибка анализа стратегий разгона цен:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Ошибка анализа стратегий разгона цен',
            details: error.message 
        });
    }
});

// API для анализа тактик приманки (Гипотеза 7)
app.get('/api/analytics/decoy-tactics', async (req, res) => {
    try {
        console.log('🔍 Начинаем анализ тактик приманки...');
        
        const minLots = parseInt(req.query.min_lots) || 3;
        const maxPriceDiff = parseFloat(req.query.max_price_diff) || 0.5; // 50% разница в цене
        const months = parseInt(req.query.months) || 6;
        
        // Шаг 1: Находим пользователей с подозрительными паттернами покупок
        console.log(`🔍 Шаг 1: Ищем пользователей с тактиками приманки за ${months} месяцев...`);
        const decoyQuery = `
            WITH user_purchases AS (
                SELECT 
                    al.winner_login,
                    al.coin_description,
                    al.year,
                    al.condition,
                    al.winning_bid,
                    al.starting_bid,
                    al.auction_number,
                    al.auction_end_date,
                    al.category,
                    (al.winning_bid / al.starting_bid) as price_multiplier
                FROM auction_lots al
                WHERE al.winner_login IS NOT NULL
                  AND al.winning_bid IS NOT NULL
                  AND al.winning_bid > 0
                  AND al.starting_bid IS NOT NULL
                  AND al.starting_bid > 0
                  AND al.auction_end_date >= NOW() - INTERVAL '${months} months'
            ),
            user_stats AS (
                SELECT 
                    winner_login,
                    COUNT(*) as total_purchases,
                    COUNT(DISTINCT coin_description) as unique_coins,
                    AVG(winning_bid) as avg_price,
                    MIN(winning_bid) as min_price,
                    MAX(winning_bid) as max_price,
                    AVG(price_multiplier) as avg_price_multiplier,
                    STDDEV(winning_bid) as price_stddev,
                    ARRAY_AGG(
                        JSON_BUILD_OBJECT(
                            'coin_description', coin_description,
                            'year', year,
                            'condition', condition,
                            'winning_bid', winning_bid,
                            'starting_bid', starting_bid,
                            'price_multiplier', price_multiplier,
                            'auction_number', auction_number,
                            'auction_end_date', auction_end_date,
                            'category', category
                        ) ORDER BY auction_end_date
                    ) as purchases
                FROM user_purchases
                GROUP BY winner_login
                HAVING COUNT(*) >= $1
            )
            SELECT *
            FROM user_stats
            ORDER BY total_purchases DESC
        `;
        
        const result = await pool.query(decoyQuery, [minLots]);
        console.log(`✅ Найдено ${result.rows.length} пользователей с множественными покупками`);
        
        // Шаг 2: Анализируем тактики приманки
        console.log('🔍 Шаг 2: Анализируем тактики приманки...');
        const decoyTactics = [];
        
        for (const row of result.rows) {
            const purchases = row.purchases;
            let decoyScore = 0;
            let riskLevel = 'НОРМА';
            let tacticType = 'НЕИЗВЕСТНО';
            
            // Анализируем паттерны покупок
            let suspiciousPatterns = [];
            
            // 1. Смешанные покупки: дешевые + дорогие
            const prices = purchases.map(p => p.winning_bid);
            const sortedPrices = [...prices].sort((a, b) => a - b);
            
            const cheapPurchases = sortedPrices.slice(0, Math.floor(sortedPrices.length / 2));
            const expensivePurchases = sortedPrices.slice(Math.floor(sortedPrices.length / 2));
            
            const avgCheapPrice = cheapPurchases.reduce((a, b) => a + b, 0) / cheapPurchases.length;
            const avgExpensivePrice = expensivePurchases.reduce((a, b) => a + b, 0) / expensivePurchases.length;
            
            if (avgExpensivePrice > avgCheapPrice * 3) {
                decoyScore += 25;
                tacticType = 'СМЕШАННЫЕ_ПОКУПКИ';
                suspiciousPatterns.push('СМЕШЕНИЕ_ДЕШЕВЫХ_И_ДОРОГИХ');
            }
            
            // 2. Паттерн "приманка": дешевая покупка перед дорогой
            let decoyPatterns = 0;
            for (let i = 0; i < purchases.length - 1; i++) {
                const current = purchases[i];
                const next = purchases[i + 1];
                
                // Если следующая покупка значительно дороже
                if (next.winning_bid > current.winning_bid * 2) {
                    decoyPatterns++;
                }
            }
            
            if (decoyPatterns > 0) {
                decoyScore += 20;
                suspiciousPatterns.push('ДЕШЕВАЯ_ПЕРЕД_ДОРОГОЙ');
            }
            
            // 3. Низкая вариация в дешевых покупках (систематичность)
            const cheapPriceStddev = Math.sqrt(
                cheapPurchases.reduce((sum, price) => sum + Math.pow(price - avgCheapPrice, 2), 0) / cheapPurchases.length
            );
            
            if (cheapPriceStddev < avgCheapPrice * 0.3) {
                decoyScore += 15;
                suspiciousPatterns.push('СИСТЕМАТИЧНЫЕ_ДЕШЕВЫЕ_ПОКУПКИ');
            }
            
            // 4. Высокие множители цен
            const highMultipliers = purchases.filter(p => p.price_multiplier > 2.0).length;
            const highMultiplierRatio = highMultipliers / purchases.length;
            
            if (highMultiplierRatio > 0.5) {
                decoyScore += 20;
                suspiciousPatterns.push('ВЫСОКИЕ_МНОЖИТЕЛИ_ЦЕН');
            }
            
            // 5. Концентрация по категориям
            const categoryCounts = {};
            purchases.forEach(p => {
                categoryCounts[p.category] = (categoryCounts[p.category] || 0) + 1;
            });
            
            const maxCategoryCount = Math.max(...Object.values(categoryCounts));
            const categoryConcentration = maxCategoryCount / purchases.length;
            
            if (categoryConcentration > 0.7) {
                decoyScore += 10;
                suspiciousPatterns.push('КОНЦЕНТРАЦИЯ_ПО_КАТЕГОРИЯМ');
            }
            
            // 6. Временные паттерны: быстрые последовательные покупки
            const timeGaps = [];
            for (let i = 1; i < purchases.length; i++) {
                const currentDate = new Date(purchases[i].auction_end_date);
                const prevDate = new Date(purchases[i-1].auction_end_date);
                const daysDiff = (currentDate - prevDate) / (1000 * 60 * 60 * 24);
                timeGaps.push(daysDiff);
            }
            
            const avgTimeGap = timeGaps.reduce((a, b) => a + b, 0) / timeGaps.length;
            const quickPurchases = timeGaps.filter(gap => gap < 7).length; // Менее недели
            
            if (quickPurchases > purchases.length * 0.5) {
                decoyScore += 15;
                suspiciousPatterns.push('БЫСТРЫЕ_ПОСЛЕДОВАТЕЛЬНЫЕ_ПОКУПКИ');
            }
            
            // 7. Очень высокие цены при низкой конкуренции (предполагаем по bids_count)
            const highPriceLowCompetition = purchases.filter(p => 
                p.winning_bid > 5000 && p.price_multiplier > 3.0
            ).length;
            
            if (highPriceLowCompetition > 0) {
                decoyScore += 25;
                suspiciousPatterns.push('ВЫСОКИЕ_ЦЕНЫ_ПРИ_НИЗКОЙ_КОНКУРЕНЦИИ');
            }
            
            // Определяем уровень риска
            if (decoyScore >= 80) {
                riskLevel = 'КРИТИЧЕСКИ ПОДОЗРИТЕЛЬНО';
            } else if (decoyScore >= 50) {
                riskLevel = 'ПОДОЗРИТЕЛЬНО';
            } else if (decoyScore >= 30) {
                riskLevel = 'ВНИМАНИЕ';
            }
            
            // Добавляем только подозрительные случаи
            if (riskLevel !== 'НОРМА') {
                decoyTactics.push({
                    winner_login: row.winner_login,
                    total_purchases: row.total_purchases,
                    unique_coins: row.unique_coins,
                    avg_price: Math.round(row.avg_price * 100) / 100,
                    min_price: row.min_price,
                    max_price: row.max_price,
                    price_range_ratio: Math.round((row.max_price / row.min_price) * 100) / 100,
                    avg_price_multiplier: Math.round(row.avg_price_multiplier * 100) / 100,
                    high_multiplier_ratio: Math.round(highMultiplierRatio * 100) / 100,
                    category_concentration: Math.round(categoryConcentration * 100) / 100,
                    quick_purchases_ratio: Math.round((quickPurchases / purchases.length) * 100) / 100,
                    decoy_patterns_count: decoyPatterns,
                    tactic_type: tacticType,
                    suspicious_patterns: suspiciousPatterns,
                    decoy_score: decoyScore,
                    risk_level: riskLevel
                });
            }
        }
        
        // Сортируем по индексу тактики приманки
        decoyTactics.sort((a, b) => b.decoy_score - a.decoy_score);
        
        console.log(`✅ Найдено ${decoyTactics.length} подозрительных тактик приманки`);
        
        res.json({
            success: true,
            data: decoyTactics,
            count: decoyTactics.length,
            parameters: {
                min_lots: minLots,
                max_price_diff: maxPriceDiff,
                months: months
            },
            message: `Найдено ${decoyTactics.length} подозрительных тактик приманки`
        });
        
    } catch (error) {
        console.error('❌ Ошибка анализа тактик приманки:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Ошибка анализа тактик приманки',
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

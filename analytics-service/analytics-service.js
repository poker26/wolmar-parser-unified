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

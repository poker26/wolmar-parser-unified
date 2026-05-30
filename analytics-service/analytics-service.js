try { require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') }); } catch (_) {}

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

// Подключение к базе данных (self-hosted Supabase)
const pool = new Pool({
    user: process.env.DB_USER || 'postgres.your-tenant-id',
    host: process.env.DB_HOST || 'sup.begemot26.ru',
    database: process.env.DB_NAME || 'postgres',
    password: process.env.DB_PASSWORD || process.env.POSTGRES_PASSWORD,
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    ssl: false,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    max: 10,
    allowExitOnIdle: true
});

// Вспомогательная функция для обновления скоринга пользователя
// Безопасный список разрешенных полей для предотвращения SQL-инъекций
const ALLOWED_SCORE_FIELDS = [
    'fast_bids_score',
    'autobid_traps_score',
    'linked_accounts_score',
    'carousel_score',
    'self_boost_score',
    'decoy_tactics_score',
    'pricing_strategies_score',
    'circular_buyers_score',
    'abandonment_score',
    'technical_bidders_score'
];

async function updateUserScore(winnerLogin, scoreField, scoreValue) {
    try {
        // Проверяем, что поле разрешено (защита от SQL-инъекций)
        if (!ALLOWED_SCORE_FIELDS.includes(scoreField)) {
            throw new Error(`Недопустимое поле скоринга: ${scoreField}`);
        }
        
        // Обновляем конкретное поле скоринга (используем безопасное имя поля)
        await pool.query(`
            INSERT INTO winner_ratings (winner_login, ${scoreField}, last_analysis_date)
            VALUES ($1, $2, NOW())
            ON CONFLICT (winner_login) DO UPDATE SET
                ${scoreField} = EXCLUDED.${scoreField},
                last_analysis_date = EXCLUDED.last_analysis_date
        `, [winnerLogin, scoreValue]);
        
        // Пересчитываем suspicious_score (триггер должен это делать автоматически, но на всякий случай обновим вручную)
        await pool.query(`
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
            WHERE winner_login = $1
        `, [winnerLogin]);
    } catch (error) {
        console.error(`❌ Ошибка обновления скоринга для ${winnerLogin}:`, error);
        throw error;
    }
}

// Проверка подключения к БД
pool.on('connect', () => {
    console.log('🔗 Analytics Service: Подключение к базе данных установлено');
});

pool.on('error', (err) => {
    console.error('❌ Analytics Service: Ошибка подключения к БД:', err);
    console.error('❌ Stack trace:', err.stack);
});

// Тестовое подключение при старте
(async () => {
    try {
        const testResult = await pool.query('SELECT 1 as test');
        console.log('✅ Тестовое подключение к БД успешно');
    } catch (err) {
        console.error('❌ Ошибка тестового подключения к БД:', err);
        console.error('❌ Stack trace:', err.stack);
        process.exit(1);
    }
})();

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
            await updateUserScore(user.bidder_login, 'fast_bids_score', fastBidsScore);
            
            updatedCount++;
            if (updatedCount % 10 === 0) {
                console.log(`📝 Обновлено ${updatedCount}/${rows.length} пользователей...`);
            }
        }
        
        console.log(`✅ Обновлено ${updatedCount} пользователей в winner_ratings`);
        
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
        // Теперь для всех категорий разрешен расчет прогноза, но для некоторых категорий
        // используется точное совпадение описания (см. requiresExactDescriptionMatch)
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
            await updateUserScore(winnerLogin, 'autobid_traps_score', autobidTrapsScore);
            
            updatedUsers++;
        }
        
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

// API для отчета по скорингу рисков
app.get('/api/analytics/risk-scoring', async (req, res) => {
    try {
        const minScore = parseInt(req.query.minScore) || 1;
        const levelFilter = req.query.levelFilter || '';
        
        // Определяем диапазон баллов для фильтра по уровню риска
        let minLevelScore = minScore;
        let maxLevelScore = null;
        
        if (levelFilter) {
            switch(levelFilter) {
                case 'КРИТИЧЕСКИЙ РИСК':
                    minLevelScore = Math.max(minScore, 301);
                    maxLevelScore = null; // без верхней границы
                    break;
                case 'ВЫСОКИЙ РИСК':
                    minLevelScore = Math.max(minScore, 151);
                    maxLevelScore = 300;
                    break;
                case 'ПОДОЗРИТЕЛЬНО':
                    minLevelScore = Math.max(minScore, 51);
                    maxLevelScore = 150;
                    break;
                case 'ВНИМАНИЕ':
                    minLevelScore = Math.max(minScore, 1);
                    maxLevelScore = 50;
                    break;
            }
        }
        
        // Формируем запрос с параметризацией
        let query = `
            SELECT 
                winner_login,
                suspicious_score,
                fast_bids_score,
                autobid_traps_score,
                linked_accounts_score,
                carousel_score,
                self_boost_score,
                decoy_tactics_score,
                pricing_strategies_score,
                circular_buyers_score,
                abandonment_score,
                technical_bidders_score,
                rating,
                category,
                COALESCE(total_spent, 0) as total_spent,
                COALESCE(total_lots, 0) as total_lots,
                last_analysis_date
            FROM winner_ratings
            WHERE suspicious_score >= $1
        `;
        
        const params = [minLevelScore];
        
        if (maxLevelScore !== null) {
            query += ` AND suspicious_score <= $2`;
            params.push(maxLevelScore);
        }
        
        query += ` ORDER BY suspicious_score DESC, winner_login ASC`;
        
        const { rows } = await pool.query(query, params);
        
        // Подсчитываем статистику по группам риска
        const stats = {
            critical: 0,
            high: 0,
            suspicious: 0,
            attention: 0
        };
        
        rows.forEach(user => {
            const score = user.suspicious_score || 0;
            if (score > 300) stats.critical++;
            else if (score > 150) stats.high++;
            else if (score > 50) stats.suspicious++;
            else if (score > 0) stats.attention++;
        });
        
        res.json({
            success: true,
            data: rows,
            count: rows.length,
            stats: stats
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения скоринга рисков:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Ошибка получения скоринга рисков',
            details: error.message 
        });
    }
});

// API для получения детальной расшифровки скоринга пользователя
app.get('/api/analytics/user-scoring/:login', async (req, res) => {
    try {
        const { login } = req.params;
        
        const query = `
            SELECT 
                winner_login,
                suspicious_score,
                fast_bids_score,
                autobid_traps_score,
                linked_accounts_score,
                carousel_score,
                self_boost_score,
                decoy_tactics_score,
                pricing_strategies_score,
                circular_buyers_score,
                abandonment_score,
                technical_bidders_score,
                rating,
                category,
                COALESCE(total_spent, 0) as total_spent,
                COALESCE(total_lots, 0) as total_lots,
                last_analysis_date
            FROM winner_ratings
            WHERE winner_login = $1
        `;
        
        const { rows } = await pool.query(query, [login]);
        
        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Пользователь не найден'
            });
        }
        
        const user = rows[0];
        
        // Определяем уровень риска
        let riskLevel = 'НОРМА';
        let riskLevelColor = 'text-gray-600';
        let riskLevelBg = 'bg-gray-50';
        const score = user.suspicious_score || 0;
        
        if (score > 300) {
            riskLevel = 'КРИТИЧЕСКИЙ РИСК';
            riskLevelColor = 'text-red-800';
            riskLevelBg = 'bg-red-50';
        } else if (score > 150) {
            riskLevel = 'ВЫСОКИЙ РИСК';
            riskLevelColor = 'text-orange-800';
            riskLevelBg = 'bg-orange-50';
        } else if (score > 50) {
            riskLevel = 'ПОДОЗРИТЕЛЬНО';
            riskLevelColor = 'text-yellow-800';
            riskLevelBg = 'bg-yellow-50';
        } else if (score > 0) {
            riskLevel = 'ВНИМАНИЕ';
            riskLevelColor = 'text-blue-800';
            riskLevelBg = 'bg-blue-50';
        }
        
        // Формируем детальную расшифровку с весовыми коэффициентами
        // ВАЖНО: Названия должны ТОЧНО совпадать с названиями в меню отчетов на фронтенде
        const scoringDetails = [
            {
                name: 'Связанные аккаунты',
                score: user.linked_accounts_score || 0,
                maxScore: 50,
                weight: 1.5,
                weightedScore: (user.linked_accounts_score || 0) * 1.5,
                description: 'Обнаружены связи между аккаунтами, указывающие на координацию действий'
            },
            {
                name: 'Карусель перепродаж',
                score: user.carousel_score || 0,
                maxScore: 50,
                weight: 1.5,
                weightedScore: (user.carousel_score || 0) * 1.5,
                description: 'Участие в каруселях перепродаж монет между одними и теми же участниками'
            },
            {
                name: 'Саморазгон/Самовыкуп',
                score: user.self_boost_score || 0,
                maxScore: 50,
                weight: 1.5,
                weightedScore: (user.self_boost_score || 0) * 1.5,
                description: 'Подозрительная активность по накрутке цен на собственные лоты'
            },
            {
                name: 'Тактики приманки',
                score: user.decoy_tactics_score || 0,
                maxScore: 50,
                weight: 1.2,
                weightedScore: (user.decoy_tactics_score || 0) * 1.2,
                description: 'Систематические покупки по завышенным ценам, повторные покупки одних монет'
            },
            {
                name: 'Стратегии разгона',
                score: user.pricing_strategies_score || 0,
                maxScore: 50,
                weight: 1.2,
                weightedScore: (user.pricing_strategies_score || 0) * 1.2,
                description: 'Подозрительные паттерны в ценообразовании и стратегиях ставок'
            },
            {
                name: 'Круговые покупки',
                score: user.circular_buyers_score || 0,
                maxScore: 50,
                weight: 1.2,
                weightedScore: (user.circular_buyers_score || 0) * 1.2,
                description: 'Повторные покупки одних и тех же монет (фиктивные покупатели)'
            },
            {
                name: 'Быстрые ставки',
                score: user.fast_bids_score || 0,
                maxScore: 50,
                weight: 1.0,
                weightedScore: (user.fast_bids_score || 0) * 1.0,
                description: 'Аномально быстрые реакции на ставки других участников'
            },
            {
                name: 'Ловушки автобида',
                score: user.autobid_traps_score || 0,
                maxScore: 50,
                weight: 1.0,
                weightedScore: (user.autobid_traps_score || 0) * 1.0,
                description: 'Использование автобидов для манипулирования ценами'
            },
            {
                name: 'Замирание торгов',
                score: user.abandonment_score || 0,
                maxScore: 50,
                weight: 1.0,
                weightedScore: (user.abandonment_score || 0) * 1.0,
                description: 'Резкое прекращение торгов после активных ставок (подозрительные паузы)'
            },
            {
                name: 'Технические пользователи',
                score: user.technical_bidders_score || 0,
                maxScore: 50,
                weight: 0.8,
                weightedScore: (user.technical_bidders_score || 0) * 0.8,
                description: 'Использование технических средств для автоматизации ставок'
            }
        ];
        
        // Фильтруем только те категории, где есть баллы
        const activeScoring = scoringDetails.filter(item => item.score > 0);
        
        res.json({
            success: true,
            data: {
                winner_login: user.winner_login,
                suspicious_score: user.suspicious_score || 0,
                risk_level: riskLevel,
                risk_level_color: riskLevelColor,
                risk_level_bg: riskLevelBg,
                rating: user.rating,
                category: user.category,
                total_spent: user.total_spent,
                total_lots: user.total_lots,
                last_analysis_date: user.last_analysis_date,
                scoring_details: activeScoring,
                all_scoring_details: scoringDetails
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения расшифровки скоринга:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения расшифровки скоринга',
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
        
        // Обновляем скоринг для найденных пользователей
        let updatedCount = 0;
        for (const case_ of suspiciousCases) {
            if (case_.winner_login) {
                // Определяем балл на основе suspicion_score (макс 40 для высокой категории)
                let score = 0;
                if (case_.suspicion_score >= 80) {
                    score = 40; // Критично
                } else if (case_.suspicion_score >= 50) {
                    score = 30; // Высокий
                } else if (case_.suspicion_score >= 30) {
                    score = 20; // Средний
                }
                
                if (score > 0) {
                    await updateUserScore(case_.winner_login, 'circular_buyers_score', score);
                    updatedCount++;
                }
            }
        }
        
        console.log(`✅ Обновлен скоринг для ${updatedCount} пользователей`);
        
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
            console.log(`🔍 Отладка автобидов - первые 5 пользователей:`);
            profilesResult.rows.slice(0, 5).forEach((user, i) => {
                console.log(`   Пользователь ${i+1}: ${user.bidder_login}, автобид_ratio: ${user.avg_auto_bid_ratio} (тип: ${typeof user.avg_auto_bid_ratio})`);
            });
            
            const autobidRatios = profilesResult.rows
                .map(user => parseFloat(user.avg_auto_bid_ratio))
                .filter(ratio => !isNaN(ratio) && ratio !== null && ratio !== undefined);
            
            console.log(`📊 Статистика автобидов:`);
            console.log(`   Всего пользователей: ${profilesResult.rows.length}`);
            console.log(`   Валидных значений: ${autobidRatios.length}`);
            
            if (autobidRatios.length > 0) {
                const avgAutobidRatio = autobidRatios.reduce((a, b) => a + b, 0) / autobidRatios.length;
                const maxAutobidRatio = Math.max(...autobidRatios);
                const minAutobidRatio = Math.min(...autobidRatios);
                
                console.log(`   Средний % автобидов: ${(avgAutobidRatio * 100).toFixed(1)}%`);
                console.log(`   Максимальный %: ${(maxAutobidRatio * 100).toFixed(1)}%`);
                console.log(`   Минимальный %: ${(minAutobidRatio * 100).toFixed(1)}%`);
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
                
                // Вычисляем похожесть автобидов (конвертируем строки в числа)
                const user1Autobid = parseFloat(user1.avg_auto_bid_ratio) || 0;
                const user2Autobid = parseFloat(user2.avg_auto_bid_ratio) || 0;
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
        
        // Обновляем скоринг для найденных пользователей
        const userScores = new Map();
        linkedAccounts.forEach(pair => {
            // Определяем балл на основе similarity
            // Обновленная шкала: Критично >=0.95, Высокий >=0.90, Средний >=0.85, Низкий >=0.80
            let score = 0;
            if (pair.similarity >= 0.95) {
                score = 50; // Критично
            } else if (pair.similarity >= 0.90) {
                score = 40; // Высокий
            } else if (pair.similarity >= 0.85) {
                score = 30; // Средний
            } else if (pair.similarity >= 0.80) {
                score = 20; // Низкий
            }
            
            // Берем максимальный балл для каждого пользователя (если он в нескольких парах)
            if (!userScores.has(pair.user1) || userScores.get(pair.user1) < score) {
                userScores.set(pair.user1, score);
            }
            if (!userScores.has(pair.user2) || userScores.get(pair.user2) < score) {
                userScores.set(pair.user2, score);
            }
        });
        
        // Обновляем скоринг в базе данных
        let updatedCount = 0;
        for (const [userLogin, score] of userScores) {
            await updateUserScore(userLogin, 'linked_accounts_score', score);
            updatedCount++;
        }
        
        console.log(`✅ Обновлен скоринг для ${updatedCount} пользователей`);
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
        // Сканируем ВЕСЬ набор кандидатов: реальные карусели — это короткие серии (3-4 продажи),
        // которые при ORDER BY COUNT(*) DESC LIMIT 1000 отсекались в пользу ходовых монет.
        // Per-coin SQL больше нет (только один Step-1 запрос + чистый JS), поэтому это дёшево.
        const limit = Math.max(100, Math.min(parseInt(req.query.limit) || 20000, 50000));
        
        // Шаг 1: Находим монеты с несколькими продажами В РАЗНЫХ АУКЦИОНАХ
        // В одном аукционе одна монета = один лот, но могут быть разные экземпляры одинакового типа.
        // Поэтому считаем только отдельные аукционы и формируем последовательности по одному представлению на аукцион.
        console.log(`🔍 Шаг 1: Ищем монеты с ${minSales}+ продажами (по разным аукционам) за ${months} месяцев...`);
        // Берём ПОСЛЕДОВАТЕЛЬНОСТЬ победителей по продажам (а не агрегат по аукциону без winner_login,
        // как было раньше). Концентрация победителей — главный дискриминатор бот-карусели.
        const coinSalesQuery = `
            WITH sales AS (
                SELECT
                    al.coin_description,
                    al.year,
                    al.condition,
                    al.auction_number,
                    al.winner_login,
                    al.winning_bid,
                    al.auction_end_date
                FROM auction_lots al
                WHERE al.winner_login IS NOT NULL
                  AND al.winning_bid IS NOT NULL
                  AND al.winning_bid > 0
                  AND al.auction_end_date >= NOW() - INTERVAL '${months} months'
            )
            SELECT
                s.coin_description,
                s.year,
                s.condition,
                COUNT(*) as sales_count,
                COUNT(DISTINCT s.auction_number) as auctions_count,
                ARRAY_AGG(s.winner_login   ORDER BY s.auction_end_date) as winners,
                ARRAY_AGG(s.auction_number ORDER BY s.auction_end_date) as auctions,
                ARRAY_AGG(s.winning_bid    ORDER BY s.auction_end_date) as prices,
                ARRAY_AGG(s.auction_end_date ORDER BY s.auction_end_date) as dates,
                MIN(s.auction_end_date) as first_sale,
                MAX(s.auction_end_date) as last_sale
            FROM sales s
            GROUP BY s.coin_description, s.year, s.condition
            HAVING COUNT(DISTINCT s.auction_number) >= $1
            ORDER BY COUNT(*) DESC
            LIMIT ${limit}
        `;

        const coinSalesResult = await pool.query(coinSalesQuery, [minSales]);
        console.log(`✅ Найдено ${coinSalesResult.rows.length} монет с множественными продажами (ограничение: ${limit}, период: ${months} мес)`);
        
        // Шаг 2: Анализируем каждую монету на предмет карусели
        console.log('🔍 Шаг 2: Анализируем карусели перепродаж...');
        const carousels = [];
        
        for (const coin of coinSalesResult.rows) {
            const winners = (coin.winners || []).filter(Boolean);
            const prices = (coin.prices || []).map(Number);
            const dates = coin.dates || [];
            const auctions = coin.auctions || [];
            const sales = winners.length;
            if (sales < 2) continue;

            // Концентрация победителей — подпись бот-карусели:
            // один логин раз за разом выигрывает один и тот же предмет.
            const counts = {};
            for (const w of winners) counts[w] = (counts[w] || 0) + 1;
            const uniqueWinners = Object.keys(counts).length;
            const winnerRatio = uniqueWinners / sales;
            let top1 = null, top1Wins = 0;
            for (const [w, c] of Object.entries(counts)) {
                if (c > top1Wins) { top1Wins = c; top1 = w; }
            }
            const top1Share = top1Wins / sales;

            const timeSpanWeeks = (new Date(coin.last_sale) - new Date(coin.first_sale)) / (1000 * 60 * 60 * 24 * 7);
            let priceGrowth = 0;
            if (prices.length > 1 && prices[0] > 0) {
                priceGrowth = ((prices[prices.length - 1] - prices[0]) / prices[0]) * 100;
            }

            // ГЕЙТ: кандидат в карусели только при реальной концентрации победителей.
            // Популярная ходовая монета (каждая продажа — новому покупателю, winnerRatio≈1)
            // сюда НЕ попадает — это и был основной источник ложных срабатываний.
            const isCandidate = (top1Share >= 0.5) || (winnerRatio <= 0.67);
            let carouselScore = 0;
            let riskLevel = 'НОРМА';

            if (isCandidate) {
                // 1. Концентрация победителей — основной вес
                if (top1Share >= 0.6) {
                    carouselScore += 40;
                } else if (winnerRatio <= 0.5) {
                    carouselScore += 30;
                } else {
                    carouselScore += 15; // winnerRatio в (0.5, 0.67]
                }
                // 2. Рост цены вдоль цепочки — корроборатор
                if (priceGrowth > 50) {
                    carouselScore += 20;
                } else if (priceGrowth > 20) {
                    carouselScore += 10;
                }
                // 3. Короткий период между продажами — слабый корроборатор (было 25)
                if (timeSpanWeeks < maxWeeks) {
                    carouselScore += 10;
                }
            }

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
                    sales_count: sales,
                    unique_winners: uniqueWinners,
                    winner_ratio: Math.round(winnerRatio * 100) / 100,
                    top_winner: top1,
                    top_winner_wins: top1Wins,
                    top_winner_share: Math.round(top1Share * 100) / 100,
                    max_wins_per_user: top1Wins,
                    time_span_weeks: Math.round(timeSpanWeeks * 10) / 10,
                    price_growth_pct: Math.round(priceGrowth * 10) / 10,
                    winners: winners,
                    winner_counts: counts,
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
        
        // Скоринг начисляем ТОЛЬКО повторным победителям (членам кольца, count>=2),
        // а не разовым «внешним» покупателям, случайно попавшим в ту же группу монет.
        const winnerScores = new Map();

        for (const carousel of carousels) {
            // Балл на основе carousel_score
            let score = 0;
            if (carousel.carousel_score >= 80) {
                score = 50; // Критично
            } else if (carousel.carousel_score >= 50) {
                score = 40; // Высокий
            } else if (carousel.carousel_score >= 30) {
                score = 30; // Средний
            }

            for (const [login, c] of Object.entries(carousel.winner_counts || {})) {
                if (!login || c < 2) continue; // только повторные победители
                if (!winnerScores.has(login) || winnerScores.get(login) < score) {
                    winnerScores.set(login, score);
                }
            }
        }

        // Обновляем скоринг в базе данных
        let updatedCount = 0;
        for (const [userLogin, score] of winnerScores) {
            await updateUserScore(userLogin, 'carousel_score', score);
            updatedCount++;
        }

        console.log(`✅ Обновлен скоринг для ${updatedCount} повторных победителей из каруселей`);
        
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

// Детали карусели перепродаж по монете
app.get('/api/analytics/carousel-details', async (req, res) => {
    try {
        const { coin_description, year, condition, months } = req.query;
        const monthsInt = parseInt(months) || 6;
        if (!coin_description || !year || !condition) {
            return res.status(400).json({ success: false, error: 'Необходимо указать coin_description, year, condition' });
        }

        console.log(`🔍 Детали карусели для: ${coin_description} ${year} (${condition}), период ${monthsInt} мес`);

        // 1) Продажи по монете
        const salesQuery = `
            SELECT 
                al.id as lot_id,
                al.auction_number,
                al.lot_number,
                al.auction_end_date,
                al.winner_login,
                al.winning_bid
            FROM auction_lots al
            WHERE al.coin_description = $1
              AND al.year = $2
              AND al.condition = $3
              AND al.winner_login IS NOT NULL
              AND al.winning_bid IS NOT NULL
              AND al.winning_bid > 0
              AND al.auction_end_date >= NOW() - INTERVAL '${monthsInt} months'
            ORDER BY al.auction_end_date ASC
        `;
        const salesResult = await pool.query(salesQuery, [coin_description, year, condition]);

        // 2) Участники по каждой продаже
        const lotIds = salesResult.rows.map(r => r.lot_id);
        let participantsByLot = new Map();
        // Инициализируем пустые массивы для всех лотов, чтобы на фронте не было undefined
        lotIds.forEach(id => participantsByLot.set(id, []));
        if (lotIds.length > 0) {
            const participantsQuery = `
                SELECT lb.lot_id, lb.bidder_login, COUNT(*) as bids
                FROM lot_bids lb
                WHERE lb.lot_id = ANY($1)
                GROUP BY lb.lot_id, lb.bidder_login
            `;
            const partsRes = await pool.query(participantsQuery, [lotIds]);
            partsRes.rows.forEach(r => {
                if (!participantsByLot.has(r.lot_id)) participantsByLot.set(r.lot_id, []);
                participantsByLot.get(r.lot_id).push({ bidder_login: r.bidder_login, bids: parseInt(r.bids) });
            });
        }

        // 3) Метрики и граф
        const sales = salesResult.rows.map(r => ({
            lot_id: r.lot_id,
            auction_number: r.auction_number,
            lot_number: r.lot_number,
            auction_end_date: r.auction_end_date,
            winner_login: r.winner_login,
            winning_bid: parseFloat(r.winning_bid)
        }));

        const winners = sales.map(s => s.winner_login);
        const uniqueWinners = Array.from(new Set(winners));
        const winnerRatio = sales.length ? uniqueWinners.length / sales.length : 0;
        const timeSpanWeeks = sales.length ? ((new Date(sales[sales.length - 1].auction_end_date) - new Date(sales[0].auction_end_date)) / (1000*60*60*24*7)) : 0;
        let priceGrowthPct = 0;
        if (sales.length > 1) {
            const first = sales[0].winning_bid;
            const last = sales[sales.length - 1].winning_bid;
            if (first > 0) priceGrowthPct = ((last - first) / first) * 100;
        }

        // Граф участников: узлы — пользователи, рёбра — совместное участие в разных продажах
        const userSet = new Set();
        sales.forEach(s => (participantsByLot.get(s.lot_id) || []).forEach(p => userSet.add(p.bidder_login)));
        const nodes = Array.from(userSet).map(u => ({ id: u, name: u }));

        // Ко-участие: для каждой пары пользователей считаем, сколько продаж они проходили вместе
        const coMap = new Map(); // key: a||b sorted, value: count
        sales.forEach(s => {
            const bidders = (participantsByLot.get(s.lot_id) || []).map(p => p.bidder_login);
            for (let i = 0; i < bidders.length; i++) {
                for (let j = i + 1; j < bidders.length; j++) {
                    const a = bidders[i]; const b = bidders[j];
                    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
                    coMap.set(key, (coMap.get(key) || 0) + 1);
                }
            }
        });

        const links = [];
        coMap.forEach((count, key) => {
            const [a, b] = key.split('|');
            // Порог для уменьшения шума
            if (count >= 2) links.push({ source: a, target: b, co_sales: count });
        });

        // Ответ
        res.json({
            success: true,
            data: {
                sales,
                participantsByLot: Object.fromEntries(Array.from(participantsByLot.entries()).map(([k,v]) => [String(k), v])),
                metrics: {
                    sales_count: sales.length,
                    unique_winners: uniqueWinners.length,
                    winner_ratio: Math.round(winnerRatio * 100) / 100,
                    time_span_weeks: Math.round(timeSpanWeeks * 10) / 10,
                    price_growth_pct: Math.round(priceGrowthPct * 10) / 10
                },
                graph: { nodes, links }
            }
        });
    } catch (error) {
        console.error('❌ Ошибка деталей карусели:', error);
        res.status(500).json({ success: false, error: 'Ошибка деталей карусели', details: error.message });
    }
});

// API для анализа замирания торгов (Гипотеза 3)
app.get('/api/analytics/abandonment-analysis', async (req, res) => {
    try {
        console.log('🔍 Начинаем анализ замирания торгов...');
        
        const minBids = parseInt(req.query.min_bids) || 5;
        const maxSeconds = parseInt(req.query.max_seconds) || (5 * 3600);
        const months = parseInt(req.query.months) || 3;
        
        // Шаг 1: Находим лоты с резким прекращением торгов
        console.log(`🔍 Шаг 1: Ищем лоты с замиранием торгов за ${months} месяцев...`);
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
        console.log(`✅ Найдено ${result.rows.length} лотов с замиранием торгов`);
        
        // Шаг 2: Анализируем паттерны заглохания
        console.log('🔍 Шаг 2: Анализируем паттерны замирания...');
        const abandonmentCases = [];
        
        for (const row of result.rows) {
            const bidData = row.bid_sequence_data;
            let abandonmentScore = 0;
            let riskLevel = 'НОРМА';
            
            // Анализируем последовательность ставок
            let suspiciousPatterns = [];
            
            // 1. Резкое прекращение после активных торгов
            if (row.max_gap_seconds > 18000) { // > 5 часов
                abandonmentScore += 25;
                suspiciousPatterns.push('ДЛИТЕЛЬНАЯ_ПАУЗА');
            }
            
            // 2. Замирание после ручных ставок
            const manualBids = bidData.filter(bid => !bid.is_auto).length;
            const autoBids = bidData.filter(bid => bid.is_auto).length;
            
            if (manualBids > 0 && autoBids === 0) {
                abandonmentScore += 20;
                suspiciousPatterns.push('ТОЛЬКО_РУЧНЫЕ_СТАВКИ');
            }
            
            // 3. Замирание после быстрых ставок (значимо только при последующей паузе > 5 часов)
            const fastBids = bidData.filter(bid => bid.gap_seconds && bid.gap_seconds < 10).length;
            if (fastBids > 2 && row.max_gap_seconds > 18000) {
                abandonmentScore += 30;
                suspiciousPatterns.push('БЫСТРЫЕ_СТАВКИ_ПЕРЕД_ЗАМИРАНИЕМ');
            }
            
            // 4. Низкая конкуренция
            if (row.unique_bidders < 3) {
                abandonmentScore += 15;
                suspiciousPatterns.push('НИЗКАЯ_КОНКУРЕНЦИЯ');
            }
            
            // 5. Критерий, завязанный на стартовой цене, исключен как нерелевантный
            
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
                    manual_bids: manualBids,
                    auto_bids: autoBids,
                    suspicious_patterns: suspiciousPatterns,
                    abandonment_score: abandonmentScore,
                    risk_level: riskLevel,
                    category: row.category
                });
            }
        }
        
        // Сортируем по индексу замирания
        abandonmentCases.sort((a, b) => b.abandonment_score - a.abandonment_score);
        
        console.log(`✅ Найдено ${abandonmentCases.length} подозрительных случаев замирания торгов`);
        
        // Обновляем скоринг для найденных пользователей
        const userScores = new Map();
        abandonmentCases.forEach(case_ => {
            if (case_.winner_login) {
                // Определяем балл на основе abandonment_score (макс 30 для средней категории)
                let score = 0;
                if (case_.abandonment_score >= 80) {
                    score = 30; // Критично
                } else if (case_.abandonment_score >= 50) {
                    score = 20; // Высокий
                } else if (case_.abandonment_score >= 30) {
                    score = 15; // Средний
                }
                
                // Берем максимальный балл для каждого пользователя
                if (!userScores.has(case_.winner_login) || userScores.get(case_.winner_login) < score) {
                    userScores.set(case_.winner_login, score);
                }
            }
        });
        
        // Обновляем скоринг в базе данных
        let updatedCount = 0;
        for (const [userLogin, score] of userScores) {
            await updateUserScore(userLogin, 'abandonment_score', score);
            updatedCount++;
        }
        
        console.log(`✅ Обновлен скоринг для ${updatedCount} пользователей`);
        
        res.json({
            success: true,
            data: abandonmentCases,
            count: abandonmentCases.length,
            parameters: {
                min_bids: minBids,
                max_seconds: maxSeconds,
                months: months
            },
            message: `Найдено ${abandonmentCases.length} подозрительных случаев замирания торгов`
        });
        
    } catch (error) {
        console.error('❌ Ошибка анализа замирания торгов:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Ошибка анализа замирания торгов',
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
        
        // Обновляем скоринг для найденных пользователей
        const userScores = new Map();
        probingCases.forEach(case_ => {
            if (case_.winner_login) {
                // Определяем балл на основе probing_score
                let score = 0;
                if (case_.probing_score >= 80) {
                    score = 50; // Критично
                } else if (case_.probing_score >= 50) {
                    score = 40; // Высокий
                } else if (case_.probing_score >= 30) {
                    score = 30; // Средний
                }
                
                // Берем максимальный балл для каждого пользователя
                if (!userScores.has(case_.winner_login) || userScores.get(case_.winner_login) < score) {
                    userScores.set(case_.winner_login, score);
                }
            }
        });
        
        // Обновляем скоринг в базе данных
        let updatedCount = 0;
        for (const [userLogin, score] of userScores) {
            await updateUserScore(userLogin, 'self_boost_score', score);
            updatedCount++;
        }
        
        console.log(`✅ Обновлен скоринг для ${updatedCount} пользователей`);
        
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

// API: Стратегии разгона цен (без predicted price)
app.get('/api/analytics/pricing-strategies', async (req, res) => {
    try {
        console.log('🔍 Начинаем анализ стратегий разгона (без predicted price)...');
        const months = parseInt(req.query.months) || 6;
        const minBids = parseInt(req.query.min_bids) || 10;
        const fastGap = parseInt(req.query.fast_gap_seconds) || 30; // ослабим порог быстроты
        const minFastShare = parseFloat(req.query.min_fast_share || '0.2'); // ослабим долю быстрых
        const maxUniqueBidders = parseInt(req.query.max_unique_bidders) || 6;
        const windowSize = parseInt(req.query.window_size) || 15; // анализируем последние N ставок

        const query = `
            WITH bids AS (
                SELECT 
                    lb.lot_id,
                    lb.bidder_login,
                    lb.bid_amount,
                    lb.bid_timestamp,
                    lb.is_auto_bid,
                    LAG(lb.bid_timestamp) OVER (PARTITION BY lb.lot_id ORDER BY lb.bid_timestamp) AS prev_ts,
                    ROW_NUMBER() OVER (PARTITION BY lb.lot_id ORDER BY lb.bid_timestamp DESC) AS rn
                FROM lot_bids lb
                JOIN auction_lots al ON al.id = lb.lot_id
                WHERE lb.bid_timestamp IS NOT NULL
                  AND lb.bid_timestamp >= NOW() - INTERVAL '${months} months'
            ),
            bids_window AS (
                SELECT * FROM bids WHERE rn <= ${windowSize}
            ),
            marked AS (
                SELECT 
                    lot_id,
                    bidder_login,
                    bid_amount,
                    bid_timestamp,
                    is_auto_bid,
                    CASE WHEN is_auto_bid IS NOT TRUE AND prev_ts IS NOT NULL AND EXTRACT(EPOCH FROM (bid_timestamp - prev_ts)) < ${fastGap} THEN 1 ELSE 0 END AS fast_manual
                FROM bids_window
            ),
            per_lot AS (
                SELECT 
                    lot_id,
                    COUNT(*) AS total_bids,
                    COUNT(*) FILTER (WHERE is_auto_bid IS NOT TRUE) AS manual_bids,
                    COUNT(*) FILTER (WHERE fast_manual = 1) AS fast_manual_bids,
                    COUNT(DISTINCT bidder_login) AS unique_bidders
                FROM marked
                GROUP BY lot_id
                HAVING COUNT(*) >= ${minBids}
            ),
            per_user_fast AS (
                SELECT lot_id, bidder_login, COUNT(*) AS fast_count
                FROM marked
                WHERE fast_manual = 1
                GROUP BY lot_id, bidder_login
            ),
            suspicious AS (
                SELECT winner_login AS user_login, suspicious_score
                FROM winner_ratings
            ),
            fast_with_scores AS (
                SELECT 
                    puf.lot_id,
                    puf.bidder_login,
                    puf.fast_count,
                    COALESCE(s.suspicious_score, 0) AS suspicious_score
                FROM per_user_fast puf
                LEFT JOIN suspicious s ON s.user_login = puf.bidder_login
            ),
            lot_fast_stats AS (
                SELECT 
                    lot_id,
                    SUM(fast_count) AS total_fast,
                    MAX(fast_count) AS top1_fast,
                    MAX(CASE WHEN rn = 2 THEN fast_count ELSE 0 END) AS top2_fast,
                    SUM(fast_count * (COALESCE(suspicious_score,0)::float / 100.0))::float / NULLIF(SUM(fast_count),0) AS fast_weighted_suspicion
                FROM (
                    SELECT *, ROW_NUMBER() OVER (PARTITION BY lot_id ORDER BY fast_count DESC) AS rn
                    FROM fast_with_scores
                ) t
                GROUP BY lot_id
            )
            SELECT 
                al.id AS lot_id,
                al.auction_number,
                al.lot_number,
                al.winner_login,
                al.winning_bid,
                pl.total_bids,
                pl.manual_bids,
                pl.fast_manual_bids,
                pl.unique_bidders,
                lfs.total_fast,
                lfs.top1_fast,
                lfs.top2_fast,
                COALESCE(lfs.fast_weighted_suspicion, 0) AS fast_weighted_suspicion
            FROM per_lot pl
            JOIN auction_lots al ON al.id = pl.lot_id
            LEFT JOIN lot_fast_stats lfs ON lfs.lot_id = pl.lot_id
            WHERE pl.fast_manual_bids::float / NULLIF(pl.manual_bids,0) >= ${minFastShare}
              AND pl.unique_bidders <= ${maxUniqueBidders}
        `;

        const { rows } = await pool.query(query);
        console.log(`ℹ️ pricing-strategies: rows after filters = ${rows.length} (months=${months}, minBids=${minBids}, fastGap=${fastGap}, minFastShare=${minFastShare}, maxUnique=${maxUniqueBidders})`);
        const items = rows.map(r => {
            const totalFast = Number(r.total_fast || 0);
            const top1 = Number(r.top1_fast || 0);
            const top2 = Number(r.top2_fast || 0);
            const totalBids = Number(r.total_bids || 0);
            const fastManualShare = Number(r.fast_manual_bids || 0) / (totalBids || 1);
            const top1Share = totalFast > 0 ? top1 / totalFast : 0;
            const top12Share = totalFast > 0 ? (top1 + top2) / totalFast : 0;
            const weightedSusp = Number(r.fast_weighted_suspicion || 0);

            let score = 0; const patterns = [];
            if (top1Share >= 0.5) { score += 35; patterns.push('ДОМИНИРОВАНИЕ_TOP1'); }
            else if (top1Share >= 0.35) { score += 20; patterns.push('СИЛЬНЫЙ_TOP1'); }
            if (top12Share >= 0.7) { score += 15; patterns.push('ДОМИНИРОВАНИЕ_TOP1_2'); }
            if (weightedSusp >= 0.5) { score += 20; patterns.push('ПОДОЗРИТЕЛЬНЫЕ_УСИЛИТЕЛИ'); }
            if (fastManualShare >= 0.5) { score += 10; patterns.push('МНОГО_БЫСТРЫХ_РУЧНЫХ'); }
            if (Number(r.unique_bidders) <= 3 && fastManualShare >= 0.4) { score += 10; patterns.push('НИЗКАЯ_КОНКУРЕНЦИЯ'); }

            let risk = 'НОРМА';
            if (score >= 70) risk = 'КРИТИЧЕСКИ ПОДОЗРИТЕЛЬНО';
            else if (score >= 45) risk = 'ПОДОЗРИТЕЛЬНО';
            else if (score >= 25) risk = 'ВНИМАНИЕ';

            return {
                lot_id: r.lot_id,
                auction_number: r.auction_number,
                lot_number: r.lot_number,
                winner_login: r.winner_login,
                winning_bid: Number(r.winning_bid),
                total_bids: totalBids,
                manual_bids: Number(r.manual_bids || 0),
                fast_manual_bids: Number(r.fast_manual_bids || 0),
                unique_bidders: Number(r.unique_bidders || 0),
                fast_manual_share: Math.round(fastManualShare * 1000) / 1000,
                top1_fast_share: Math.round(top1Share * 1000) / 1000,
                top12_fast_share: Math.round(top12Share * 1000) / 1000,
                fast_weighted_suspicion: Math.round(weightedSusp * 1000) / 1000,
                score,
                risk_level: risk,
                patterns
            };
        }).filter(i => i.risk_level !== 'НОРМА' && i.fast_weighted_suspicion > 0);

        items.sort((a, b) => b.fast_weighted_suspicion - a.fast_weighted_suspicion);
        console.log(`✅ Стратегии разгона: ${items.length} подозрительных лотов (отфильтровано по взвешенной подозрительности > 0)`);
        res.json({ success: true, data: items, count: items.length, parameters: { months, min_bids: minBids, fast_gap_seconds: fastGap, min_fast_share: minFastShare, max_unique_bidders: maxUniqueBidders } });
    } catch (error) {
        console.error('❌ Ошибка анализа стратегий разгона:', error);
        res.status(500).json({ success: false, error: 'Ошибка анализа стратегий разгона', details: error.message });
    }
});

// API: Саморазгон / Самовыкуп
app.get('/api/analytics/self-boost', async (req, res) => {
    try {
        console.log('🔍 Начинаем анализ саморазгона/самовыкупа...');
        const months = parseInt(req.query.months) || 6;
        const minConsecutive = parseInt(req.query.min_consecutive) || 3; // подряд ручных ставок победителя ближе к финалу
        const minSelfShare = parseFloat(req.query.min_self_share) || 0.6; // доля само-повышений среди его ручных ставок
        const maxGapFastCascade = parseInt(req.query.max_gap_fast) || 30; // сек для быстрого каскада
        const maxUniqueBidders = parseInt(req.query.max_unique_bidders) || 2; // низкая конкуренция

        // Подготовка ставок с порядком и группировкой последовательностей одного и того же пользователя
        const query = `
            WITH bids AS (
                SELECT 
                    lb.lot_id,
                    lb.bidder_login,
                    lb.is_auto_bid,
                    lb.bid_timestamp,
                    ROW_NUMBER() OVER (PARTITION BY lb.lot_id ORDER BY lb.bid_timestamp) AS seq,
                    ROW_NUMBER() OVER (PARTITION BY lb.lot_id, lb.bidder_login ORDER BY lb.bid_timestamp) AS seq_user
                FROM lot_bids lb
                JOIN auction_lots al ON al.id = lb.lot_id
                WHERE lb.bid_timestamp >= NOW() - INTERVAL '${months} months'
            ),
            -- Идентификатор последовательности подряд идущих ставок одного пользователя: seq - seq_user
            bids_grouped AS (
                SELECT 
                    b.*, 
                    (b.seq - b.seq_user) AS grp
                FROM bids b
            ),
            lot_final AS (
                SELECT 
                    al.id AS lot_id,
                    al.auction_number,
                    al.lot_number,
                    al.winner_login,
                    al.winning_bid
                FROM auction_lots al
                WHERE al.auction_end_date >= NOW() - INTERVAL '${months} months'
                  AND al.winning_bid IS NOT NULL AND al.winning_bid > 0
            ),
            lot_stats AS (
                SELECT 
                    bg.lot_id,
                    COUNT(*) FILTER (WHERE bg.is_auto_bid IS NOT TRUE) AS total_manual_bids,
                    COUNT(DISTINCT bg.bidder_login) AS unique_bidders,
                    MAX(bg.seq) AS max_seq
                FROM bids_grouped bg
                GROUP BY bg.lot_id
            ),
            winner_sequences AS (
                SELECT 
                    bg.lot_id,
                    bg.bidder_login,
                    bg.grp,
                    MIN(bg.seq) AS seq_start,
                    MAX(bg.seq) AS seq_end,
                    COUNT(*) FILTER (WHERE bg.is_auto_bid IS NOT TRUE) AS manual_in_seq,
                    MIN(bg.bid_timestamp) AS ts_start,
                    MAX(bg.bid_timestamp) AS ts_end
                FROM bids_grouped bg
                JOIN lot_final lf ON lf.lot_id = bg.lot_id
                WHERE bg.bidder_login = lf.winner_login
                GROUP BY bg.lot_id, bg.bidder_login, bg.grp
            ),
            winner_manual AS (
                SELECT 
                    bg.lot_id,
                    COUNT(*) FILTER (WHERE bg.is_auto_bid IS NOT TRUE AND bg.bidder_login = lf.winner_login) AS winner_manual_bids
                FROM bids_grouped bg
                JOIN lot_final lf ON lf.lot_id = bg.lot_id
                GROUP BY bg.lot_id
            ),
            fast_cascade AS (
                SELECT 
                    w.lot_id,
                    MAX(
                        CASE WHEN w.manual_in_seq >= ${minConsecutive}
                              AND w.seq_end = ls.max_seq
                              AND EXTRACT(EPOCH FROM (w.ts_end - w.ts_start)) <= ${maxGapFastCascade}
                        THEN 1 ELSE 0 END
                    ) AS has_fast_cascade
                FROM winner_sequences w
                JOIN lot_stats ls ON ls.lot_id = w.lot_id
                GROUP BY w.lot_id
            ),
            strong_sequences AS (
                SELECT 
                    w.lot_id,
                    MAX(CASE WHEN w.manual_in_seq >= ${minConsecutive} AND w.seq_end = ls.max_seq THEN w.manual_in_seq ELSE 0 END) AS max_consecutive_at_end
                FROM winner_sequences w
                JOIN lot_stats ls ON ls.lot_id = w.lot_id
                GROUP BY w.lot_id
            )
            SELECT 
                lf.lot_id,
                lf.auction_number,
                lf.lot_number,
                lf.winner_login,
                lf.winning_bid,
                ls.unique_bidders,
                ls.total_manual_bids,
                ws.max_consecutive_at_end,
                COALESCE(wm.winner_manual_bids, 0) AS winner_manual_bids,
                COALESCE(fc.has_fast_cascade, 0) AS has_fast_cascade
            FROM lot_final lf
            JOIN lot_stats ls ON ls.lot_id = lf.lot_id
            JOIN strong_sequences ws ON ws.lot_id = lf.lot_id
            LEFT JOIN winner_manual wm ON wm.lot_id = lf.lot_id
            LEFT JOIN fast_cascade fc ON fc.lot_id = lf.lot_id
            WHERE ws.max_consecutive_at_end >= ${minConsecutive}
              AND ls.unique_bidders <= ${maxUniqueBidders}
        `;

        const result = await pool.query(query);
        console.log(`✅ Найдено ${result.rows.length} кандидатов саморазгона/самовыкупа (сырой отбор)`);

        const items = [];
        for (const r of result.rows) {
            const winnerManual = parseInt(r.winner_manual_bids || 0);
            const totalManual = parseInt(r.total_manual_bids || 0);
            const share = totalManual > 0 ? winnerManual / totalManual : 0;

            let score = 0;
            let patterns = [];
            if (r.max_consecutive_at_end >= minConsecutive + 1) { score += 20; patterns.push('ДЛИННАЯ_ЦЕПОЧКА_В_ФИНАЛЕ'); }
            if (share >= minSelfShare) { score += 20; patterns.push('ВЫСОКАЯ_ДОЛЯ_САМО_ПОВЫШЕНИЙ'); }
            if (parseInt(r.unique_bidders) <= maxUniqueBidders) { score += 15; patterns.push('НИЗКАЯ_КОНКУРЕНЦИЯ'); }
            if (parseInt(r.has_fast_cascade) === 1) { score += 15; patterns.push('БЫСТРЫЙ_КАСКАД'); }

            let risk = 'НОРМА';
            if (score >= 60) risk = 'КРИТИЧЕСКИ ПОДОЗРИТЕЛЬНО';
            else if (score >= 40) risk = 'ПОДОЗРИТЕЛЬНО';
            else if (score >= 20) risk = 'ВНИМАНИЕ';

            if (risk !== 'НОРМА') {
                items.push({
                    lot_id: r.lot_id,
                    auction_number: r.auction_number,
                    lot_number: r.lot_number,
                    winner_login: r.winner_login,
                    winning_bid: parseFloat(r.winning_bid),
                    total_bids: totalManual, // показываем ручные как индикатор активности
                    unique_bidders: parseInt(r.unique_bidders),
                    max_consecutive_self_raises: parseInt(r.max_consecutive_at_end),
                    self_raises_share: Math.round(share * 1000) / 1000,
                    patterns,
                    score,
                    risk_level: risk
                });
            }
        }

        items.sort((a, b) => b.score - a.score);
        console.log(`✅ Саморазгон/Самовыкуп: к выдаче ${items.length} записей`);
        res.json({
            success: true,
            data: items,
            count: items.length,
            parameters: { months, min_consecutive: minConsecutive, min_self_share: minSelfShare, max_unique_bidders: maxUniqueBidders },
            message: `Найдено ${items.length} подозрительных случаев саморазгона/самовыкупа`
        });
    } catch (error) {
        console.error('❌ Ошибка саморазгона/самовыкупа:', error);
        res.status(500).json({ success: false, error: 'Ошибка анализа саморазгона/самовыкупа', details: error.message });
    }
});

// API: Технические пользователи — много ручных ставок, 0 побед
app.get('/api/analytics/technical-bidders', async (req, res) => {
    try {
        console.log('🔍 Начинаем анализ технических пользователей...');
        const months = parseInt(req.query.months) || 6;
        const minBids = parseInt(req.query.min_bids) || 20;
        const fastGapSeconds = parseInt(req.query.fast_gap_seconds) || 10;

        // Считаем ручные/авто ставки и быстрые ручные; исключаем победителей (wins = 0)
        const query = `
            WITH bids AS (
                SELECT 
                    lb.bidder_login,
                    lb.lot_id,
                    lb.is_auto_bid,
                    lb.bid_timestamp,
                    LAG(lb.bid_timestamp) OVER (PARTITION BY lb.bidder_login ORDER BY lb.bid_timestamp) AS prev_ts
                FROM lot_bids lb
                WHERE lb.bid_timestamp >= NOW() - INTERVAL '${months} months'
            ),
            agg AS (
                SELECT 
                    bidder_login,
                    COUNT(*) FILTER (WHERE is_auto_bid IS NOT TRUE) AS manual_bids,
                    COUNT(*) FILTER (WHERE is_auto_bid IS TRUE) AS auto_bids,
                    COUNT(*) AS total_bids,
                    COUNT(DISTINCT lot_id) AS distinct_lots,
                    COUNT(*) FILTER (
                        WHERE is_auto_bid IS NOT TRUE 
                          AND prev_ts IS NOT NULL 
                          AND EXTRACT(EPOCH FROM (bid_timestamp - prev_ts)) < ${fastGapSeconds}
                    ) AS fast_manual_bids,
                    MIN(bid_timestamp) AS first_bid,
                    MAX(bid_timestamp) AS last_bid
                FROM bids
                GROUP BY bidder_login
            ),
            wins AS (
                SELECT winner_login, COUNT(*) AS wins
                FROM auction_lots
                WHERE winner_login IS NOT NULL
                  AND auction_end_date >= NOW() - INTERVAL '${months} months'
                GROUP BY winner_login
            )
            SELECT 
                a.bidder_login,
                a.manual_bids,
                a.auto_bids,
                a.total_bids,
                a.distinct_lots,
                a.fast_manual_bids,
                a.first_bid,
                a.last_bid,
                COALESCE(w.wins, 0) AS wins
            FROM agg a
            LEFT JOIN wins w ON w.winner_login = a.bidder_login
            WHERE COALESCE(w.wins, 0) = 0 AND a.manual_bids >= $1
            ORDER BY a.manual_bids DESC
            LIMIT 2000
        `;

        const result = await pool.query(query, [minBids]);
        const items = result.rows.map(r => {
            const manual = parseInt(r.manual_bids || 0);
            const total = parseInt(r.total_bids || 0);
            const fast = parseInt(r.fast_manual_bids || 0);
            const fastShare = manual > 0 ? fast / manual : 0;

            let score = 0;
            let patterns = [];
            if (manual >= 100) { score += 30; patterns.push('ОЧЕНЬ_МНОГО_РУЧНЫХ_СТАВОК'); }
            else if (manual >= 50) { score += 20; patterns.push('МНОГО_РУЧНЫХ_СТАВОК'); }
            if (r.distinct_lots >= 30) { score += 15; patterns.push('МНОГО_РАЗНЫХ_ЛОТОВ'); }
            if (fastShare >= 0.3) { score += 15; patterns.push('МНОГО_БЫСТРЫХ_РУЧНЫХ'); }

            let risk = 'ВНИМАНИЕ';
            if (score >= 50) risk = 'КРИТИЧЕСКИ ПОДОЗРИТЕЛЬНО';
            else if (score >= 30) risk = 'ПОДОЗРИТЕЛЬНО';

            return {
                bidder_login: r.bidder_login,
                manual_bids: manual,
                auto_bids: parseInt(r.auto_bids || 0),
                total_bids: total,
                distinct_lots: parseInt(r.distinct_lots || 0),
                fast_manual_share: Math.round(fastShare * 1000) / 1000,
                wins: parseInt(r.wins || 0),
                first_bid: r.first_bid,
                last_bid: r.last_bid,
                patterns,
                score,
                risk_level: risk
            };
        });

        console.log(`✅ Технические пользователи: ${items.length} записей (min_bids=${minBids}, months=${months})`);
        
        // Обновляем скоринг для найденных пользователей
        let updatedCount = 0;
        for (const item of items) {
            if (item.bidder_login) {
                // Определяем балл на основе score (макс 20 для низкой категории)
                let score = 0;
                if (item.score >= 50) {
                    score = 20; // Критично
                } else if (item.score >= 30) {
                    score = 15; // Высокий
                } else if (item.score >= 20) {
                    score = 10; // Средний
                }
                
                if (score > 0) {
                    await updateUserScore(item.bidder_login, 'technical_bidders_score', score);
                    updatedCount++;
                }
            }
        }
        
        console.log(`✅ Обновлен скоринг для ${updatedCount} пользователей`);
        
        res.json({ success: true, data: items, count: items.length, parameters: { months, min_bids: minBids } });
    } catch (error) {
        console.error('❌ Ошибка анализа технических пользователей:', error);
        res.status(500).json({ success: false, error: 'Ошибка анализа технических пользователей', details: error.message });
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
        
        // Обновляем скоринг для найденных пользователей
        const userScores = new Map();
        pricingStrategies.forEach(strategy => {
            if (strategy.winner_login) {
                // Определяем балл на основе strategy_score (макс 40 для высокой категории)
                let score = 0;
                if (strategy.strategy_score >= 80) {
                    score = 40; // Критично
                } else if (strategy.strategy_score >= 50) {
                    score = 30; // Высокий
                } else if (strategy.strategy_score >= 30) {
                    score = 20; // Средний
                }
                
                // Берем максимальный балл для каждого пользователя
                if (!userScores.has(strategy.winner_login) || userScores.get(strategy.winner_login) < score) {
                    userScores.set(strategy.winner_login, score);
                }
            }
        });
        
        // Обновляем скоринг в базе данных
        let updatedCount = 0;
        for (const [userLogin, score] of userScores) {
            await updateUserScore(userLogin, 'pricing_strategies_score', score);
            updatedCount++;
        }
        
        console.log(`✅ Обновлен скоринг для ${updatedCount} пользователей`);
        
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
        
        const minLots = parseInt(req.query.min_lots) || 2; // Снижаем до 2, так как уже ищем повторные покупки
        const maxPriceDiff = parseFloat(req.query.max_price_diff) || 0.5; // 50% разница в цене
        const months = parseInt(req.query.months) || 6;
        
        // Шаг 1: Используем подход из circular-buyers для поиска повторных покупок
        console.log(`🔍 Шаг 1: Ищем пользователей с повторными покупками (как в circular-buyers)...`);
        const repeatedPurchasesQuery = `
            SELECT 
                al.winner_login,
                al.coin_description,
                al.year,
                al.condition,
                COUNT(*) as purchase_count
            FROM auction_lots al
            WHERE al.winner_login IS NOT NULL
              AND al.winning_bid IS NOT NULL
              AND al.winning_bid > 0
              AND al.auction_end_date >= NOW() - INTERVAL '${months} months'
            GROUP BY al.winner_login, al.coin_description, al.year, al.condition
            HAVING COUNT(*) >= 2
        `;
        
        const repeatedResult = await pool.query(repeatedPurchasesQuery);
        console.log(`✅ Найдено ${repeatedResult.rows.length} случаев повторных покупок одинаковых монет`);
        
        // Собираем список подозрительных пользователей с повторными покупками
        const suspiciousUsers = new Set();
        const userRepeatedCoins = {};
        repeatedResult.rows.forEach(row => {
            suspiciousUsers.add(row.winner_login);
            if (!userRepeatedCoins[row.winner_login]) {
                userRepeatedCoins[row.winner_login] = [];
            }
            userRepeatedCoins[row.winner_login].push({
                coin: `${row.coin_description}|${row.year}|${row.condition}`,
                count: parseInt(row.purchase_count)
            });
        });
        
        if (suspiciousUsers.size === 0) {
            console.log('⚠️ Не найдено пользователей с повторными покупками');
            return res.json({ success: true, data: [], count: 0, message: 'Не найдено пользователей с повторными покупками' });
        }
        
        console.log(`🔍 Шаг 2: Анализируем ${suspiciousUsers.size} подозрительных пользователей...`);
        const userList = Array.from(suspiciousUsers);
        
        if (userList.length === 0) {
            console.log('⚠️ Список подозрительных пользователей пуст');
            return res.json({ success: true, data: [], count: 0, message: 'Не найдено пользователей с повторными покупками' });
        }
        
        // Проверяем, сколько покупок у этих пользователей без фильтров
        const testQuery = `
            SELECT COUNT(*) as total
            FROM auction_lots al
            WHERE al.winner_login = ANY($1::text[])
              AND al.auction_end_date >= NOW() - INTERVAL '${months} months'
        `;
        const testResult = await pool.query(testQuery, [userList]);
        console.log(`ℹ️ Всего покупок у этих пользователей (без фильтров): ${testResult.rows[0].total}`);
        
        // Проверяем с фильтрами (только winning_bid, без starting_bid)
        const testQuery2 = `
            SELECT COUNT(*) as total
            FROM auction_lots al
            WHERE al.winner_login = ANY($1::text[])
              AND al.winning_bid IS NOT NULL
              AND al.winning_bid > 0
              AND al.auction_end_date >= NOW() - INTERVAL '${months} months'
        `;
        const testResult2 = await pool.query(testQuery2, [userList]);
        console.log(`ℹ️ Покупок с фильтрами (только winning_bid): ${testResult2.rows[0].total}`);
        
        const decoyQuery = `
            WITH user_purchases AS (
                SELECT 
                    al.id as lot_id,
                    al.winner_login,
                    al.coin_description,
                    al.year,
                    al.condition,
                    al.winning_bid,
                    al.starting_bid,
                    al.auction_number,
                    al.lot_number,
                    al.auction_end_date,
                    al.category,
                    lpp.predicted_price,
                    CASE 
                        WHEN lpp.predicted_price IS NOT NULL AND lpp.predicted_price > 0 
                        THEN (al.winning_bid / lpp.predicted_price) 
                        ELSE NULL 
                    END as predicted_price_multiplier
                FROM auction_lots al
                LEFT JOIN lot_price_predictions lpp ON al.id = lpp.lot_id
                WHERE al.winner_login = ANY($1::text[])
                  AND al.winning_bid IS NOT NULL
                  AND al.winning_bid > 0
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
                    AVG(predicted_price_multiplier) as avg_predicted_multiplier,
                    STDDEV(winning_bid) as price_stddev,
                    ARRAY_AGG(
                        JSON_BUILD_OBJECT(
                            'lot_id', lot_id,
                            'coin_description', coin_description,
                            'year', year,
                            'condition', condition,
                            'winning_bid', winning_bid,
                            'starting_bid', starting_bid,
                            'predicted_price', predicted_price,
                            'predicted_price_multiplier', predicted_price_multiplier,
                            'auction_number', auction_number,
                            'lot_number', lot_number,
                            'auction_end_date', auction_end_date,
                            'category', category
                        ) ORDER BY auction_end_date
                    ) as purchases
                FROM user_purchases
                GROUP BY winner_login
                -- Убираем фильтр minLots, так как мы уже отфильтровали пользователей с повторными покупками
            )
            SELECT *
            FROM user_stats
            ORDER BY total_purchases DESC
        `;
        
        const result = await pool.query(decoyQuery, [userList]);
        console.log(`✅ Найдено ${result.rows.length} пользователей с множественными покупками (minLots=${minLots})`);
        
        // Шаг 3: Анализируем тактики приманки
        console.log('🔍 Шаг 3: Анализируем тактики приманки...');
        const decoyTactics = [];
        let totalAnalyzed = 0;
        let filteredOut = 0;
        
        for (const row of result.rows) {
            const purchases = row.purchases;
            let decoyScore = 0;
            let riskLevel = 'НОРМА';
            let tacticType = 'НЕИЗВЕСТНО';
            
            // Анализируем паттерны покупок
            let suspiciousPatterns = [];
            
            // 1. МНОГОКРАТНЫЕ ПОКУПКИ ОДНОЙ МОНЕТЫ (используем данные из circular-buyers подхода)
            // "Если человек постоянно покупает одну и ту же монету, и их у него наверно уже ведро, на самом деле он продавец"
            const userRepeats = userRepeatedCoins[row.winner_login] || [];
            const maxRepeats = userRepeats.length > 0 ? Math.max(...userRepeats.map(r => r.count)) : 0;
            
            if (maxRepeats >= 3) {
                decoyScore += 40; // Очень высокий вес - это явный признак самовыкупа
                tacticType = 'МНОГОКРАТНЫЕ_ПОКУПКИ_ОДНОЙ_МОНЕТЫ';
                suspiciousPatterns.push(`ПОКУПАЕТ_ОДНУ_МОНЕТУ_${maxRepeats}_РАЗА`);
            } else if (maxRepeats >= 2) {
                decoyScore += 25;
                suspiciousPatterns.push(`ПОКУПАЕТ_ОДНУ_МОНЕТУ_${maxRepeats}_РАЗА`);
            }
            
            // 2. ПОКУПКИ НЕСКОЛЬКИХ ЛОТОВ ИЗ ОДНОГО АУКЦИОНА
            // "Если покупатель ведет активный торг за группу рядом размещенных или одинаковых монет и в результате их все скупает"
            const auctionPurchases = {};
            purchases.forEach(p => {
                if (!auctionPurchases[p.auction_number]) {
                    auctionPurchases[p.auction_number] = [];
                }
                auctionPurchases[p.auction_number].push(p);
            });
            
            let maxLotsFromOneAuction = 0;
            let sequentialLotsCount = 0;
            Object.keys(auctionPurchases).forEach(auctionNum => {
                const lots = auctionPurchases[auctionNum];
                if (lots.length > maxLotsFromOneAuction) {
                    maxLotsFromOneAuction = lots.length;
                }
                
                // Проверяем последовательность лотов (рядом размещенные)
                if (lots.length >= 2) {
                    const lotNumbers = lots.map(l => parseInt(l.lot_number) || 0).filter(n => n > 0).sort((a, b) => a - b);
                    let sequential = 1;
                    for (let i = 1; i < lotNumbers.length; i++) {
                        if (lotNumbers[i] === lotNumbers[i-1] + 1) {
                            sequential++;
                        } else {
                            if (sequential > sequentialLotsCount) {
                                sequentialLotsCount = sequential;
                            }
                            sequential = 1;
                        }
                    }
                    if (sequential > sequentialLotsCount) {
                        sequentialLotsCount = sequential;
                    }
                }
            });
            
            if (maxLotsFromOneAuction >= 5) {
                decoyScore += 35;
                tacticType = 'СКУПАЕТ_МНОЖЕСТВО_ЛОТОВ_ИЗ_АУКЦИОНА';
                suspiciousPatterns.push(`СКУПИЛ_${maxLotsFromOneAuction}_ЛОТОВ_ИЗ_ОДНОГО_АУКЦИОНА`);
            } else if (maxLotsFromOneAuction >= 3) {
                decoyScore += 20;
                suspiciousPatterns.push(`СКУПИЛ_${maxLotsFromOneAuction}_ЛОТОВ_ИЗ_ОДНОГО_АУКЦИОНА`);
            }
            
            if (sequentialLotsCount >= 3) {
                decoyScore += 25;
                suspiciousPatterns.push(`ПОСЛЕДОВАТЕЛЬНЫЕ_ЛОТЫ_${sequentialLotsCount}`);
            }
            
            // 3. СИСТЕМАТИЧЕСКИЕ ПОКУПКИ ПО ЗАВЫШЕННЫМ ЦЕНАМ
            // "Если человек из аукциона в аукцион годами и сотнями скупает одни и те же монеты по завышенным ценам"
            // Используем predicted_price_multiplier (как в отчете "Ловушки автобида")
            // Пороги: >= 2.0 (критически завышено), >= 1.5 (завышено), >= 1.2 (внимание)
            const purchasesWithPrediction = purchases.filter(p => p.predicted_price_multiplier != null && p.predicted_price_multiplier > 0);
            if (purchasesWithPrediction.length > 0) {
                const criticalOverpriced = purchasesWithPrediction.filter(p => p.predicted_price_multiplier >= 2.0).length;
                const overpriced = purchasesWithPrediction.filter(p => p.predicted_price_multiplier >= 1.5).length;
                const criticalRatio = criticalOverpriced / purchasesWithPrediction.length;
                const overpricedRatio = overpriced / purchasesWithPrediction.length;
                
                if (criticalRatio >= 0.5 && purchases.length >= 5) {
                    decoyScore += 35;
                    suspiciousPatterns.push(`СИСТЕМАТИЧЕСКИЕ_КРИТИЧЕСКИ_ЗАВЫШЕННЫЕ_ЦЕНЫ_${Math.round(criticalRatio * 100)}%`);
                } else if (overpricedRatio >= 0.7 && purchases.length >= 5) {
                    decoyScore += 30;
                    suspiciousPatterns.push(`СИСТЕМАТИЧЕСКИЕ_ЗАВЫШЕННЫЕ_ЦЕНЫ_${Math.round(overpricedRatio * 100)}%`);
                } else if (overpricedRatio >= 0.5) {
                    decoyScore += 15;
                    suspiciousPatterns.push(`МНОГО_ЗАВЫШЕННЫХ_ЦЕН_${Math.round(overpricedRatio * 100)}%`);
                }
            }
            
            // 4. Смешанные покупки: дешевые + дорогие (тактика "приманки")
            const prices = purchases.map(p => p.winning_bid);
            const sortedPrices = [...prices].sort((a, b) => a - b);
            
            const cheapPurchases = sortedPrices.slice(0, Math.floor(sortedPrices.length / 2));
            const expensivePurchases = sortedPrices.slice(Math.floor(sortedPrices.length / 2));
            
            const avgCheapPrice = cheapPurchases.reduce((a, b) => a + b, 0) / cheapPurchases.length;
            const avgExpensivePrice = expensivePurchases.reduce((a, b) => a + b, 0) / expensivePurchases.length;
            
            if (avgExpensivePrice > avgCheapPrice * 3 && purchases.length >= 3) {
                decoyScore += 20; // Снижаем вес, так как это менее явный признак
                if (!tacticType || tacticType === 'НЕИЗВЕСТНО') {
                    tacticType = 'СМЕШАННЫЕ_ПОКУПКИ';
                }
                suspiciousPatterns.push('СМЕШЕНИЕ_ДЕШЕВЫХ_И_ДОРОГИХ');
            }
            
            // 5. Паттерн "приманка": дешевая покупка перед дорогой
            let decoyPatterns = 0;
            for (let i = 0; i < purchases.length - 1; i++) {
                const current = purchases[i];
                const next = purchases[i + 1];
                
                // Если следующая покупка значительно дороже
                if (next.winning_bid > current.winning_bid * 2) {
                    decoyPatterns++;
                }
            }
            
            if (decoyPatterns >= 2) {
                decoyScore += 15;
                suspiciousPatterns.push(`ДЕШЕВАЯ_ПЕРЕД_ДОРОГОЙ_${decoyPatterns}_РАЗ`);
            } else if (decoyPatterns > 0) {
                decoyScore += 10;
                suspiciousPatterns.push('ДЕШЕВАЯ_ПЕРЕД_ДОРОГОЙ');
            }
            
            // 6. Низкая вариация в дешевых покупках (систематичность)
            const cheapPriceStddev = Math.sqrt(
                cheapPurchases.reduce((sum, price) => sum + Math.pow(price - avgCheapPrice, 2), 0) / cheapPurchases.length
            );
            
            if (cheapPriceStddev < avgCheapPrice * 0.3 && cheapPurchases.length >= 2) {
                decoyScore += 10;
                suspiciousPatterns.push('СИСТЕМАТИЧНЫЕ_ДЕШЕВЫЕ_ПОКУПКИ');
            }
            
            // 7. Высокие множители цен (используем predicted_price_multiplier если доступен)
            const purchasesWithPredictionForRatio = purchases.filter(p => p.predicted_price_multiplier != null && p.predicted_price_multiplier > 0);
            const highMultipliers = purchasesWithPredictionForRatio.filter(p => p.predicted_price_multiplier > 2.0).length;
            const highMultiplierRatio = purchasesWithPredictionForRatio.length > 0 ? highMultipliers / purchasesWithPredictionForRatio.length : 0;
            
            // 8. Концентрация по категориям
            const categoryCounts = {};
            purchases.forEach(p => {
                categoryCounts[p.category] = (categoryCounts[p.category] || 0) + 1;
            });
            
            const maxCategoryCount = Math.max(...Object.values(categoryCounts));
            const categoryConcentration = maxCategoryCount / purchases.length;
            
            if (categoryConcentration > 0.8 && purchases.length >= 5) {
                decoyScore += 10;
                suspiciousPatterns.push('КОНЦЕНТРАЦИЯ_ПО_КАТЕГОРИЯМ');
            }
            
            // 9. Временные паттерны: быстрые последовательные покупки
            const timeGaps = [];
            for (let i = 1; i < purchases.length; i++) {
                const currentDate = new Date(purchases[i].auction_end_date);
                const prevDate = new Date(purchases[i-1].auction_end_date);
                const daysDiff = (currentDate - prevDate) / (1000 * 60 * 60 * 24);
                timeGaps.push(daysDiff);
            }
            
            const avgTimeGap = timeGaps.reduce((a, b) => a + b, 0) / timeGaps.length;
            const quickPurchases = timeGaps.filter(gap => gap < 7).length; // Менее недели
            
            if (quickPurchases > purchases.length * 0.6 && purchases.length >= 3) {
                decoyScore += 10;
                suspiciousPatterns.push('БЫСТРЫЕ_ПОСЛЕДОВАТЕЛЬНЫЕ_ПОКУПКИ');
            }
            
            // 10. Очень высокие цены при низкой конкуренции (используем predicted_price_multiplier если доступен)
            const highPriceLowCompetition = purchases.filter(p => {
                if (p.predicted_price_multiplier != null && p.predicted_price_multiplier > 0) {
                    return p.winning_bid > 5000 && p.predicted_price_multiplier > 2.5;
                }
                return p.winning_bid > 5000; // Если нет прогноза, используем только абсолютную цену
            }).length;
            
            if (highPriceLowCompetition >= 2) {
                decoyScore += 15;
                suspiciousPatterns.push(`ВЫСОКИЕ_ЦЕНЫ_ПРИ_НИЗКОЙ_КОНКУРЕНЦИИ_${highPriceLowCompetition}`);
            } else if (highPriceLowCompetition > 0) {
                decoyScore += 10;
                suspiciousPatterns.push('ВЫСОКИЕ_ЦЕНЫ_ПРИ_НИЗКОЙ_КОНКУРЕНЦИИ');
            }
            
            // Определяем уровень риска (снижаем пороги)
            if (decoyScore >= 60) {
                riskLevel = 'КРИТИЧЕСКИ ПОДОЗРИТЕЛЬНО';
            } else if (decoyScore >= 35) {
                riskLevel = 'ПОДОЗРИТЕЛЬНО';
            } else if (decoyScore >= 15) {
                riskLevel = 'ВНИМАНИЕ';
            }
            
            totalAnalyzed++;
            
            // Добавляем только подозрительные случаи (или все с score > 0 для отладки)
            if (riskLevel !== 'НОРМА' || decoyScore > 0) {
                decoyTactics.push({
                    winner_login: row.winner_login,
                    total_purchases: row.total_purchases,
                    unique_coins: row.unique_coins,
                    max_repeated_coin: maxRepeats,
                    max_lots_from_one_auction: maxLotsFromOneAuction,
                    sequential_lots_count: sequentialLotsCount,
                    avg_price: Math.round(row.avg_price * 100) / 100,
                    min_price: row.min_price,
                    max_price: row.max_price,
                    price_range_ratio: Math.round((row.max_price / row.min_price) * 100) / 100,
                    avg_predicted_multiplier: row.avg_predicted_multiplier ? Math.round(row.avg_predicted_multiplier * 100) / 100 : null,
                    overpriced_ratio: purchasesWithPrediction.length > 0 ? 
                        Math.round((purchasesWithPrediction.filter(p => (p.predicted_price_multiplier || 0) >= 1.5).length / purchasesWithPrediction.length) * 100) / 100 : null,
                    category_concentration: Math.round(categoryConcentration * 100) / 100,
                    quick_purchases_ratio: Math.round((quickPurchases / purchases.length) * 100) / 100,
                    decoy_patterns_count: decoyPatterns,
                    tactic_type: tacticType,
                    suspicious_patterns: suspiciousPatterns,
                    decoy_score: decoyScore,
                    risk_level: riskLevel,
                    purchases: purchases // Добавляем детальные данные о покупках для модального окна
                });
            } else {
                filteredOut++;
            }
        }
        
        // Сортируем по индексу тактики приманки
        decoyTactics.sort((a, b) => b.decoy_score - a.decoy_score);
        
        console.log(`✅ Проанализировано ${totalAnalyzed} пользователей, найдено ${decoyTactics.length} подозрительных тактик приманки (отфильтровано ${filteredOut})`);
        
        // Обновляем скоринг для найденных пользователей
        let updatedCount = 0;
        for (const tactic of decoyTactics) {
            // Определяем балл на основе decoy_score (макс 40 для высокой категории)
            let score = 0;
            if (tactic.decoy_score >= 60) {
                score = 40; // Критично
            } else if (tactic.decoy_score >= 35) {
                score = 30; // Высокий
            } else if (tactic.decoy_score >= 15) {
                score = 20; // Средний
            }
            
            if (score > 0 && tactic.winner_login) {
                await updateUserScore(tactic.winner_login, 'decoy_tactics_score', score);
                updatedCount++;
            }
        }
        
        console.log(`✅ Обновлен скоринг для ${updatedCount} пользователей`);
        
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

// Анализ саморазгона/самовыкупа: победитель многократно повышает свои РУЧНЫЕ ставки подряд
app.get('/api/analytics/self-boost', async (req, res) => {
    try {
        const months = parseInt(req.query.months) || 6;
        const minBids = parseInt(req.query.min_bids) || 5;
        const minConsecutive = parseInt(req.query.min_consecutive) || 3;
        const minRatio = parseFloat(req.query.min_ratio) || 0.6;

        const query = `
            WITH bid_seq AS (
                SELECT 
                    lb.lot_id,
                    lb.bidder_login,
                    lb.bid_amount,
                    lb.bid_timestamp,
                    lb.is_auto_bid,
                    ROW_NUMBER() OVER (PARTITION BY lb.lot_id ORDER BY lb.bid_timestamp) AS seq
                FROM lot_bids lb
                JOIN auction_lots al ON al.id = lb.lot_id
                WHERE lb.bid_timestamp >= NOW() - INTERVAL '${months} months'
                  AND lb.bid_timestamp IS NOT NULL
                  AND al.winning_bid IS NOT NULL
            ),
            lot_stats AS (
                SELECT 
                    bs.lot_id,
                    COUNT(*) AS total_bids,
                    COUNT(DISTINCT bs.bidder_login) AS unique_bidders,
                    ARRAY_AGG(JSON_BUILD_OBJECT(
                        'bidder', bs.bidder_login,
                        'amount', bs.bid_amount,
                        'timestamp', bs.bid_timestamp,
                        'is_auto', bs.is_auto_bid
                    ) ORDER BY bs.seq) AS bid_sequence
                FROM bid_seq bs
                GROUP BY bs.lot_id
                HAVING COUNT(*) >= $1
            )
            SELECT 
                ls.*, 
                al.auction_number,
                al.lot_number,
                al.winner_login,
                al.winning_bid
            FROM lot_stats ls
            JOIN auction_lots al ON al.id = ls.lot_id
            ORDER BY al.auction_end_date DESC
            LIMIT 2000
        `;

        const r = await pool.query(query, [minBids]);

        const cases = [];
        for (const row of r.rows) {
            const seq = row.bid_sequence || [];
            const winner = row.winner_login;

            // Считаем только ручные ставки
            const manualSeq = seq.filter(b => b && b.is_auto === false);
            if (manualSeq.length === 0) continue;

            // Доля само-повышений: доля ручных ставок победителя среди всех ручных ставок
            const winnerManualCount = manualSeq.filter(b => b.bidder === winner).length;
            const selfRaiseRatio = manualSeq.length > 0 ? winnerManualCount / manualSeq.length : 0;

            // Максимальная длина подряд идущих ручных ставок победителя
            let maxConsecutive = 0;
            let current = 0;
            for (const b of manualSeq) {
                if (b.bidder === winner) {
                    current += 1;
                    if (current > maxConsecutive) maxConsecutive = current;
                } else {
                    current = 0;
                }
            }

            // Усиливающий признак: есть ли каскад в финальной фазе (последние 5 ручных ставок)
            const lastManual = manualSeq.slice(-5);
            let tailCascade = 0, tailCur = 0;
            for (const b of lastManual) {
                if (b.bidder === winner) { tailCur++; tailCascade = Math.max(tailCascade, tailCur); } else { tailCur = 0; }
            }

            // Скоринг
            let score = 0;
            const patterns = [];
            if (maxConsecutive >= minConsecutive) { score += 30; patterns.push('ПОДРЯД_САМОПОВЫШЕНИЯ'); }
            if (selfRaiseRatio >= Math.max(0, Math.min(1, minRatio))) { score += 25; patterns.push('ВЫСОКАЯ_ДОЛЯ_САМОПОВЫШЕНИЙ'); }
            if (row.unique_bidders <= 2) { score += 20; patterns.push('НИЗКАЯ_КОНКУРЕНЦИЯ'); }
            if (tailCascade >= 3) { score += 15; patterns.push('КАСКАД_В_КОНЦЕ'); }

            let risk = 'НОРМА';
            if (score >= 70) risk = 'КРИТИЧЕСКИ ПОДОЗРИТЕЛЬНО';
            else if (score >= 50) risk = 'ПОДОЗРИТЕЛЬНО';
            else if (score >= 30) risk = 'ВНИМАНИЕ';

            if (risk !== 'НОРМА') {
                cases.push({
                    lot_id: row.lot_id,
                    auction_number: row.auction_number,
                    lot_number: row.lot_number,
                    winner_login: row.winner_login,
                    winning_bid: row.winning_bid,
                    total_bids: row.total_bids,
                    unique_bidders: row.unique_bidders,
                    max_consecutive_self_raises: maxConsecutive,
                    self_raise_ratio: Math.round(selfRaiseRatio * 100) / 100,
                    tail_cascade: tailCascade,
                    patterns,
                    risk_level: risk,
                    self_boost_score: score
                });
            }
        }

        // Сортируем по индексу саморазгона
        cases.sort((a, b) => b.self_boost_score - a.self_boost_score);

        return res.json({
            success: true,
            data: cases,
            count: cases.length,
            parameters: { months, min_bids: minBids, min_consecutive: minConsecutive, min_ratio: minRatio },
            message: `Найдено ${cases.length} случаев саморазгона/самовыкупа`
        });
    } catch (e) {
        console.error('❌ Ошибка анализа саморазгона/самовыкупа:', e);
        return res.status(500).json({ success: false, error: 'Ошибка анализа саморазгона/самовыкупа', details: e.message });
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
}).on('error', (err) => {
    console.error('❌ Ошибка при запуске сервера:', err);
    process.exit(1);
});

// Обработка необработанных ошибок
process.on('uncaughtException', (err) => {
    console.error('❌ Необработанное исключение:', err);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Необработанный rejection:', reason);
    process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Analytics Service: Получен сигнал завершения, закрываем соединения...');
    await pool.end();
    process.exit(0);
});

module.exports = app;

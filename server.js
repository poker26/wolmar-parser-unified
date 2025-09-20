const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');
const config = require('./config');
const MetalsPriceService = require('./metals-price-service');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Database connection
const pool = new Pool(config.dbConfig);

// Metals price service
const metalsService = new MetalsPriceService();

// Test database connection
pool.on('connect', () => {
    console.log('✅ Подключение к базе данных установлено');
});

pool.on('error', (err) => {
    console.error('❌ Ошибка подключения к базе данных:', err);
});

// API Routes

// Получить список всех аукционов
app.get('/api/auctions', async (req, res) => {
    try {
        const query = `
            SELECT 
                auction_number,
                COUNT(*) as lots_count,
                MIN(auction_end_date) as start_date,
                MAX(auction_end_date) as end_date,
                SUM(winning_bid) as total_value,
                AVG(winning_bid) as avg_bid,
                MAX(winning_bid) as max_bid,
                MIN(winning_bid) as min_bid
            FROM auction_lots 
            WHERE auction_number IS NOT NULL
            GROUP BY auction_number
            ORDER BY auction_number DESC
        `;
        
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (error) {
        console.error('Ошибка получения аукционов:', error);
        res.status(500).json({ error: 'Ошибка получения данных об аукционах' });
    }
});

// Получить лоты конкретного аукциона
app.get('/api/auctions/:auctionNumber/lots', async (req, res) => {
    try {
        const { auctionNumber } = req.params;
        const { page = 1, limit = 20, search, metal, condition, year, minPrice, maxPrice } = req.query;
        
        let query = `
            SELECT 
                id, lot_number, coin_description, 
                avers_image_url, revers_image_url,
                winner_login, winning_bid, auction_end_date,
                bids_count, lot_status, year, letters, metal, condition, weight,
                parsed_at, source_url
            FROM auction_lots 
            WHERE auction_number = $1
        `;
        
        const queryParams = [auctionNumber];
        let paramIndex = 2;
        
        // Добавляем фильтры
        if (search) {
            query += ` AND coin_description ILIKE $${paramIndex}`;
            queryParams.push(`%${search}%`);
            paramIndex++;
        }
        
        if (metal) {
            query += ` AND metal = $${paramIndex}`;
            queryParams.push(metal);
            paramIndex++;
        }
        
        if (condition) {
            query += ` AND condition = $${paramIndex}`;
            queryParams.push(condition);
            paramIndex++;
        }
        
        if (year) {
            query += ` AND year = $${paramIndex}`;
            queryParams.push(parseInt(year));
            paramIndex++;
        }
        
        if (minPrice) {
            query += ` AND winning_bid >= $${paramIndex}`;
            queryParams.push(parseFloat(minPrice));
            paramIndex++;
        }
        
        if (maxPrice) {
            query += ` AND winning_bid <= $${paramIndex}`;
            queryParams.push(parseFloat(maxPrice));
            paramIndex++;
        }
        
        // Добавляем пагинацию
        const offset = (page - 1) * limit;
        query += ` ORDER BY lot_number::int ASC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        queryParams.push(parseInt(limit), offset);
        
        const result = await pool.query(query, queryParams);
        
        // Получаем общее количество лотов для пагинации
        let countQuery = `
            SELECT COUNT(*) as total
            FROM auction_lots 
            WHERE auction_number = $1
        `;
        const countParams = [auctionNumber];
        let countParamIndex = 2;
        
        if (search) {
            countQuery += ` AND coin_description ILIKE $${countParamIndex}`;
            countParams.push(`%${search}%`);
            countParamIndex++;
        }
        
        if (metal) {
            countQuery += ` AND metal = $${countParamIndex}`;
            countParams.push(metal);
            countParamIndex++;
        }
        
        if (condition) {
            countQuery += ` AND condition = $${countParamIndex}`;
            countParams.push(condition);
            countParamIndex++;
        }
        
        if (year) {
            countQuery += ` AND year = $${countParamIndex}`;
            countParams.push(parseInt(year));
            countParamIndex++;
        }
        
        if (minPrice) {
            countQuery += ` AND winning_bid >= $${countParamIndex}`;
            countParams.push(parseFloat(minPrice));
            countParamIndex++;
        }
        
        if (maxPrice) {
            countQuery += ` AND winning_bid <= $${countParamIndex}`;
            countParams.push(parseFloat(maxPrice));
            countParamIndex++;
        }
        
        const countResult = await pool.query(countQuery, countParams);
        const total = parseInt(countResult.rows[0].total);
        
        res.json({
            lots: result.rows,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('Ошибка получения лотов:', error);
        res.status(500).json({ error: 'Ошибка получения данных о лотах' });
    }
});

// Получить детальную информацию о лоте
app.get('/api/lots/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const query = `
            SELECT 
                id, lot_number, auction_number, coin_description,
                avers_image_url, revers_image_url,
                winner_login, winning_bid, auction_end_date,
                bids_count, lot_status, year, letters, metal, condition, weight,
                parsed_at, source_url
            FROM auction_lots 
            WHERE id = $1
        `;
        
        const result = await pool.query(query, [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Лот не найден' });
        }
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Ошибка получения лота:', error);
        res.status(500).json({ error: 'Ошибка получения данных о лоте' });
    }
});

// Получить статистику аукциона
app.get('/api/auctions/:auctionNumber/stats', async (req, res) => {
    try {
        const { auctionNumber } = req.params;
        const query = `
            SELECT 
                COUNT(*) as total_lots,
                COUNT(CASE WHEN winning_bid IS NOT NULL THEN 1 END) as sold_lots,
                COUNT(CASE WHEN winning_bid IS NULL THEN 1 END) as unsold_lots,
                SUM(winning_bid) as total_revenue,
                AVG(winning_bid) as avg_price,
                MAX(winning_bid) as max_price,
                MIN(winning_bid) as min_price,
                COUNT(DISTINCT winner_login) as unique_bidders,
                COUNT(DISTINCT metal) as metals_count,
                COUNT(DISTINCT condition) as conditions_count
            FROM auction_lots 
            WHERE auction_number = $1
        `;
        
        const result = await pool.query(query, [auctionNumber]);
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Ошибка получения статистики:', error);
        res.status(500).json({ error: 'Ошибка получения статистики' });
    }
});

// Получить уникальные значения для фильтров
app.get('/api/filters', async (req, res) => {
    try {
        const { auctionNumber } = req.query;
        let whereClause = '';
        let params = [];
        
        if (auctionNumber) {
            whereClause = 'WHERE auction_number = $1';
            params = [auctionNumber];
        }
        
        // Получаем металлы с количеством лотов
        const metalsQuery = `
            SELECT metal, COUNT(*) as count
            FROM auction_lots 
            ${whereClause ? whereClause + ' AND' : 'WHERE'} metal IS NOT NULL AND metal != ''
            GROUP BY metal 
            ORDER BY count DESC
        `;
        
        // Получаем состояния с количеством лотов
        const conditionsQuery = `
            SELECT condition, COUNT(*) as count
            FROM auction_lots 
            ${whereClause ? whereClause + ' AND' : 'WHERE'} condition IS NOT NULL AND condition != ''
            GROUP BY condition 
            ORDER BY count DESC
        `;
        
        // Получаем годы с количеством лотов
        const yearsQuery = `
            SELECT year, COUNT(*) as count
            FROM auction_lots 
            ${whereClause ? whereClause + ' AND' : 'WHERE'} year IS NOT NULL AND year > 0
            GROUP BY year 
            ORDER BY year DESC
        `;
        
        const [metalsResult, conditionsResult, yearsResult] = await Promise.all([
            pool.query(metalsQuery, params),
            pool.query(conditionsQuery, params),
            pool.query(yearsQuery, params)
        ]);
        
        res.json({
            metals: metalsResult.rows,
            conditions: conditionsResult.rows,
            years: yearsResult.rows
        });
    } catch (error) {
        console.error('Ошибка получения фильтров:', error);
        res.status(500).json({ error: 'Ошибка получения фильтров' });
    }
});

// Получить статистику победителя
app.get('/api/winners/:login', async (req, res) => {
    try {
        const { login } = req.params;
        
        // Получаем общую статистику победителя
        const statsQuery = `
            SELECT 
                winner_login,
                COUNT(*) as total_lots,
                SUM(winning_bid) as total_amount,
                MIN(auction_end_date) as first_win,
                MAX(auction_end_date) as last_win
            FROM auction_lots 
            WHERE winner_login = $1
            GROUP BY winner_login
        `;
        
        const statsResult = await pool.query(statsQuery, [login]);
        
        if (statsResult.rows.length === 0) {
            return res.status(404).json({ error: 'Победитель не найден' });
        }
        
        // Получаем список аукционов где участвовал победитель
        const auctionsQuery = `
            SELECT 
                auction_number,
                COUNT(*) as lots_won,
                SUM(winning_bid) as total_spent,
                MIN(auction_end_date) as auction_date
            FROM auction_lots 
            WHERE winner_login = $1
            GROUP BY auction_number
            ORDER BY auction_date DESC
        `;
        
        const auctionsResult = await pool.query(auctionsQuery, [login]);
        
        // Получаем детальный список выигранных лотов
        const lotsQuery = `
            SELECT 
                id, lot_number, coin_description, 
                avers_image_url, revers_image_url,
                winning_bid, auction_end_date, auction_number,
                year, letters, metal, condition, weight
            FROM auction_lots 
            WHERE winner_login = $1
            ORDER BY auction_end_date DESC, lot_number::int ASC
        `;
        
        const lotsResult = await pool.query(lotsQuery, [login]);
        
        res.json({
            stats: statsResult.rows[0],
            auctions: auctionsResult.rows,
            lots: lotsResult.rows
        });
        
    } catch (error) {
        console.error('Ошибка получения статистики победителя:', error);
        res.status(500).json({ error: 'Ошибка получения статистики победителя' });
    }
});

// Получить общую статистику
app.get('/api/statistics', async (req, res) => {
    try {
        const query = `
            SELECT 
                COUNT(DISTINCT auction_number) as total_auctions,
                COUNT(*) as total_lots,
                COUNT(CASE WHEN winning_bid IS NOT NULL THEN 1 END) as sold_lots,
                COUNT(CASE WHEN winning_bid IS NULL THEN 1 END) as unsold_lots,
                SUM(winning_bid) as total_value,
                AVG(winning_bid) as avg_price,
                MAX(winning_bid) as max_price,
                MIN(winning_bid) as min_price,
                COUNT(DISTINCT winner_login) as unique_participants,
                COUNT(DISTINCT metal) as metals_count,
                COUNT(DISTINCT condition) as conditions_count
            FROM auction_lots 
            WHERE auction_number IS NOT NULL
        `;
        
        const result = await pool.query(query);
        res.json(result.rows[0]);
        
    } catch (error) {
        console.error('Ошибка получения статистики:', error);
        res.status(500).json({ error: 'Ошибка получения статистики' });
    }
});

// Глобальный поиск лотов по всем аукционам
app.get('/api/search-lots', async (req, res) => {
    try {
        const { page = 1, limit = 20, search, metal, condition, year, minPrice, maxPrice } = req.query;
        
        let query = `
            SELECT 
                id, lot_number, coin_description, 
                avers_image_url, revers_image_url,
                winner_login, winning_bid, auction_end_date,
                bids_count, lot_status, year, letters, metal, condition, weight,
                parsed_at, source_url, auction_number
            FROM auction_lots 
            WHERE auction_number IS NOT NULL
        `;
        
        const queryParams = [];
        let paramIndex = 1;
        
        // Добавляем фильтры
        if (search) {
            query += ` AND coin_description ILIKE $${paramIndex}`;
            queryParams.push(`%${search}%`);
            paramIndex++;
        }
        
        if (metal) {
            query += ` AND metal = $${paramIndex}`;
            queryParams.push(metal);
            paramIndex++;
        }
        
        if (condition) {
            query += ` AND condition = $${paramIndex}`;
            queryParams.push(condition);
            paramIndex++;
        }
        
        if (year) {
            query += ` AND year = $${paramIndex}`;
            queryParams.push(parseInt(year));
            paramIndex++;
        }
        
        if (minPrice) {
            query += ` AND winning_bid >= $${paramIndex}`;
            queryParams.push(parseFloat(minPrice));
            paramIndex++;
        }
        
        if (maxPrice) {
            query += ` AND winning_bid <= $${paramIndex}`;
            queryParams.push(parseFloat(maxPrice));
            paramIndex++;
        }
        
        // Добавляем сортировку и пагинацию
        query += ` ORDER BY winning_bid DESC NULLS LAST, auction_number DESC, lot_number ASC`;
        
        const offset = (page - 1) * limit;
        query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        queryParams.push(parseInt(limit), offset);
        
        const result = await pool.query(query, queryParams);
        
        // Получаем общее количество результатов для пагинации
        let countQuery = `
            SELECT COUNT(*) as total
            FROM auction_lots 
            WHERE auction_number IS NOT NULL
        `;
        
        const countParams = [];
        let countParamIndex = 1;
        
        if (search) {
            countQuery += ` AND coin_description ILIKE $${countParamIndex}`;
            countParams.push(`%${search}%`);
            countParamIndex++;
        }
        
        if (metal) {
            countQuery += ` AND metal = $${countParamIndex}`;
            countParams.push(metal);
            countParamIndex++;
        }
        
        if (condition) {
            countQuery += ` AND condition = $${countParamIndex}`;
            countParams.push(condition);
            countParamIndex++;
        }
        
        if (year) {
            countQuery += ` AND year = $${countParamIndex}`;
            countParams.push(parseInt(year));
            countParamIndex++;
        }
        
        if (minPrice) {
            countQuery += ` AND winning_bid >= $${countParamIndex}`;
            countParams.push(parseFloat(minPrice));
            countParamIndex++;
        }
        
        if (maxPrice) {
            countQuery += ` AND winning_bid <= $${countParamIndex}`;
            countParams.push(parseFloat(maxPrice));
            countParamIndex++;
        }
        
        const countResult = await pool.query(countQuery, countParams);
        const total = parseInt(countResult.rows[0].total);
        
        res.json({
            lots: result.rows,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: total,
                pages: Math.ceil(total / limit)
            }
        });
        
    } catch (error) {
        console.error('Ошибка поиска лотов:', error);
        res.status(500).json({ error: 'Ошибка поиска лотов' });
    }
});

// Получить список всех победителей (для тестирования)
app.get('/api/winners', async (req, res) => {
    try {
        const query = `
            SELECT 
                winner_login,
                COUNT(*) as total_lots,
                SUM(winning_bid) as total_amount
            FROM auction_lots 
            WHERE winner_login IS NOT NULL AND winner_login != ''
            GROUP BY winner_login
            ORDER BY total_lots DESC
            LIMIT 20
        `;
        
        const result = await pool.query(query);
        res.json(result.rows);
        
    } catch (error) {
        console.error('Ошибка получения списка победителей:', error);
        res.status(500).json({ error: 'Ошибка получения списка победителей' });
    }
});

// Получить топ лотов по цене
app.get('/api/top-lots', async (req, res) => {
    try {
        const { limit = 10, auctionNumber } = req.query;
        
        let query = `
            SELECT 
                id, lot_number, auction_number, coin_description,
                avers_image_url, winning_bid, winner_login,
                auction_end_date, metal, condition, weight
            FROM auction_lots 
            WHERE winning_bid IS NOT NULL
        `;
        
        const params = [];
        let paramIndex = 1;
        
        if (auctionNumber) {
            query += ` AND auction_number = $${paramIndex}`;
            params.push(auctionNumber);
            paramIndex++;
        }
        
        query += ` ORDER BY winning_bid DESC LIMIT $${paramIndex}`;
        params.push(parseInt(limit));
        
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        console.error('Ошибка получения топ лотов:', error);
        res.status(500).json({ error: 'Ошибка получения топ лотов' });
    }
});

// Получить текущий аукцион (лоты без победителей)
app.get('/api/current-auction', async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query;
        
        // Сначала определяем номер текущего аукциона (аукцион 2130, если он есть, иначе активный аукцион)
        const currentAuctionQuery = `
            SELECT 
                auction_number
            FROM auction_lots 
            WHERE auction_number = '2130'
            LIMIT 1
        `;
        
        let currentAuctionResult = await pool.query(currentAuctionQuery);
        let currentAuctionNumber = currentAuctionResult.rows.length > 0 
            ? currentAuctionResult.rows[0].auction_number 
            : null;
        
        // Если аукцион 2130 не найден, ищем активный аукцион (дата окончания больше текущей)
        if (!currentAuctionNumber) {
            const activeAuctionQuery = `
                SELECT 
                    auction_number
                FROM auction_lots 
                WHERE auction_number IS NOT NULL
                AND auction_end_date > NOW()
                ORDER BY auction_number DESC
                LIMIT 1
            `;
            currentAuctionResult = await pool.query(activeAuctionQuery);
            currentAuctionNumber = currentAuctionResult.rows.length > 0 
                ? currentAuctionResult.rows[0].auction_number 
                : null;
        }
        
        // Если активный аукцион не найден, берем самый новый аукцион
        if (!currentAuctionNumber) {
            const latestAuctionQuery = `
                SELECT 
                    auction_number
                FROM auction_lots 
                WHERE auction_number IS NOT NULL
                ORDER BY auction_number DESC
                LIMIT 1
            `;
            currentAuctionResult = await pool.query(latestAuctionQuery);
            currentAuctionNumber = currentAuctionResult.rows.length > 0 
                ? currentAuctionResult.rows[0].auction_number 
                : null;
        }
        
        // Если текущий аукцион не найден, возвращаем пустой результат
        if (!currentAuctionNumber) {
            return res.json({
                currentAuctionNumber: null,
                lots: [],
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: 0,
                    pages: 0
                }
            });
        }
        
        // Получаем лоты текущего аукциона (все лоты для активного аукциона)
        const query = `
            SELECT 
                id, lot_number, auction_number, coin_description,
                avers_image_url, revers_image_url, winner_login, 
                winning_bid, auction_end_date, bids_count, lot_status,
                year, letters, metal, condition, weight, parsed_at, source_url
            FROM auction_lots 
            WHERE auction_number = $1
            ORDER BY lot_number::int ASC
            LIMIT $2 OFFSET $3
        `;
        
        const offset = (page - 1) * limit;
        const result = await pool.query(query, [currentAuctionNumber, parseInt(limit), offset]);
        
        // Получаем общее количество лотов текущего аукциона
        const countQuery = `
            SELECT COUNT(*) as total
            FROM auction_lots 
            WHERE auction_number = $1
        `;
        
        const countResult = await pool.query(countQuery, [currentAuctionNumber]);
        const total = parseInt(countResult.rows[0].total);
        
        res.json({
            currentAuctionNumber: currentAuctionNumber,
            lots: result.rows,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('Ошибка получения текущего аукциона:', error);
        res.status(500).json({ error: 'Ошибка получения данных текущего аукциона' });
    }
});

// Получить детальную информацию о лоте (рабочий эндпоинт)
app.get('/api/lot-details/:lotId', async (req, res) => {
    try {
        const { lotId } = req.params;
        
        const query = `
            SELECT 
                id, lot_number, auction_number, coin_description,
                avers_image_url, revers_image_url, winner_login, 
                winning_bid, auction_end_date, bids_count, lot_status,
                year, letters, metal, condition, weight, parsed_at, source_url
            FROM auction_lots 
            WHERE id = $1
        `;
        
        const result = await pool.query(query, [lotId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Лот не найден' });
        }
        
        res.json(result.rows[0]);
        
    } catch (error) {
        console.error('Ошибка получения деталей лота:', error);
        res.status(500).json({ error: 'Ошибка получения деталей лота' });
    }
});

// Получить детальную информацию о лоте (для совместимости)
app.get('/api/lots/:lotId', async (req, res) => {
    try {
        const { lotId } = req.params;
        
        const query = `
            SELECT 
                id, lot_number, auction_number, coin_description,
                avers_image_url, revers_image_url, winner_login, 
                winning_bid, auction_end_date, bids_count, lot_status,
                year, letters, metal, condition, weight, parsed_at, source_url
            FROM auction_lots 
            WHERE id = $1
        `;
        
        const result = await pool.query(query, [lotId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Лот не найден' });
        }
        
        res.json(result.rows[0]);
        
    } catch (error) {
        console.error('Ошибка получения деталей лота:', error);
        res.status(500).json({ error: 'Ошибка получения деталей лота' });
    }
});


// Получить прогнозы цен для лотов текущего аукциона
app.get('/api/predictions/:auctionNumber', async (req, res) => {
    try {
        const { auctionNumber } = req.params;
        
        const query = `
            SELECT 
                al.id,
                al.lot_number,
                al.condition,
                al.metal,
                al.weight,
                al.year,
                al.letters,
                al.winning_bid,
                al.coin_description,
                lpp.predicted_price,
                lpp.metal_value,
                lpp.numismatic_premium,
                lpp.confidence_score,
                lpp.prediction_method,
                lpp.sample_size,
                lpp.created_at as prediction_created_at
            FROM auction_lots al
            LEFT JOIN lot_price_predictions lpp ON al.id = lpp.lot_id
            WHERE al.auction_number = $1
            ORDER BY al.lot_number
        `;
        
        const result = await pool.query(query, [auctionNumber]);
        
        res.json(result.rows);
        
    } catch (error) {
        console.error('Ошибка получения прогнозов:', error);
        res.status(500).json({ error: 'Ошибка получения прогнозов' });
    }
});

// Получить прогноз для конкретного лота
app.get('/api/prediction/:lotId', async (req, res) => {
    try {
        const { lotId } = req.params;
        
        const query = `
            SELECT 
                al.id,
                al.lot_number,
                al.condition,
                al.metal,
                al.weight,
                al.year,
                al.letters,
                al.winning_bid,
                al.coin_description,
                lpp.predicted_price,
                lpp.metal_value,
                lpp.numismatic_premium,
                lpp.confidence_score,
                lpp.prediction_method,
                lpp.sample_size,
                lpp.created_at as prediction_created_at
            FROM auction_lots al
            LEFT JOIN lot_price_predictions lpp ON al.id = lpp.lot_id
            WHERE al.id = $1
        `;
        
        const result = await pool.query(query, [lotId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Лот не найден' });
        }
        
        res.json(result.rows[0]);
        
    } catch (error) {
        console.error('Ошибка получения прогноза:', error);
        res.status(500).json({ error: 'Ошибка получения прогноза' });
    }
});

// Поиск аналогичных лотов для истории цен
app.get('/api/similar-lots/:lotId', async (req, res) => {
    try {
        const { lotId } = req.params;
        
        // Сначала получаем информацию о текущем лоте
        const currentLotQuery = `
            SELECT 
                coin_description, metal, condition, year, letters, auction_number
            FROM auction_lots 
            WHERE id = $1
        `;
        
        const currentLotResult = await pool.query(currentLotQuery, [lotId]);
        
        if (currentLotResult.rows.length === 0) {
            return res.status(404).json({ error: 'Лот не найден' });
        }
        
        const currentLot = currentLotResult.rows[0];
        
        // Извлекаем номинал из описания монеты
        const denominationMatch = currentLot.coin_description.match(/(\d+)\s*рублей?/i);
        const currentDenomination = denominationMatch ? denominationMatch[1] : null;
        
        // Ищем аналогичные лоты с учетом номинала
        // Точное совпадение по condition, metal, year, letters И номиналу
        // Исключаем лоты текущего аукциона
        let similarQuery = `
            SELECT 
                id, lot_number, auction_number, coin_description,
                winning_bid, winner_login, auction_end_date,
                metal, condition, year, letters, weight
            FROM auction_lots 
            WHERE condition = $2 
                AND metal = $3 
                AND year = $4 
                AND letters = $5
                AND id != $1
                AND auction_number != $6
                AND winning_bid IS NOT NULL 
                AND winning_bid > 0
        `;
        
        const params = [
            lotId,
            currentLot.condition,
            currentLot.metal, 
            currentLot.year,
            currentLot.letters,
            currentLot.auction_number
        ];
        
        // Если номинал найден, добавляем его в условие поиска
        if (currentDenomination) {
            // Используем более точное сопоставление с границами слов
            similarQuery += ` AND coin_description ~ $${params.length + 1}`;
            params.push(`\\m${currentDenomination}\\s*рублей?\\M`);
        }
        
        similarQuery += ` ORDER BY auction_end_date DESC`;
        
        const similarResult = await pool.query(similarQuery, params);
        
        res.json({
            currentLot: currentLot,
            similarLots: similarResult.rows
        });
        
    } catch (error) {
        console.error('Ошибка поиска аналогичных лотов:', error);
        res.status(500).json({ error: 'Ошибка поиска аналогичных лотов' });
    }
});

// Экспорт данных в CSV
app.get('/api/export/csv', async (req, res) => {
    try {
        const { auctionNumber } = req.query;
        
        let query = `
            SELECT 
                lot_number, auction_number, coin_description,
                winner_login, winning_bid, auction_end_date,
                bids_count, lot_status, year, letters, metal, condition,
                parsed_at, source_url
            FROM auction_lots
        `;
        
        const params = [];
        if (auctionNumber) {
            query += ` WHERE auction_number = $1`;
            params.push(auctionNumber);
        }
        
        query += ` ORDER BY auction_number DESC, lot_number::int ASC`;
        
        const result = await pool.query(query, params);
        
        // Создаем CSV
        const headers = [
            'Номер лота', 'Номер аукциона', 'Описание монеты',
            'Победитель', 'Цена', 'Дата окончания аукциона',
            'Количество ставок', 'Статус', 'Год', 'Буквы', 'Металл', 'Состояние',
            'Дата парсинга', 'URL источника'
        ];
        
        const csvContent = [
            headers.join(','),
            ...result.rows.map(row => [
                row.lot_number || '',
                row.auction_number || '',
                `"${(row.coin_description || '').replace(/"/g, '""')}"`,
                row.winner_login || '',
                row.winning_bid || '',
                row.auction_end_date || '',
                row.bids_count || '',
                row.lot_status || '',
                row.year || '',
                row.letters || '',
                row.metal || '',
                row.condition || '',
                row.parsed_at || '',
                row.source_url || ''
            ].join(','))
        ].join('\n');
        
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="wolmar-auctions${auctionNumber ? `-${auctionNumber}` : ''}-${new Date().toISOString().split('T')[0]}.csv"`);
        res.send('\ufeff' + csvContent); // BOM для корректного отображения в Excel
        
    } catch (error) {
        console.error('Ошибка экспорта CSV:', error);
        res.status(500).json({ error: 'Ошибка экспорта данных' });
    }
});

// Metals prices API endpoints
app.get('/api/metals-prices/:date', async (req, res) => {
    try {
        const { date } = req.params;
        const { metal = 'gold' } = req.query;
        const priceData = await metalsService.getMetalPriceFromDB(date, metal);
        
        if (!priceData) {
            return res.status(404).json({ error: 'Данные за указанную дату не найдены' });
        }
        
        res.json(priceData);
        
    } catch (error) {
        console.error('Ошибка получения цен на металлы:', error);
        res.status(500).json({ error: 'Ошибка получения цен на металлы' });
    }
});

app.get('/api/metals-prices', async (req, res) => {
    try {
        const { start_date, end_date, limit = 100 } = req.query;
        
        let query = `
            SELECT date, usd_rate, gold_price, silver_price, platinum_price, palladium_price
            FROM metals_prices
            WHERE 1=1
        `;
        const params = [];
        let paramIndex = 1;
        
        if (start_date) {
            query += ` AND date >= $${paramIndex}`;
            params.push(start_date);
            paramIndex++;
        }
        
        if (end_date) {
            query += ` AND date <= $${paramIndex}`;
            params.push(end_date);
            paramIndex++;
        }
        
        query += ` ORDER BY date DESC LIMIT $${paramIndex}`;
        params.push(parseInt(limit));
        
        const result = await pool.query(query, params);
        res.json(result.rows);
        
    } catch (error) {
        console.error('Ошибка получения списка цен на металлы:', error);
        res.status(500).json({ error: 'Ошибка получения списка цен на металлы' });
    }
});

app.get('/api/numismatic-premium/:lotId', async (req, res) => {
    try {
        const { lotId } = req.params;
        
        // Получаем данные лота
        const lotQuery = `
            SELECT id, lot_number, auction_number, coin_description, 
                   winning_bid, auction_end_date, metal, weight
            FROM auction_lots 
            WHERE id = $1
        `;
        
        const lotResult = await pool.query(lotQuery, [lotId]);
        
        if (lotResult.rows.length === 0) {
            return res.status(404).json({ error: 'Лот не найден' });
        }
        
        const lot = lotResult.rows[0];
        
        // Проверяем, что у нас есть все необходимые данные
        if (!lot.winning_bid || !lot.metal || !lot.weight || !lot.auction_end_date) {
            return res.status(400).json({ 
                error: 'Недостаточно данных для расчета нумизматической наценки',
                missing: {
                    winning_bid: !lot.winning_bid,
                    metal: !lot.metal,
                    weight: !lot.weight,
                    auction_end_date: !lot.auction_end_date
                }
            });
        }
        
        // Получаем цену металла на дату аукциона (только дата, без времени)
        const metalType = lot.metal.toLowerCase() + '_price';
        const auctionDate = new Date(lot.auction_end_date).toISOString().split('T')[0]; // YYYY-MM-DD
        const priceData = await metalsService.getMetalPriceFromDB(auctionDate, metalType);
        
        if (!priceData) {
            return res.status(404).json({ 
                error: 'Цена металла на дату аукциона не найдена',
                auction_date: lot.auction_end_date
            });
        }
        
        // Вычисляем нумизматическую наценку
        const premium = metalsService.calculateNumismaticPremium(
            lot.winning_bid,
            lot.weight,
            priceData.price,
            priceData.usdRate
        );
        
        res.json({
            lot: {
                id: lot.id,
                lot_number: lot.lot_number,
                auction_number: lot.auction_number,
                metal: lot.metal,
                weight: lot.weight,
                winning_bid: lot.winning_bid,
                auction_end_date: lot.auction_end_date
            },
            metal_price: {
                price_per_gram: priceData.price,
                usd_rate: priceData.usdRate,
                date: lot.auction_end_date
            },
            numismatic_premium: premium
        });
        
    } catch (error) {
        console.error('Ошибка расчета нумизматической наценки:', error);
        res.status(500).json({ error: 'Ошибка расчета нумизматической наценки' });
    }
});

// API эндпоинт для расчета нумизматической наценки на текущую дату
app.get('/api/numismatic-premium-current/:lotId', async (req, res) => {
    try {
        const { lotId } = req.params;
        
        // Получаем данные лота
        const lotQuery = `
            SELECT id, lot_number, auction_number, coin_description, 
                   winning_bid, auction_end_date, metal, weight
            FROM auction_lots 
            WHERE id = $1
        `;
        
        const lotResult = await pool.query(lotQuery, [lotId]);
        
        if (lotResult.rows.length === 0) {
            return res.status(404).json({ error: 'Лот не найден' });
        }
        
        const lot = lotResult.rows[0];
        
        // Проверяем, что у нас есть все необходимые данные
        if (!lot.winning_bid || !lot.metal || !lot.weight) {
            return res.status(400).json({ 
                error: 'Недостаточно данных для расчета нумизматической наценки',
                missing: {
                    winning_bid: !lot.winning_bid,
                    metal: !lot.metal,
                    weight: !lot.weight
                }
            });
        }
        
        // Получаем цену металла на текущую дату (сегодня или вчера)
        const metalType = lot.metal.toLowerCase() + '_price';
        const today = new Date().toISOString().split('T')[0];
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        
        let priceData = await metalsService.getMetalPriceFromDB(today, metalType);
        let priceDate = today;
        
        // Если нет данных на сегодня, пробуем вчера
        if (!priceData) {
            priceData = await metalsService.getMetalPriceFromDB(yesterday, metalType);
            priceDate = yesterday;
        }
        
        if (!priceData) {
            return res.status(404).json({ 
                error: 'Цена металла на текущую дату не найдена',
                tried_dates: [today, yesterday]
            });
        }
        
        // Вычисляем нумизматическую наценку
        const premium = metalsService.calculateNumismaticPremium(
            lot.winning_bid,
            lot.weight,
            priceData.price,
            priceData.usdRate
        );
        
        res.json({
            lot: {
                id: lot.id,
                lot_number: lot.lot_number,
                auction_number: lot.auction_number,
                metal: lot.metal,
                weight: lot.weight,
                winning_bid: lot.winning_bid,
                auction_end_date: lot.auction_end_date
            },
            metal_price: {
                price_per_gram: priceData.price,
                usd_rate: priceData.usdRate,
                date: priceDate
            },
            numismatic_premium: premium
        });
        
    } catch (error) {
        console.error('Ошибка расчета нумизматической наценки на текущую дату:', error);
        res.status(500).json({ error: 'Ошибка расчета нумизматической наценки на текущую дату' });
    }
});

// Serve React app
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Ошибка сервера:', error);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
    console.log(`📊 API доступно по адресу: http://localhost:${PORT}/api`);
    console.log(`🌐 Веб-интерфейс: http://localhost:${PORT}`);
});

// Эндпоинт для получения всех лотов текущего аукциона (для аналитики)
app.get('/api/current-auction-all', async (req, res) => {
    try {
        // Сначала определяем номер текущего аукциона (аукцион 2130, если он есть, иначе активный аукцион)
        const currentAuctionQuery = `
            SELECT 
                auction_number
            FROM auction_lots 
            WHERE auction_number = '2130'
            LIMIT 1
        `;
        
        let currentAuctionResult = await pool.query(currentAuctionQuery);
        let currentAuctionNumber = currentAuctionResult.rows.length > 0 
            ? currentAuctionResult.rows[0].auction_number 
            : null;
        
        // Если аукцион 2130 не найден, ищем активный аукцион (дата окончания больше текущей)
        if (!currentAuctionNumber) {
            const activeAuctionQuery = `
                SELECT 
                    auction_number
                FROM auction_lots 
                WHERE auction_number IS NOT NULL
                AND auction_end_date > NOW()
                ORDER BY auction_number DESC
                LIMIT 1
            `;
            currentAuctionResult = await pool.query(activeAuctionQuery);
            currentAuctionNumber = currentAuctionResult.rows.length > 0 
                ? currentAuctionResult.rows[0].auction_number 
                : null;
        }
        
        // Если активный аукцион не найден, берем самый новый аукцион
        if (!currentAuctionNumber) {
            const latestAuctionQuery = `
                SELECT 
                    auction_number
                FROM auction_lots 
                WHERE auction_number IS NOT NULL
                ORDER BY auction_number DESC
                LIMIT 1
            `;
            currentAuctionResult = await pool.query(latestAuctionQuery);
            currentAuctionNumber = currentAuctionResult.rows.length > 0 
                ? currentAuctionResult.rows[0].auction_number 
                : null;
        }
        
        // Если текущий аукцион не найден, возвращаем пустой результат
        if (!currentAuctionNumber) {
            return res.json({
                currentAuctionNumber: null,
                lots: [],
                total: 0
            });
        }
        
        // Получаем ВСЕ лоты текущего аукциона (без ограничений)
        const query = `
            SELECT 
                id, lot_number, auction_number, coin_description,
                avers_image_url, revers_image_url, winner_login, 
                winning_bid, auction_end_date, bids_count, lot_status,
                year, letters, metal, condition, weight, parsed_at, source_url
            FROM auction_lots 
            WHERE auction_number = $1
            ORDER BY lot_number::int ASC
        `;
        
        const result = await pool.query(query, [currentAuctionNumber]);
        
        res.json({
            currentAuctionNumber: currentAuctionNumber,
            lots: result.rows,
            total: result.rows.length
        });
        
    } catch (error) {
        console.error('Ошибка получения всех лотов текущего аукциона:', error);
        res.status(500).json({ error: 'Ошибка получения лотов' });
    }
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Получен сигнал завершения, закрываем соединения...');
    await pool.end();
    process.exit(0);
});

module.exports = app;

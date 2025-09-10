const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');
const config = require('./config');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Database connection
const pool = new Pool(config.dbConfig);

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
                bids_count, lot_status, year, letters, metal, condition,
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
                bids_count, lot_status, year, letters, metal, condition,
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
                year, letters, metal, condition
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
                auction_end_date, metal, condition
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

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Получен сигнал завершения, закрываем соединения...');
    await pool.end();
    process.exit(0);
});

module.exports = app;

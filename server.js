const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');
// Автоматический выбор конфигурации в зависимости от окружения
const isProduction = process.env.NODE_ENV === 'production' || process.env.PORT;
const config = require(isProduction ? './config.production' : './config');
const AuthService = require('./auth-service');
const CollectionService = require('./collection-service');
const CollectionPriceService = require('./collection-price-service');

// Функция для парсинга ставки одного лота (точная копия логики из update-current-auction.js)
async function parseSingleLotBid(lotUrl) {
    const { launchPuppeteer, createPage } = require('./puppeteer-utils');
    
    const browser = await launchPuppeteer();
    
    try {
        const page = await createPage(browser);
        
        console.log(`📄 Загружаем лот: ${lotUrl}`);
        await page.goto(lotUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const lotData = await page.evaluate(() => {
            const data = {};
            
            // Номер лота - из заголовка h5
            const lotTitle = document.querySelector('h5');
            if (lotTitle) {
                const match = lotTitle.textContent.match(/Лот\s*№\s*(\d+)/i);
                if (match) {
                    data.lotNumber = parseInt(match[1]);
                }
            }
            
            // Информация о торгах
            const valuesDiv = document.querySelectorAll('.values')[1];
            if (valuesDiv) {
                const valuesText = valuesDiv.textContent;
                
                // Текущая ставка
                const bidMatch = valuesText.match(/Ставка:\s*(\d+(?:\s?\d+)*(?:[.,]\d+)?)\s*руб/i);
                if (bidMatch) {
                    data.winningBid = bidMatch[1].replace(/\s/g, '').replace(',', '.');
                }
                
                // Лидер
                const leaderMatch = valuesText.match(/Лидер:\s*([a-zA-Z0-9_А-Яа-я]+)/i);
                if (leaderMatch) {
                    data.winnerLogin = leaderMatch[1];
                }
            }
            
            return data;
        });
        
        console.log(`📊 Парсинг лота завершен:`, lotData);
        return lotData;
        
    } catch (error) {
        console.error('❌ Ошибка парсинга лота:', error);
        return null;
    } finally {
        await browser.close();
    }
}

// Единая функция для определения текущего аукциона
async function getCurrentAuctionNumber(pool) {
    try {
        // 1. Сначала ищем активный аукцион (дата окончания больше текущей)
        const activeAuctionQuery = `
            SELECT 
                auction_number
            FROM auction_lots 
            WHERE auction_number IS NOT NULL
            AND auction_end_date > NOW()
            ORDER BY auction_number DESC
            LIMIT 1
        `;
        
        let currentAuctionResult = await pool.query(activeAuctionQuery);
        let currentAuctionNumber = currentAuctionResult.rows.length > 0 
            ? currentAuctionResult.rows[0].auction_number 
            : null;
        
        // 2. Если активный аукцион не найден, берем самый новый аукцион
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
        
        return currentAuctionNumber;
    } catch (error) {
        console.error('Ошибка определения текущего аукциона:', error);
        return null;
    }
}
const MetalsPriceService = require('./metals-price-service');
const WinnerRatingsService = require('./winner-ratings-service');
const adminFunctions = require('./admin-server');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Middleware для проверки аутентификации
const authenticateToken = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
        return res.status(401).json({ error: 'Токен доступа не предоставлен' });
    }

    try {
        const user = await authService.verifyUser(token);
        if (!user) {
            return res.status(403).json({ error: 'Недействительный токен' });
        }
        console.log('🔐 Аутентификация успешна для пользователя:', user);
        req.user = user;
        next();
    } catch (error) {
        console.log('❌ Ошибка аутентификации:', error.message);
        res.status(401).json({ error: error.message });
    }
};

// Административная панель - ДОЛЖНА БЫТЬ ДО статических файлов
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Мониторинг сервера
app.get('/monitor', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'monitor.html'));
});

// Health check endpoint для PM2
app.get('/api/health', (req, res) => {
    try {
        res.json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            version: process.version,
            pid: process.pid
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// API для получения логов PM2
app.get('/api/logs', (req, res) => {
    try {
        const { exec } = require('child_process');
        const lines = req.query.lines || 50;
        
        exec(`pm2 logs wolmar-parser --lines ${lines} --nostream`, (error, stdout, stderr) => {
            if (error) {
                return res.status(500).json({
                    error: 'Ошибка получения логов',
                    message: error.message
                });
            }
            
            // Парсим логи PM2
            const logLines = stdout.split('\n').filter(line => line.trim());
            const logs = logLines.map(line => {
                try {
                    // Пытаемся распарсить JSON лог
                    const logData = JSON.parse(line);
                    return {
                        timestamp: logData.timestamp,
                        message: logData.message,
                        type: logData.type || 'info'
                    };
                } catch (e) {
                    // Если не JSON, возвращаем как есть
                    return {
                        timestamp: new Date().toISOString(),
                        message: line,
                        type: 'info'
                    };
                }
            });
            
            res.json({ logs });
        });
    } catch (error) {
        res.status(500).json({
            error: 'Ошибка получения логов',
            message: error.message
        });
    }
});

// API для анализа сбоя и восстановления парсеров
app.post('/api/crash-recovery/analyze', (req, res) => {
    try {
        const { exec } = require('child_process');
        
        // Запускаем анализ сбоя
        exec('node analyze-crash-recovery.js', (error, stdout, stderr) => {
            if (error) {
                console.error('Ошибка анализа сбоя:', error);
                return res.status(500).json({
                    success: false,
                    error: 'Ошибка анализа сбоя',
                    message: error.message,
                    stderr: stderr
                });
            }
            
            console.log('Анализ сбоя завершен:', stdout);
            res.json({
                success: true,
                message: 'Анализ сбоя завершен',
                output: stdout,
                report: 'Отчет сохранен в crash-recovery-report.json'
            });
        });
    } catch (error) {
        console.error('Ошибка в API анализа сбоя:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка анализа сбоя',
            message: error.message
        });
    }
});

app.post('/api/crash-recovery/auto-recovery', (req, res) => {
    try {
        const { exec } = require('child_process');
        
        // Запускаем автоматическое восстановление
        exec('node analyze-crash-recovery.js --auto-recovery', (error, stdout, stderr) => {
            if (error) {
                console.error('Ошибка автоматического восстановления:', error);
                return res.status(500).json({
                    success: false,
                    error: 'Ошибка автоматического восстановления',
                    message: error.message,
                    stderr: stderr
                });
            }
            
            console.log('Автоматическое восстановление завершено:', stdout);
            res.json({
                success: true,
                message: 'Автоматическое восстановление завершено',
                output: stdout
            });
        });
    } catch (error) {
        console.error('Ошибка в API автоматического восстановления:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка автоматического восстановления',
            message: error.message
        });
    }
});

// API для управления сервером
app.post('/api/server/restart', (req, res) => {
    try {
        const { exec } = require('child_process');
        
        // Сначала отправляем ответ клиенту
        res.json({
            success: true,
            message: 'Команда перезапуска отправлена',
            note: 'Сервер будет перезапущен через несколько секунд'
        });
        
        // Затем выполняем перезапуск
        setTimeout(() => {
            exec('pm2 restart wolmar-parser --silent', (error, stdout, stderr) => {
                if (error) {
                    console.error('Ошибка перезапуска:', error);
                } else {
                    console.log('Перезапуск успешен:', stdout);
                }
            });
        }, 1000); // Задержка 1 секунда для отправки ответа
        
    } catch (error) {
        console.error('Ошибка в API перезапуска:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка перезапуска сервера',
            message: error.message
        });
    }
});

app.post('/api/server/stop', (req, res) => {
    try {
        const { exec } = require('child_process');
        
        exec('pm2 stop wolmar-parser', (error, stdout, stderr) => {
            if (error) {
                return res.status(500).json({
                    success: false,
                    error: 'Ошибка остановки сервера',
                    message: error.message
                });
            }
            
            res.json({
                success: true,
                message: 'Сервер успешно остановлен',
                output: stdout
            });
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Ошибка остановки сервера',
            message: error.message
        });
    }
});

app.post('/api/server/start', (req, res) => {
    try {
        const { exec } = require('child_process');
        
        exec('pm2 start wolmar-parser', (error, stdout, stderr) => {
            if (error) {
                return res.status(500).json({
                    success: false,
                    error: 'Ошибка запуска сервера',
                    message: error.message
                });
            }
            
            res.json({
                success: true,
                message: 'Сервер успешно запущен',
                output: stdout
            });
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Ошибка запуска сервера',
            message: error.message
        });
    }
});

// Административные API маршруты - ДОЛЖНЫ БЫТЬ ДО статических файлов
app.get('/api/admin/status', (req, res) => {
    try {
        const status = adminFunctions.getStatus();
        res.json(status);
    } catch (error) {
        console.error('Ошибка получения статуса:', error);
        res.status(500).json({ error: 'Ошибка получения статуса' });
    }
});

// API для получения логов
app.get('/api/admin/logs/:type', (req, res) => {
    try {
        const { type } = req.params;
        const logs = adminFunctions.readLogs(type, 100);
        res.json({ logs });
    } catch (error) {
        console.error('Ошибка получения логов:', error);
        res.status(500).json({ error: 'Ошибка получения логов' });
    }
});

app.use(express.static(path.join(__dirname, 'public')));

// Database connection
const pool = new Pool(config.dbConfig);

// Metals price service
const metalsService = new MetalsPriceService();

// Catalog services
const authService = new AuthService();
const collectionService = new CollectionService();
const collectionPriceService = new CollectionPriceService();

// Test database connection
pool.on('connect', () => {
    console.log('✅ Подключение к базе данных установлено');
});

pool.on('error', (err) => {
    console.error('❌ Ошибка подключения к базе данных:', err);
});

// API Routes

// Получить список всех аукционов

// Получить лоты конкретного аукциона

// Получить детальную информацию о лоте

// Получить статистику аукциона

// Получить уникальные значения для фильтров

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

// API для работы с рейтингами победителей
const ratingsService = new WinnerRatingsService();

// Инициализация таблицы рейтингов
app.get('/api/ratings/init', async (req, res) => {
    try {
        await ratingsService.createRatingsTable();
        res.json({ success: true, message: 'Таблица рейтингов инициализирована' });
    } catch (error) {
        console.error('Ошибка инициализации таблицы рейтингов:', error);
        res.status(500).json({ error: 'Ошибка инициализации таблицы рейтингов' });
    }
});

// Получить рейтинг победителя
app.get('/api/ratings/:login', async (req, res) => {
    try {
        const { login } = req.params;
        const rating = await ratingsService.getWinnerRating(login);
        
        if (!rating) {
            return res.status(404).json({ error: 'Рейтинг не найден' });
        }
        
        res.json(rating);
    } catch (error) {
        console.error('Ошибка получения рейтинга:', error);
        res.status(500).json({ error: 'Ошибка получения рейтинга' });
    }
});

// Обновить рейтинг победителя
app.post('/api/ratings/:login/update', async (req, res) => {
    try {
        const { login } = req.params;
        const result = await ratingsService.updateWinnerRating(login);
        
        if (!result) {
            return res.status(404).json({ error: 'Победитель не найден' });
        }
        
        res.json(result);
    } catch (error) {
        console.error('Ошибка обновления рейтинга:', error);
        res.status(500).json({ error: 'Ошибка обновления рейтинга' });
    }
});

// Массовое обновление всех рейтингов
app.post('/api/ratings/update-all', async (req, res) => {
    try {
        const result = await ratingsService.updateAllRatings();
        res.json(result);
    } catch (error) {
        console.error('Ошибка массового обновления рейтингов:', error);
        res.status(500).json({ error: 'Ошибка массового обновления рейтингов' });
    }
});

// Получить топ победителей
app.get('/api/ratings/top', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 20;
        const topWinners = await ratingsService.getTopWinners(limit);
        res.json(topWinners);
    } catch (error) {
        console.error('Ошибка получения топ победителей:', error);
        res.status(500).json({ error: 'Ошибка получения топ победителей' });
    }
});

// API route for auctions list
app.get('/api/auctions', async (req, res) => {
    try {
        const query = `
            SELECT 
                auction_number,
                MIN(auction_end_date) as start_date,
                MAX(auction_end_date) as end_date,
                COUNT(*) as lots_count,
                SUM(winning_bid) as total_value,
                AVG(winning_bid) as avg_bid,
                MAX(winning_bid) as max_price,
                MIN(winning_bid) as min_price
            FROM auction_lots 
            WHERE auction_number IS NOT NULL
            GROUP BY auction_number
            ORDER BY auction_number DESC
        `;
        
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (error) {
        console.error('Ошибка получения списка аукционов:', error);
        res.status(500).json({ error: 'Ошибка получения списка аукционов' });
    }
});

// API route for auction lots
app.get('/api/auctions/:auctionNumber/lots', async (req, res) => {
    try {
        const { auctionNumber } = req.params;
        const { page = 1, limit = 20, search, metal, condition, year, minPrice, maxPrice } = req.query;
        
        let query = `
            SELECT 
                id, lot_number, auction_number, coin_description,
                winning_bid, auction_end_date, bids_count, lot_status,
                metal, condition, weight, year,
                avers_image_url, revers_image_url,
                winner_login
            FROM auction_lots 
            WHERE auction_number = $1
        `;
        
        const params = [auctionNumber];
        let paramIndex = 2;
        
        if (search) {
            query += ` AND coin_description ILIKE $${paramIndex}`;
            params.push(`%${search}%`);
            paramIndex++;
        }
        
        if (metal) {
            query += ` AND metal = $${paramIndex}`;
            params.push(metal);
            paramIndex++;
        }
        
        if (condition) {
            query += ` AND condition = $${paramIndex}`;
            params.push(condition);
            paramIndex++;
        }
        
        if (year) {
            query += ` AND year = $${paramIndex}`;
            params.push(parseInt(year));
            paramIndex++;
        }
        
        if (minPrice) {
            query += ` AND winning_bid >= $${paramIndex}`;
            params.push(parseFloat(minPrice));
            paramIndex++;
        }
        
        if (maxPrice) {
            query += ` AND winning_bid <= $${paramIndex}`;
            params.push(parseFloat(maxPrice));
            paramIndex++;
        }
        
        const offset = (parseInt(page) - 1) * parseInt(limit);
        query += ` ORDER BY lot_number::int ASC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        params.push(parseInt(limit), offset);
        
        const result = await pool.query(query, params);
        
        // Get total count
        let countQuery = `SELECT COUNT(*) FROM auction_lots WHERE auction_number = $1`;
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
        const totalLots = parseInt(countResult.rows[0].count);
        
        res.json({
            lots: result.rows,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: totalLots,
                pages: Math.ceil(totalLots / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('Ошибка получения лотов аукциона:', error);
        res.status(500).json({ error: 'Ошибка получения лотов аукциона' });
    }
});

// API route for filters
app.get('/api/filters', async (req, res) => {
    try {
        const { auctionNumber } = req.query;
        
        let query = `
            SELECT DISTINCT metal, condition, year
            FROM auction_lots 
            WHERE metal IS NOT NULL AND metal != ''
        `;
        
        const params = [];
        if (auctionNumber) {
            query += ` AND auction_number = $1`;
            params.push(auctionNumber);
        }
        
        const result = await pool.query(query, params);
        
        const metals = [...new Set(result.rows.map(row => row.metal).filter(Boolean))];
        const conditions = [...new Set(result.rows.map(row => row.condition).filter(Boolean))];
        const years = [...new Set(result.rows.map(row => row.year).filter(Boolean))].sort((a, b) => b - a);
        
        res.json({
            metals,
            conditions,
            years
        });
    } catch (error) {
        console.error('Ошибка получения фильтров:', error);
        res.status(500).json({ error: 'Ошибка получения фильтров' });
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

// Получить текущий аукцион (лоты без победителей) с поддержкой фильтрации
app.get('/api/current-auction', async (req, res) => {
    try {
        const { 
            page = 1, 
            limit = 20,
            // Фильтры
            country,
            metal,
            rarity,
            condition,
            mint,
            yearFrom,
            yearTo,
            search,
            priceFrom,
            priceTo,
            sort = 'lot_number'
        } = req.query;
        
        console.log('🔍 Запрос текущего аукциона с фильтрами:', req.query);
        
        // Определяем номер текущего аукциона
        const currentAuctionNumber = await getCurrentAuctionNumber(pool);
        
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
        
        // Строим WHERE условия для фильтрации
        let whereConditions = ['auction_number = $1'];
        let queryParams = [currentAuctionNumber];
        let paramIndex = 2;
        
        // Фильтр по металлу
        if (metal) {
            whereConditions.push(`metal = $${paramIndex}`);
            queryParams.push(metal);
            paramIndex++;
        }
        
        // Фильтр по состоянию
        if (condition) {
            whereConditions.push(`condition = $${paramIndex}`);
            queryParams.push(condition);
            paramIndex++;
        }
        
        // Фильтр по году
        if (yearFrom) {
            whereConditions.push(`year >= $${paramIndex}`);
            queryParams.push(parseInt(yearFrom));
            paramIndex++;
        }
        
        if (yearTo) {
            whereConditions.push(`year <= $${paramIndex}`);
            queryParams.push(parseInt(yearTo));
            paramIndex++;
        }
        
        // Поиск по описанию
        if (search) {
            whereConditions.push(`coin_description ILIKE $${paramIndex}`);
            queryParams.push(`%${search}%`);
            paramIndex++;
        }
        
        // Фильтр по цене (текущая цена = winning_bid)
        if (priceFrom) {
            whereConditions.push(`winning_bid >= $${paramIndex}`);
            queryParams.push(parseFloat(priceFrom));
            paramIndex++;
        }
        
        if (priceTo) {
            whereConditions.push(`winning_bid <= $${paramIndex}`);
            queryParams.push(parseFloat(priceTo));
            paramIndex++;
        }
        
        // Сортировка
        let orderBy = 'lot_number::int ASC';
        switch (sort) {
            case 'premium-desc':
                orderBy = 'winning_bid DESC';
                break;
            case 'premium-asc':
                orderBy = 'winning_bid ASC';
                break;
            case 'price-desc':
                orderBy = 'winning_bid DESC';
                break;
            case 'price-asc':
                orderBy = 'winning_bid ASC';
                break;
            case 'weight-desc':
                orderBy = 'weight DESC';
                break;
            case 'weight-asc':
                orderBy = 'weight ASC';
                break;
            case 'year-desc':
                orderBy = 'year DESC';
                break;
            case 'year-asc':
                orderBy = 'year ASC';
                break;
        }
        
        // Строим финальный запрос
        const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';
        
        const query = `
            SELECT 
                id, lot_number, auction_number, coin_description,
                avers_image_url, revers_image_url, winner_login, 
                winning_bid, auction_end_date, bids_count, lot_status,
                year, letters, metal, condition, weight, parsed_at, source_url,
                -- Добавляем расчет наценки (пока упрощенный)
                CASE 
                    WHEN winning_bid > 0 THEN 
                        ROUND(((winning_bid - COALESCE(weight * 0.001, 0)) / COALESCE(weight * 0.001, 1)) * 100, 1)
                    ELSE 0 
                END as premium
            FROM auction_lots 
            ${whereClause}
            ORDER BY ${orderBy}
            LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;
        
        const offset = (page - 1) * limit;
        queryParams.push(parseInt(limit), offset);
        
        console.log('📡 SQL запрос:', query);
        console.log('📡 Параметры:', queryParams);
        
        const result = await pool.query(query, queryParams);
        
        // Получаем общее количество лотов с теми же фильтрами
        const countQuery = `
            SELECT COUNT(*) as total
            FROM auction_lots 
            ${whereClause}
        `;
        
        const countResult = await pool.query(countQuery, queryParams.slice(0, -2)); // Убираем limit и offset
        const total = parseInt(countResult.rows[0].total);
        
        console.log('📊 Найдено лотов:', total);
        
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
        
        // Извлекаем номинал и тип валюты из описания монеты
        const denominationMatch = currentLot.coin_description.match(/(\d+)\s*рублей?/i);
        const currentDenomination = denominationMatch ? denominationMatch[1] : null;
        
        // Определяем тип валюты/монеты
        let currentCurrency = null;
        const currencyPatterns = [
            { pattern: /рублей?|рубл/i, currency: 'рубль' },
            { pattern: /экю|ecu/i, currency: 'экю' },
            { pattern: /стювер|stuiver/i, currency: 'стювер' },
            { pattern: /талер|thaler/i, currency: 'талер' },
            { pattern: /флорин|florin/i, currency: 'флорин' },
            { pattern: /дукат|ducat/i, currency: 'дукат' },
            { pattern: /крона|krona/i, currency: 'крона' },
            { pattern: /шиллинг|shilling/i, currency: 'шиллинг' },
            { pattern: /пенни|penny/i, currency: 'пенни' },
            { pattern: /сольдо|soldo/i, currency: 'сольдо' },
            { pattern: /реал|real/i, currency: 'реал' },
            { pattern: /лира|lira/i, currency: 'лира' }
        ];
        
        for (const { pattern, currency } of currencyPatterns) {
            if (pattern.test(currentLot.coin_description)) {
                currentCurrency = currency;
                break;
            }
        }
        
        // Извлекаем страну происхождения из описания монеты
        let currentCountry = null;
        const countryPatterns = [
            { pattern: /Россия|Российская|Российской|Российская империя/i, country: 'Россия' },
            { pattern: /Франция|Французская|Французской/i, country: 'Франция' },
            { pattern: /Нидерланды|Голландия|Голландская|Голландской/i, country: 'Нидерланды' },
            { pattern: /Германия|Немецкая|Немецкой|Пруссия|Прусская/i, country: 'Германия' },
            { pattern: /Австрия|Австрийская|Австрийской/i, country: 'Австрия' },
            { pattern: /Англия|Английская|Английской|Великобритания/i, country: 'Англия' },
            { pattern: /Испания|Испанская|Испанской/i, country: 'Испания' },
            { pattern: /Италия|Итальянская|Итальянской/i, country: 'Италия' }
        ];
        
        for (const { pattern, country } of countryPatterns) {
            if (pattern.test(currentLot.coin_description)) {
                currentCountry = country;
                break;
            }
        }
        
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
        
        // Если тип валюты найден, добавляем фильтрацию по валюте
        if (currentCurrency) {
            similarQuery += ` AND coin_description ~* $${params.length + 1}`;
            // Создаем паттерн для поиска валюты в описании
            let currencyPattern = '';
            switch (currentCurrency) {
                case 'рубль':
                    currencyPattern = 'рублей?|рубл';
                    break;
                case 'экю':
                    currencyPattern = 'экю|ecu';
                    break;
                case 'стювер':
                    currencyPattern = 'стювер|stuiver';
                    break;
                case 'талер':
                    currencyPattern = 'талер|thaler';
                    break;
                case 'флорин':
                    currencyPattern = 'флорин|florin';
                    break;
                case 'дукат':
                    currencyPattern = 'дукат|ducat';
                    break;
                case 'крона':
                    currencyPattern = 'крона|krona';
                    break;
                case 'шиллинг':
                    currencyPattern = 'шиллинг|shilling';
                    break;
                case 'пенни':
                    currencyPattern = 'пенни|penny';
                    break;
                case 'сольдо':
                    currencyPattern = 'сольдо|soldo';
                    break;
                case 'реал':
                    currencyPattern = 'реал|real';
                    break;
                case 'лира':
                    currencyPattern = 'лира|lira';
                    break;
            }
            params.push(currencyPattern);
        }
        
        // Если страна найдена, добавляем фильтрацию по стране
        if (currentCountry) {
            similarQuery += ` AND coin_description ~* $${params.length + 1}`;
            // Создаем паттерн для поиска страны в описании
            let countryPattern = '';
            switch (currentCountry) {
                case 'Россия':
                    countryPattern = 'Россия|Российская|Российской|Российская империя';
                    break;
                case 'Франция':
                    countryPattern = 'Франция|Французская|Французской';
                    break;
                case 'Нидерланды':
                    countryPattern = 'Нидерланды|Голландия|Голландская|Голландской';
                    break;
                case 'Германия':
                    countryPattern = 'Германия|Немецкая|Немецкой|Пруссия|Прусская';
                    break;
                case 'Австрия':
                    countryPattern = 'Австрия|Австрийская|Австрийской';
                    break;
                case 'Англия':
                    countryPattern = 'Англия|Английская|Английской|Великобритания';
                    break;
                case 'Испания':
                    countryPattern = 'Испания|Испанская|Испанской';
                    break;
                case 'Италия':
                    countryPattern = 'Италия|Итальянская|Итальянской';
                    break;
            }
            params.push(countryPattern);
        }
        
        similarQuery += ` ORDER BY auction_end_date DESC`;
        
        // Логируем информацию для отладки
        console.log(`Поиск аналогичных лотов для лота ${lotId}:`);
        console.log(`- Страна: ${currentCountry || 'не определена'}`);
        console.log(`- Валюта: ${currentCurrency || 'не определена'}`);
        console.log(`- Номинал: ${currentDenomination || 'не определен'}`);
        console.log(`- Металл: ${currentLot.metal}, Год: ${currentLot.year}, Состояние: ${currentLot.condition}`);
        console.log(`- Запрос: ${similarQuery}`);
        console.log(`- Параметры: ${JSON.stringify(params)}`);
        
        const similarResult = await pool.query(similarQuery, params);
        
        console.log(`Найдено ${similarResult.rows.length} аналогичных лотов`);
        
        res.json({
            currentLot: currentLot,
            similarLots: similarResult.rows,
            searchCriteria: {
                country: currentCountry,
                currency: currentCurrency,
                denomination: currentDenomination,
                metal: currentLot.metal,
                year: currentLot.year,
                condition: currentLot.condition
            }
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

// ==================== API ДЛЯ ПАРСЕРА КАТАЛОГА ====================

// API для запуска парсера каталога
app.post('/api/admin/start-catalog-parser', async (req, res) => {
    try {
        const { exec } = require('child_process');
        
        // Проверяем, доступен ли PM2
        exec('pm2 --version', (pm2Error, pm2Stdout, pm2Stderr) => {
            if (pm2Error) {
                // PM2 не доступен, запускаем напрямую через node
                console.log('PM2 не доступен, запускаем парсер напрямую через node');
                const child = exec('node catalog-parser.js --resume', (error, stdout, stderr) => {
                    if (error) {
                        console.error('Ошибка запуска парсера через node:', error);
                        res.status(500).json({ 
                            success: false,
                            error: 'Ошибка запуска парсера каталога: ' + error.message 
                        });
                        return;
                    }
                    
                    console.log('Node stdout:', stdout);
                    if (stderr) console.log('Node stderr:', stderr);
                    
                    res.json({
                        success: true,
                        message: 'Парсер каталога запущен через node',
                        output: stdout
                    });
                });
                
                // Отправляем ответ сразу, так как процесс запущен в фоне
                res.json({
                    success: true,
                    message: 'Парсер каталога запущен в фоновом режиме через node',
                    pid: child.pid
                });
            } else {
                // PM2 доступен, используем его
                console.log('PM2 доступен, запускаем парсер через PM2');
                exec('pm2 start catalog-parser.js --name "catalog-parser" -- --resume', (error, stdout, stderr) => {
                    if (error) {
                        console.error('Ошибка запуска парсера через PM2:', error);
                        res.status(500).json({ 
                            success: false,
                            error: 'Ошибка запуска парсера каталога через PM2: ' + error.message 
                        });
                        return;
                    }
                    
                    console.log('PM2 stdout:', stdout);
                    if (stderr) console.log('PM2 stderr:', stderr);
                    
                    res.json({
                        success: true,
                        message: 'Парсер каталога запущен через PM2',
                        output: stdout
                    });
                });
            }
        });
    } catch (error) {
        console.error('Ошибка запуска парсера каталога:', error);
        res.status(500).json({ error: 'Ошибка запуска парсера каталога' });
    }
});

// API для остановки парсера каталога
app.post('/api/admin/stop-catalog-parser', async (req, res) => {
    try {
        const { exec } = require('child_process');
        
        // Используем PM2 для остановки парсера каталога
        exec('pm2 stop catalog-parser', (error, stdout, stderr) => {
            if (error) {
                console.error('Ошибка остановки парсера через PM2:', error);
                res.status(500).json({ 
                    success: false,
                    error: 'Ошибка остановки парсера каталога через PM2: ' + error.message 
                });
                return;
            }
            
            console.log('PM2 stop stdout:', stdout);
            if (stderr) console.log('PM2 stop stderr:', stderr);
            
            res.json({
                success: true,
                message: 'Парсер каталога остановлен через PM2',
                output: stdout
            });
        });
    } catch (error) {
        console.error('Ошибка остановки парсера каталога:', error);
        res.status(500).json({ error: 'Ошибка остановки парсера каталога' });
    }
});

// API для получения статуса парсера каталога
app.get('/api/admin/catalog-parser-status', async (req, res) => {
    try {
        const { exec } = require('child_process');
        
        // Проверяем статус через PM2
        exec('pm2 jlist', (error, stdout, stderr) => {
            if (error) {
                console.error('Ошибка получения статуса PM2:', error);
                res.status(500).json({ 
                    status: 'error',
                    message: 'Ошибка получения статуса PM2',
                    error: error.message
                });
                return;
            }
            
            try {
                const pm2Processes = JSON.parse(stdout);
                const catalogParser = pm2Processes.find(proc => proc.name === 'catalog-parser');
                
                if (catalogParser) {
                    res.json({
                        status: catalogParser.pm2_env.status,
                        message: `Парсер каталога ${catalogParser.pm2_env.status} (PM2 ID: ${catalogParser.pm_id})`,
                        pid: catalogParser.pid,
                        startTime: new Date(catalogParser.pm2_env.created_at).toISOString(),
                        uptime: catalogParser.pm2_env.uptime,
                        memory: catalogParser.monit.memory,
                        cpu: catalogParser.monit.cpu
                    });
                } else {
                    res.json({
                        status: 'stopped',
                        message: 'Парсер каталога не найден в PM2'
                    });
                }
            } catch (parseError) {
                console.error('Ошибка парсинга PM2 JSON:', parseError);
                res.status(500).json({ 
                    status: 'error',
                    message: 'Ошибка парсинга статуса PM2',
                    error: parseError.message
                });
            }
        });
    } catch (error) {
        console.error('Ошибка получения статуса парсера каталога:', error);
        res.status(500).json({ error: 'Ошибка получения статуса парсера каталога' });
    }
});

// API для получения логов парсера каталога
app.get('/api/admin/catalog-parser-logs', async (req, res) => {
    try {
        const fs = require('fs');
        const path = require('path');
        
        // Ищем файлы логов парсера каталога (приоритет логам активности)
        const logFiles = [
            'catalog-activity.log',
            'catalog-errors.log',
            'catalog-progress.json'
        ];
        
        let logs = [];
        
        for (const logFile of logFiles) {
            if (fs.existsSync(logFile)) {
                try {
                    const content = fs.readFileSync(logFile, 'utf8');
                    if (logFile.endsWith('.json')) {
                        // JSON файл - показываем как структурированные данные
                        const jsonData = JSON.parse(content);
                        logs.push({
                            file: logFile,
                            type: 'json',
                            data: jsonData
                        });
                    } else {
                        // Текстовый файл - показываем последние строки
                        const lines = content.split('\n').slice(-50); // Последние 50 строк
                        logs.push({
                            file: logFile,
                            type: 'text',
                            lines: lines
                        });
                    }
                } catch (e) {
                    logs.push({
                        file: logFile,
                        type: 'error',
                        error: 'Ошибка чтения файла'
                    });
                }
            }
        }
        
        res.json({ logs });
    } catch (error) {
        console.error('Ошибка получения логов парсера каталога:', error);
        res.status(500).json({ error: 'Ошибка получения логов парсера каталога' });
    }
});

// API для получения прогресса парсера каталога
app.get('/api/admin/catalog-parser-progress', async (req, res) => {
    try {
        const fs = require('fs');
        const { Pool } = require('pg');
        
        // Настройки подключения к базе данных
        const pool = new Pool({
            user: 'postgres',
            host: 'localhost',
            database: 'wolmar',
            password: 'postgres',
            port: 5432,
        });
        
        let progressData = null;
        let totalLots = 0;
        
        // Читаем файл прогресса
        if (fs.existsSync('catalog-progress.json')) {
            progressData = JSON.parse(fs.readFileSync('catalog-progress.json', 'utf8'));
        }
        
        // Получаем общее количество лотов для парсинга каталога
        try {
            const client = await pool.connect();
            
            // Если есть прогресс, считаем оставшиеся лоты
            if (progressData && progressData.lastProcessedId > 0) {
                const result = await client.query(`
                    SELECT COUNT(*) as total
                    FROM auction_lots 
                    WHERE id > ${progressData.lastProcessedId}
                    AND coin_description IS NOT NULL 
                    AND coin_description != ''
                `);
                totalLots = parseInt(result.rows[0].total);
            } else {
                // Если нет прогресса, считаем все лоты
                const result = await client.query(`
                    SELECT COUNT(*) as total
                    FROM auction_lots 
                    WHERE coin_description IS NOT NULL 
                    AND coin_description != ''
                `);
                totalLots = parseInt(result.rows[0].total);
            }
            client.release();
        } catch (dbError) {
            console.error('Ошибка получения общего количества лотов:', dbError);
            // Если не можем получить из БД, используем 0
            totalLots = 0;
        }
        
        if (progressData) {
            // Добавляем общее количество лотов к данным прогресса
            progressData.totalLots = totalLots;
            res.json({
                success: true,
                progress: progressData
            });
        } else {
            res.json({
                success: false,
                message: 'Файл прогресса не найден',
                totalLots: totalLots
            });
        }
    } catch (error) {
        console.error('Ошибка получения прогресса парсера каталога:', error);
        res.status(500).json({ error: 'Ошибка получения прогресса парсера каталога' });
    }
});

// API для очистки прогресса парсера каталога
app.post('/api/admin/clear-catalog-progress', async (req, res) => {
    try {
        const fs = require('fs');
        
        if (fs.existsSync('catalog-progress.json')) {
            fs.unlinkSync('catalog-progress.json');
        }
        
        res.json({
            success: true,
            message: 'Прогресс парсера каталога очищен'
        });
    } catch (error) {
        console.error('Ошибка очистки прогресса парсера каталога:', error);
        res.status(500).json({ error: 'Ошибка очистки прогресса парсера каталога' });
    }
});

// ==================== CATALOG API ====================

// Serve catalog static files
app.use('/catalog', express.static(path.join(__dirname, 'catalog-public'), {
    setHeaders: (res, path) => {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
    }
}));

// Serve catalog images
app.use('/catalog/images', express.static('catalog-images'));

// Catalog main page
app.get('/catalog', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Last-Modified', new Date().toUTCString());
    res.sendFile(path.join(__dirname, 'catalog-public', 'index.html'));
});

// Catalog statistics
app.get('/api/catalog/stats', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                COUNT(*) as total_coins,
                COUNT(DISTINCT country) as countries,
                COUNT(DISTINCT year) as years,
                COUNT(DISTINCT metal) as metals
            FROM coin_catalog
        `);
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Ошибка получения статистики каталога:', error);
        res.status(500).json({ error: 'Ошибка получения статистики каталога' });
    }
});

// Get countries
app.get('/api/catalog/countries', async (req, res) => {
    try {
        console.log('🔍 Запрос стран каталога');
        const result = await pool.query(`
            SELECT DISTINCT country, COUNT(*) as count
            FROM coin_catalog 
            WHERE country IS NOT NULL AND country != ''
            GROUP BY country 
            ORDER BY count DESC, country
        `);
        console.log('🔍 Результат стран:', result.rows);
        res.json(result.rows);
    } catch (error) {
        console.error('Ошибка получения стран:', error);
        res.status(500).json({ error: 'Ошибка получения стран' });
    }
});

// Get metals
app.get('/api/catalog/metals', async (req, res) => {
    try {
        console.log('🔍 Запрос металлов каталога');
        const result = await pool.query(`
            SELECT DISTINCT metal, COUNT(*) as count
            FROM coin_catalog 
            WHERE metal IS NOT NULL AND metal != ''
            GROUP BY metal 
            ORDER BY count DESC, metal
        `);
        console.log('🔍 Результат металлов:', result.rows);
        res.json(result.rows);
    } catch (error) {
        console.error('Ошибка получения металлов:', error);
        res.status(500).json({ error: 'Ошибка получения металлов' });
    }
});

// Get rarities
app.get('/api/catalog/rarities', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT DISTINCT rarity, COUNT(*) as count
            FROM coin_catalog 
            WHERE rarity IS NOT NULL AND rarity != ''
            GROUP BY rarity 
            ORDER BY count DESC, rarity
        `);
        res.json(result.rows);
    } catch (error) {
        console.error('Ошибка получения редкостей:', error);
        res.status(500).json({ error: 'Ошибка получения редкостей' });
    }
});

// Get conditions
app.get('/api/catalog/conditions', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT DISTINCT condition, COUNT(*) as count
            FROM coin_catalog 
            WHERE condition IS NOT NULL AND condition != ''
            GROUP BY condition 
            ORDER BY count DESC, condition
        `);
        res.json(result.rows);
    } catch (error) {
        console.error('Ошибка получения состояний:', error);
        res.status(500).json({ error: 'Ошибка получения состояний' });
    }
});

// Get mints
app.get('/api/catalog/mints', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT DISTINCT mint, COUNT(*) as count
            FROM coin_catalog 
            WHERE mint IS NOT NULL AND mint != ''
            GROUP BY mint 
            ORDER BY count DESC, mint
        `);
        res.json(result.rows);
    } catch (error) {
        console.error('Ошибка получения монетных дворов:', error);
        res.status(500).json({ error: 'Ошибка получения монетных дворов' });
    }
});

// Get all filters at once
app.get('/api/catalog/filters', async (req, res) => {
    try {
        console.log('🔍 Запрос всех фильтров каталога');
        
        // Загружаем все фильтры параллельно
        const [countriesResult, metalsResult, raritiesResult, conditionsResult, mintsResult] = await Promise.all([
            pool.query(`
                SELECT DISTINCT country, COUNT(*) as count
                FROM coin_catalog 
                WHERE country IS NOT NULL AND country != ''
                GROUP BY country 
                ORDER BY count DESC, country
            `),
            pool.query(`
                SELECT DISTINCT metal, COUNT(*) as count
                FROM coin_catalog 
                WHERE metal IS NOT NULL AND metal != ''
                GROUP BY metal 
                ORDER BY count DESC, metal
            `),
            pool.query(`
                SELECT DISTINCT rarity, COUNT(*) as count
                FROM coin_catalog 
                WHERE rarity IS NOT NULL AND rarity != ''
                GROUP BY rarity 
                ORDER BY count DESC, rarity
            `),
            pool.query(`
                SELECT DISTINCT condition, COUNT(*) as count
                FROM coin_catalog 
                WHERE condition IS NOT NULL AND condition != ''
                GROUP BY condition 
                ORDER BY count DESC, condition
            `),
            pool.query(`
                SELECT DISTINCT mint, COUNT(*) as count
                FROM coin_catalog 
                WHERE mint IS NOT NULL AND mint != ''
                GROUP BY mint 
                ORDER BY count DESC, mint
            `)
        ]);

        const result = {
            countries: countriesResult.rows.map(row => row.country),
            metals: metalsResult.rows.map(row => row.metal),
            rarities: raritiesResult.rows.map(row => row.rarity),
            conditions: conditionsResult.rows.map(row => row.condition),
            mints: mintsResult.rows.map(row => row.mint)
        };

        console.log('🔍 Результат всех фильтров:', result);
        res.json(result);
    } catch (error) {
        console.error('Ошибка получения фильтров:', error);
        res.status(500).json({ error: 'Ошибка получения фильтров' });
    }
});

// Get coins with filters and pagination
app.get('/api/catalog/coins', async (req, res) => {
    try {
        const { 
            page = 1, 
            limit = 20, 
            country, 
            year, 
            metal, 
            search,
            sortBy = 'id',
            sortOrder = 'DESC'
        } = req.query;

        let whereConditions = [];
        let queryParams = [];
        let paramIndex = 1;

        if (country) {
            whereConditions.push(`country = $${paramIndex++}`);
            queryParams.push(country);
        }

        if (year) {
            whereConditions.push(`year = $${paramIndex++}`);
            queryParams.push(parseInt(year));
        }

        if (metal) {
            whereConditions.push(`metal = $${paramIndex++}`);
            queryParams.push(metal);
        }

        if (search) {
            whereConditions.push(`(coin_name ILIKE $${paramIndex} OR denomination ILIKE $${paramIndex})`);
            queryParams.push(`%${search}%`);
            paramIndex++;
        }

        const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';
        
        const offset = (parseInt(page) - 1) * parseInt(limit);
        
        const countQuery = `SELECT COUNT(*) FROM coin_catalog ${whereClause}`;
        const countResult = await pool.query(countQuery, queryParams);
        const total = parseInt(countResult.rows[0].count);

        const dataQuery = `
            SELECT 
                id, coin_name, denomination, year, metal, country,
                coin_weight, fineness, pure_metal_weight,
                bitkin_info, uzdenikov_info, ilyin_info, petrov_info,
                avers_image_data, revers_image_data
            FROM coin_catalog 
            ${whereClause}
            ORDER BY ${sortBy} ${sortOrder}
            LIMIT $${paramIndex++} OFFSET $${paramIndex++}
        `;
        
        queryParams.push(parseInt(limit), offset);
        const result = await pool.query(dataQuery, queryParams);

        res.json({
            coins: result.rows,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('Ошибка получения монет:', error);
        res.status(500).json({ error: 'Ошибка получения монет' });
    }
});

// Get single coin details
app.get('/api/catalog/coins/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(`
            SELECT * FROM coin_catalog WHERE id = $1
        `, [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Монета не найдена' });
        }
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Ошибка получения монеты:', error);
        res.status(500).json({ error: 'Ошибка получения монеты' });
    }
});

// Get coin image
app.get('/api/catalog/coins/:coin_id/image/:type', async (req, res) => {
    try {
        const { coin_id, type } = req.params;
        
        if (!['avers', 'revers'].includes(type)) {
            return res.status(400).json({ error: 'Неверный тип изображения' });
        }
        
        const imageField = type === 'avers' ? 'avers_image_data' : 'revers_image_data';
        const result = await pool.query(`
            SELECT ${imageField} FROM coin_catalog WHERE id = $1
        `, [coin_id]);
        
        if (result.rows.length === 0 || !result.rows[0][imageField]) {
            return res.status(404).json({ error: 'Изображение не найдено' });
        }
        
        const imageData = result.rows[0][imageField];
        res.setHeader('Content-Type', 'image/jpeg');
        res.send(imageData);
    } catch (error) {
        console.error('Ошибка получения изображения:', error);
        res.status(500).json({ error: 'Ошибка получения изображения' });
    }
});

// ==================== AUTH API ====================

// User registration
app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, email, password, fullName } = req.body;
        const result = await authService.register(username, password, email, fullName);
        res.json(result);
    } catch (error) {
        console.error('Ошибка регистрации:', error);
        res.status(400).json({ error: error.message });
    }
});

// User login
app.post('/api/auth/login', async (req, res) => {
    try {
        console.log('🔐 Запрос входа:', req.body);
        const { username, password } = req.body;
        console.log('🔐 Параметры входа:', { username, password: password ? '***' : 'undefined' });
        
        const result = await authService.login(username, password);
        console.log('🔐 Результат входа:', result);
        res.json(result);
    } catch (error) {
        console.error('❌ Ошибка входа:', error);
        res.status(401).json({ error: error.message });
    }
});

// Get user profile
app.get('/api/auth/profile', authenticateToken, async (req, res) => {
    try {
        res.json({ user: req.user });
    } catch (error) {
        console.error('Ошибка получения профиля:', error);
        res.status(500).json({ error: 'Ошибка получения профиля' });
    }
});

// ==================== COLLECTION API ====================

// Get user collection
app.get('/api/collection', authenticateToken, async (req, res) => {
    try {
        console.log('📚 Запрос коллекции для пользователя:', req.user);
        console.log('🆔 ID пользователя:', req.user.id);
        const { page = 1, limit = 20, ...filters } = req.query;
        const result = await collectionService.getUserCollection(
            req.user.id, 
            parseInt(page), 
            parseInt(limit), 
            filters
        );
        console.log('📚 Результат коллекции:', result);
        res.json(result);
    } catch (error) {
        console.error('Ошибка получения коллекции:', error);
        res.status(500).json({ error: 'Ошибка получения коллекции' });
    }
});

// Add coin to collection
app.post('/api/collection/add', authenticateToken, async (req, res) => {
    try {
        const { coinId, notes, conditionRating, purchasePrice, purchaseDate } = req.body;

        if (!coinId) {
            return res.status(400).json({ error: 'ID монеты обязателен' });
        }

        const result = await collectionService.addToCollection(
            req.user.id,
            parseInt(coinId),
            notes,
            conditionRating,
            purchasePrice,
            purchaseDate
        );
        
        res.json(result);
    } catch (error) {
        console.error('Ошибка добавления в коллекцию:', error);
        res.status(400).json({ error: error.message });
    }
});

// Remove coin from collection
app.delete('/api/collection/remove', authenticateToken, async (req, res) => {
    try {
        const { coinId } = req.body;

        if (!coinId) {
            return res.status(400).json({ error: 'ID монеты обязателен' });
        }

        await collectionService.removeFromCollection(req.user.id, parseInt(coinId));
        res.json({ success: true });
    } catch (error) {
        console.error('Ошибка удаления из коллекции:', error);
        res.status(400).json({ error: error.message });
    }
});

// Update collection item
app.put('/api/collection/update', authenticateToken, async (req, res) => {
    try {
        const { coinId, ...updates } = req.body;

        if (!coinId) {
            return res.status(400).json({ error: 'ID монеты обязателен' });
        }

        const result = await collectionService.updateCollectionItem(
            req.user.id,
            parseInt(coinId),
            updates
        );
        
        res.json(result);
    } catch (error) {
        console.error('Ошибка обновления коллекции:', error);
        res.status(400).json({ error: error.message });
    }
});

// Check if coin is in collection
app.get('/api/collection/check/:coinId', authenticateToken, async (req, res) => {
    try {
        const { coinId } = req.params;
        const isInCollection = await collectionService.isInCollection(req.user.id, parseInt(coinId));
        res.json({ isInCollection });
    } catch (error) {
        console.error('Ошибка проверки коллекции:', error);
        res.status(500).json({ error: 'Ошибка проверки коллекции' });
    }
});

// Get collection stats
app.get('/api/collection/stats', authenticateToken, async (req, res) => {
    try {
        const stats = await collectionService.getCollectionStats(req.user.id);
        res.json(stats);
    } catch (error) {
        console.error('Ошибка получения статистики:', error);
        res.status(500).json({ error: 'Ошибка получения статистики' });
    }
});

// Recalculate collection prices
app.post('/api/collection/recalculate-prices', authenticateToken, async (req, res) => {
    try {
        console.log(`🔄 Пересчет прогнозных цен для пользователя ${req.user.id}`);
        
        if (!collectionPriceService.calibrationTable) {
            await collectionPriceService.init();
        }
        
        const result = await collectionPriceService.recalculateUserCollectionPrices(req.user.id);
        res.json(result);
    } catch (error) {
        console.error('Ошибка пересчета прогнозных цен:', error);
        res.status(500).json({ error: 'Ошибка пересчета прогнозных цен' });
    }
});

// Get collection total value
app.get('/api/collection/total-value', authenticateToken, async (req, res) => {
    try {
        const totalValue = await collectionPriceService.getCollectionTotalValue(req.user.id);
        res.json(totalValue);
    } catch (error) {
        console.error('Ошибка получения суммарной стоимости:', error);
        res.status(500).json({ error: 'Ошибка получения суммарной стоимости' });
    }
});

// Update watchlist lot data (bids and predictions)
app.post('/api/watchlist/update-lots', authenticateToken, async (req, res) => {
    try {
        console.log(`🔄 Обновление данных лотов из избранного для пользователя ${req.user.id}`);
        
        const { lotIds } = req.body;
        if (!lotIds || !Array.isArray(lotIds)) {
            return res.status(400).json({ error: 'Необходимо указать массив ID лотов' });
        }
        
        console.log(`📊 Обрабатываем ${lotIds.length} лотов из избранного`);
        
        const results = {
            updatedBids: 0,
            updatedPredictions: 0,
            errors: []
        };
        
        // Обновляем ставки для каждого лота
        for (const lotId of lotIds) {
            try {
                // Получаем информацию о лоте
                const lotResult = await pool.query(`
                    SELECT lot_number, auction_number, source_url 
                    FROM auction_lots 
                    WHERE id = $1
                `, [lotId]);
                
                if (lotResult.rows.length === 0) {
                    results.errors.push(`Лот ${lotId} не найден`);
                    continue;
                }
                
                const lot = lotResult.rows[0];
                
                // Парсим ставку для конкретного лота
                const bidData = await parseSingleLotBid(lot.source_url);
                if (bidData) {
                    // Обновляем ставку в базе данных
                    const updateResult = await pool.query(`
                        UPDATE auction_lots 
                        SET winning_bid = $1, 
                            winner_login = $2
                        WHERE id = $3
                    `, [bidData.winningBid, bidData.winnerLogin, lotId]);
                    
                    if (updateResult.rowCount > 0) {
                        results.updatedBids++;
                        console.log(`✅ Обновлена ставка для лота ${lot.lot_number}: ${bidData.winningBid}₽ (${bidData.winnerLogin})`);
                    } else {
                        results.errors.push(`Не удалось обновить лот ${lot.lot_number}`);
                    }
                } else {
                    results.errors.push(`Не удалось получить данные для лота ${lot.lot_number}`);
                }
                
            } catch (error) {
                console.error(`❌ Ошибка обновления лота ${lotId}:`, error);
                results.errors.push(`Ошибка обновления лота ${lotId}: ${error.message}`);
            }
        }
        
        // Пересчитываем прогнозные цены для лотов из избранного
        try {
            if (!collectionPriceService.calibrationTable) {
                await collectionPriceService.init();
            }
            
            // Пересчитываем прогнозы для конкретных лотов из избранного
            const predictionResult = await collectionPriceService.recalculateLotPredictions(lotIds);
            results.updatedPredictions = predictionResult.updated || 0;
            
        } catch (error) {
            console.error('❌ Ошибка пересчета прогнозных цен:', error);
            results.errors.push(`Ошибка пересчета прогнозов: ${error.message}`);
        }
        
        res.json({
            success: true,
            message: 'Данные лотов обновлены',
            results
        });
        
    } catch (error) {
        console.error('Ошибка обновления лотов из избранного:', error);
        res.status(500).json({ error: 'Ошибка обновления лотов из избранного' });
    }
});

// Get coin predicted price
app.get('/api/collection/coin/:coinId/predicted-price', authenticateToken, async (req, res) => {
    try {
        const { coinId } = req.params;
        const predictedPrice = await collectionPriceService.getCoinPredictedPrice(req.user.id, parseInt(coinId));
        
        if (!predictedPrice) {
            return res.status(404).json({ error: 'Прогнозная цена не найдена' });
        }
        
        res.json(predictedPrice);
    } catch (error) {
        console.error('Ошибка получения прогнозной цены:', error);
        res.status(500).json({ error: 'Ошибка получения прогнозной цены' });
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
        // Определяем номер текущего аукциона
        const currentAuctionNumber = await getCurrentAuctionNumber(pool);
        
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

// ==================== АДМИНИСТРАТИВНЫЕ МАРШРУТЫ ====================

// API для запуска основного парсера
app.post('/api/admin/start-main-parser', async (req, res) => {
    try {
        const { auctionNumber, mode, resumeLot } = req.body;
        
        if (!auctionNumber) {
            return res.status(400).json({ error: 'Номер аукциона обязателен' });
        }

        const result = await adminFunctions.startMainParser(auctionNumber, mode, resumeLot);
        res.json(result);
    } catch (error) {
        console.error('Ошибка запуска основного парсера:', error);
        res.status(500).json({ error: error.message });
    }
});

// API для остановки основного парсера
app.post('/api/admin/stop-main-parser', async (req, res) => {
    try {
        const result = await adminFunctions.stopMainParser();
        res.json(result);
    } catch (error) {
        console.error('Ошибка остановки основного парсера:', error);
        res.status(500).json({ error: error.message });
    }
});

// API для запуска парсера обновлений
app.post('/api/admin/start-update-parser', async (req, res) => {
    try {
        const { auctionNumber } = req.body;
        
        if (!auctionNumber) {
            return res.status(400).json({ error: 'Номер аукциона обязателен' });
        }

        const result = await adminFunctions.startUpdateParser(auctionNumber);
        res.json(result);
    } catch (error) {
        console.error('Ошибка запуска парсера обновлений:', error);
        res.status(500).json({ error: error.message });
    }
});

// API для остановки парсера обновлений
app.post('/api/admin/stop-update-parser', async (req, res) => {
    try {
        const result = await adminFunctions.stopUpdateParser();
        res.json(result);
    } catch (error) {
        console.error('Ошибка остановки парсера обновлений:', error);
        res.status(500).json({ error: error.message });
    }
});

// API для управления расписанием
app.post('/api/admin/schedule', async (req, res) => {
    try {
        const { time, auctionNumber } = req.body;
        
        if (!time || !auctionNumber) {
            return res.status(400).json({ error: 'Время и номер аукциона обязательны' });
        }

        const result = adminFunctions.setSchedule(time, auctionNumber);
        res.json(result);
    } catch (error) {
        console.error('Ошибка установки расписания:', error);
        res.status(500).json({ error: error.message });
    }
});

// API для удаления расписания
app.delete('/api/admin/schedule', async (req, res) => {
    try {
        const result = adminFunctions.deleteSchedule();
        res.json(result);
    } catch (error) {
        console.error('Ошибка удаления расписания:', error);
        res.status(500).json({ error: error.message });
    }
});

// API для получения логов
app.get('/api/admin/logs/:type', (req, res) => {
    try {
        const { type } = req.params;
        const logs = adminFunctions.readLogs(type, 100);
        res.json({ logs });
    } catch (error) {
        console.error('Ошибка получения логов:', error);
        res.status(500).json({ error: 'Ошибка получения логов' });
    }
});

// API для очистки логов
app.post('/api/admin/logs/clear', (req, res) => {
    try {
        adminFunctions.clearLogs('main');
        adminFunctions.clearLogs('update');
        adminFunctions.clearLogs('predictions');
        
        // Также очищаем логи парсера каталога
        const fs = require('fs');
        const path = require('path');
        
        // Очищаем файлы логов парсера каталога
        const catalogLogs = [
            'catalog-activity.log',
            'catalog-errors.log'
        ];
        
        for (const logFile of catalogLogs) {
            const logPath = path.join(process.cwd(), logFile);
            if (fs.existsSync(logPath)) {
                fs.writeFileSync(logPath, '');
            }
        }
        
        res.json({ success: true, message: 'Все логи очищены (включая логи парсера каталога)' });
    } catch (error) {
        console.error('Ошибка очистки логов:', error);
        res.status(500).json({ error: 'Ошибка очистки логов' });
    }
});

// API для получения прогресса парсера обновления
app.get('/api/admin/update-progress/:auctionNumber', (req, res) => {
    try {
        const { auctionNumber } = req.params;
        const progress = adminFunctions.getUpdateProgress(parseInt(auctionNumber));
        res.json({ progress });
    } catch (error) {
        console.error('Ошибка получения прогресса:', error);
        res.status(500).json({ error: 'Ошибка получения прогресса' });
    }
});

// API для очистки прогресса парсера обновления
app.post('/api/admin/clear-update-progress/:auctionNumber', (req, res) => {
    try {
        const { auctionNumber } = req.params;
        const result = adminFunctions.clearUpdateProgress(parseInt(auctionNumber));
        res.json(result);
    } catch (error) {
        console.error('Ошибка очистки прогресса:', error);
        res.status(500).json({ error: 'Ошибка очистки прогресса' });
    }
});

// API для запуска генерации прогнозов
app.post('/api/admin/start-predictions', async (req, res) => {
    try {
        const { auctionNumber, startFromIndex } = req.body;
        
        if (!auctionNumber) {
            return res.status(400).json({ error: 'Номер аукциона обязателен' });
        }

        const result = await adminFunctions.startPredictionsGenerator(auctionNumber, startFromIndex);
        res.json(result);
    } catch (error) {
        console.error('Ошибка запуска генерации прогнозов:', error);
        res.status(500).json({ error: error.message });
    }
});

// API для остановки генерации прогнозов
app.post('/api/admin/stop-predictions', async (req, res) => {
    try {
        const result = await adminFunctions.stopPredictionsGenerator();
        res.json(result);
    } catch (error) {
        console.error('Ошибка остановки генерации прогнозов:', error);
        res.status(500).json({ error: error.message });
    }
});

// API для получения прогресса генерации прогнозов
app.get('/api/admin/predictions-progress/:auctionNumber', (req, res) => {
    try {
        const { auctionNumber } = req.params;
        const progress = adminFunctions.getPredictionsProgress(parseInt(auctionNumber));
        res.json({ progress });
    } catch (error) {
        console.error('Ошибка получения прогресса прогнозов:', error);
        res.status(500).json({ error: 'Ошибка получения прогресса прогнозов' });
    }
});

// API для очистки прогресса генерации прогнозов
app.post('/api/admin/clear-predictions-progress/:auctionNumber', (req, res) => {
    try {
        const { auctionNumber } = req.params;
        const result = adminFunctions.clearPredictionsProgress(parseInt(auctionNumber));
        res.json(result);
    } catch (error) {
        console.error('Ошибка очистки прогресса прогнозов:', error);
        res.status(500).json({ error: 'Ошибка очистки прогресса прогнозов' });
    }
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Получен сигнал завершения, закрываем соединения...');
    await pool.end();
    process.exit(0);
});

module.exports = app;

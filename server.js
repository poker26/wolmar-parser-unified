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
const WolmarCategoryParser = require('./wolmar-category-parser');

// Функция для парсинга ставки одного лота (точная копия логики из update-current-auction.js)
async function parseSingleLotBid(lotUrl) {
    const { launchPuppeteer, createPage, cleanupChromeTempFiles } = require('./puppeteer-utils');
    
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
        // Очищаем временные файлы Chrome
        cleanupChromeTempFiles();
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

console.log('🚀 Сервер запускается на порту', PORT);

// Middleware
app.use(cors());
app.use(express.json());

// Блокировка сканирования чувствительных файлов (.env, config и т.п.)
app.use((req, res, next) => {
    const pathLower = req.path.toLowerCase();
    if (pathLower.includes('.env') || pathLower.includes('config') && pathLower.endsWith('.js') ||
        /\.(env|bak|backup|old|orig|swp)$/i.test(pathLower)) {
        return res.status(404).end();
    }
    next();
});

// Логирование всех входящих запросов
app.use((req, res, next) => {
    console.log(`📥 ${req.method} ${req.path} - ${new Date().toISOString()}`);
    next();
});

// Middleware для проверки аутентификации
const authenticateToken = async (req, res, next) => {
    console.log(`🔐 Проверка аутентификации для ${req.method} ${req.path}`);
    const authHeader = req.headers['authorization'];
    console.log(`🔐 Authorization header:`, authHeader);
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
    console.log(`🔐 Извлеченный токен:`, token ? 'есть' : 'отсутствует');

    if (!token) {
        console.log('❌ Токен не предоставлен');
        return res.status(403).json({ error: 'Токен доступа не предоставлен' });
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
        res.status(403).json({ error: error.message });
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

// Category Parser API endpoints
// Запуск парсера по категориям
app.post('/api/admin/category-parser/start', async (req, res) => {
    try {
        const { mode, auctionNumber, startFromLot, updateCategories, updateBids } = req.body;
        
        console.log('🚀 Запуск Category Parser через PM2:', { mode, auctionNumber, startFromLot, updateCategories, updateBids });
        
        // Сначала останавливаем предыдущий процесс если он запущен
        const { exec } = require('child_process');
        
        // Останавливаем все процессы category-parser
        exec('pm2 stop category-parser', (stopError) => {
            if (stopError) {
                console.log('⚠️ Предыдущий процесс не найден или уже остановлен');
            } else {
                console.log('✅ Предыдущий процесс остановлен');
            }
            
            // Формируем команду для запуска
            let command = `node wolmar-category-parser.js ${mode} ${auctionNumber}`;
            if (updateBids) {
                command += ' --include-bids';
            }
            if (startFromLot && mode === 'resume') {
                command += ` --from-lot ${startFromLot}`;
            }
            
            console.log(`🚀 Запускаем команду: ${command}`);
            
            // Запускаем через PM2
            const pm2Command = `pm2 start wolmar-category-parser.js --name "category-parser" -- ${mode} ${auctionNumber}${updateBids ? ' --include-bids' : ''}${startFromLot && mode === 'resume' ? ` --from-lot ${startFromLot}` : ''}`;
            
            exec(pm2Command, (error, stdout, stderr) => {
                if (error) {
                    console.error('❌ Ошибка запуска через PM2:', error.message);
                    return res.status(500).json({ 
                        success: false,
                        error: 'Ошибка запуска через PM2: ' + error.message 
                    });
                }
                
                console.log('✅ Category Parser запущен через PM2');
                console.log('PM2 stdout:', stdout);
                if (stderr) console.log('PM2 stderr:', stderr);
                
                res.json({ 
                    success: true,
                    message: 'Category Parser запущен через PM2',
                    output: stdout
                });
            });
        });
        
    } catch (error) {
        console.error('❌ Ошибка запуска Category Parser:', error.message);
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
});

// Остановка парсера
app.post('/api/admin/category-parser/stop', async (req, res) => {
    try {
        console.log('⏹️ Останавливаем Category Parser через PM2...');
        
        const { exec } = require('child_process');
        
        exec('pm2 stop category-parser', (error, stdout, stderr) => {
            if (error) {
                console.error('❌ Ошибка остановки через PM2:', error.message);
                return res.status(500).json({ 
                    success: false,
                    error: 'Ошибка остановки через PM2: ' + error.message 
                });
            }
            
            console.log('✅ Category Parser остановлен через PM2');
            console.log('PM2 stdout:', stdout);
            if (stderr) console.log('PM2 stderr:', stderr);
            
            res.json({ 
                success: true,
                message: 'Category Parser остановлен через PM2',
                output: stdout
            });
        });
        
    } catch (error) {
        console.error('❌ Ошибка остановки Category Parser:', error.message);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Получение статуса парсера
app.get('/api/admin/category-parser/status', async (req, res) => {
    try {
        console.log('📊 Запрос статуса Category Parser через PM2...');
        
        const { exec } = require('child_process');
        
        // Проверяем статус через PM2
        exec('pm2 jlist', (error, stdout, stderr) => {
            if (error) {
                console.error('❌ Ошибка получения статуса PM2:', error.message);
                return res.status(500).json({ 
                    success: false,
                    error: 'Ошибка получения статуса PM2: ' + error.message 
                });
            }
            
            try {
                const pm2Processes = JSON.parse(stdout);
                const categoryParserProcess = pm2Processes.find(proc => proc.name === 'category-parser');
                
                if (categoryParserProcess) {
                    console.log('✅ Category Parser найден в PM2:', categoryParserProcess.pm2_env.status);
                    
                    // Читаем прогресс из файла
                    const fs = require('fs');
                    const path = require('path');
                    const progressFile = path.join(__dirname, 'logs', 'category-parser-progress.json');
                    
                    let progressData = null;
                    try {
                        if (fs.existsSync(progressFile)) {
                            const progressContent = fs.readFileSync(progressFile, 'utf8');
                            progressData = JSON.parse(progressContent);
                        }
                    } catch (progressError) {
                        console.log('⚠️ Не удалось прочитать файл прогресса:', progressError.message);
                    }
                    
                    res.json({
                        running: true,
                        status: categoryParserProcess.pm2_env.status,
                        message: `Category Parser ${categoryParserProcess.pm2_env.status} (PM2 ID: ${categoryParserProcess.pm_id})`,
                        pid: categoryParserProcess.pid,
                        startTime: new Date(categoryParserProcess.pm2_env.created_at).toISOString(),
                        uptime: categoryParserProcess.pm2_env.uptime,
                        memory: categoryParserProcess.monit.memory,
                        cpu: categoryParserProcess.monit.cpu,
                        progress: progressData
                    });
                } else {
                    console.log('⚠️ Category Parser не найден в PM2');
                    res.json({
                        running: false,
                        status: 'stopped',
                        message: 'Category Parser не запущен'
                    });
                }
            } catch (parseError) {
                console.error('❌ Ошибка парсинга PM2 output:', parseError.message);
                res.status(500).json({ 
                    success: false,
                    error: 'Ошибка парсинга PM2 output: ' + parseError.message 
                });
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения статуса Category Parser:', error.message);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Возобновление парсинга
app.post('/api/admin/category-parser/resume', async (req, res) => {
    try {
        const { category, auctionNumber, startFromLot, delayBetweenLots, skipExisting } = req.body;
        
        console.log('🔄 Возобновление Category Parser:', { category, auctionNumber, startFromLot });
        
        if (!categoryParser) {
            // Создаем новый экземпляр если парсер не запущен
            const mode = auctionNumber ? 'auction' : 'categories';
            categoryParser = new WolmarCategoryParser(config.dbConfig, mode, auctionNumber);
            await categoryParser.init();
        }
        
        const result = await categoryParser.resumeParsing({
            category,
            auctionNumber,
            startFromLot: startFromLot || 1,
            delayBetweenLots: delayBetweenLots || 800,
            skipExisting: skipExisting !== false
        });
        
        res.json({ 
            success: true, 
            message: 'Парсинг возобновлен успешно',
            result: result
        });
        
    } catch (error) {
        console.error('❌ Ошибка возобновления Category Parser:', error.message);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Получение списка категорий с прогрессом
app.get('/api/admin/category-parser/categories', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                category,
                COUNT(*) as total_lots,
                COUNT(CASE WHEN source_category IS NOT NULL THEN 1 END) as processed_lots
            FROM auction_lots 
            WHERE category IS NOT NULL AND category != ''
            GROUP BY category 
            ORDER BY total_lots DESC
        `);
        
        res.json(result.rows);
        
    } catch (error) {
        console.error('❌ Ошибка получения списка категорий:', error.message);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ==================== WATCHLIST API ====================

// Get user watchlist
app.get('/api/watchlist', authenticateToken, async (req, res) => {
    try {
        console.log(`📚 Запрос избранного для пользователя ${req.user.id}`);
        
        const result = await pool.query(`
            SELECT 
                w.id as watchlist_id,
                w.added_at,
                al.id,
                al.lot_number,
                al.auction_number,
                al.coin_description,
                al.winning_bid,
                al.auction_end_date,
                al.bids_count,
                al.lot_status,
                al.metal,
                al.condition,
                al.weight,
                al.year,
                al.avers_image_url,
                al.revers_image_url,
                al.winner_login,
                al.category,
                lb.bid_amount as current_bid_amount,
                lb.bidder_login as current_bidder,
                lb.bid_timestamp as current_bid_timestamp,
                lb.is_auto_bid as current_bid_is_auto,
                ub.bid_amount as user_bid_amount,
                ub.bid_timestamp as user_bid_timestamp,
                ub.is_auto_bid as user_bid_is_auto
            FROM watchlist w
            JOIN auction_lots al ON w.lot_id = al.id
            LEFT JOIN LATERAL (
                SELECT bid_amount, bidder_login, bid_timestamp, is_auto_bid
                FROM lot_bids 
                WHERE lot_id = al.id 
                ORDER BY bid_timestamp DESC 
                LIMIT 1
            ) lb ON true
            LEFT JOIN LATERAL (
                SELECT bid_amount, bid_timestamp, is_auto_bid
                FROM lot_bids 
                WHERE lot_id = al.id AND bidder_login = $2
                ORDER BY bid_timestamp DESC 
                LIMIT 1
            ) ub ON true
            WHERE w.user_id = $1
            ORDER BY w.added_at DESC
        `, [req.user.id, req.user.username]);
        
        console.log(`📚 Найдено ${result.rows.length} лотов в избранном`);
        res.json({ lots: result.rows });
        
    } catch (error) {
        console.error('Ошибка получения избранного:', error);
        res.status(500).json({ error: 'Ошибка получения избранного' });
    }
});

// Add lot to watchlist
app.post('/api/watchlist', authenticateToken, async (req, res) => {
    try {
        const { lotId } = req.body;
        
        if (!lotId) {
            return res.status(400).json({ error: 'Необходимо указать ID лота' });
        }
        
        console.log(`⭐ Добавление лота ${lotId} в избранное пользователя ${req.user.id}`);
        
        // Проверяем, существует ли лот
        const lotExists = await pool.query(`
            SELECT id FROM auction_lots WHERE id = $1
        `, [lotId]);
        
        if (lotExists.rows.length === 0) {
            return res.status(404).json({ error: 'Лот не найден' });
        }
        
        // Добавляем в избранное (ON CONFLICT DO NOTHING для избежания дубликатов)
        const result = await pool.query(`
            INSERT INTO watchlist (user_id, lot_id)
            VALUES ($1, $2)
            ON CONFLICT (user_id, lot_id) DO NOTHING
            RETURNING id
        `, [req.user.id, lotId]);
        
        if (result.rows.length > 0) {
            console.log(`✅ Лот ${lotId} добавлен в избранное`);
            res.json({ message: 'Лот добавлен в избранное', added: true });
        } else {
            console.log(`ℹ️ Лот ${lotId} уже в избранном`);
            res.json({ message: 'Лот уже в избранном', added: false });
        }
        
    } catch (error) {
        console.error('Ошибка добавления в избранное:', error);
        res.status(500).json({ error: 'Ошибка добавления в избранное' });
    }
});

// Remove lot from watchlist
app.delete('/api/watchlist/:lotId', authenticateToken, async (req, res) => {
    try {
        const { lotId } = req.params;
        
        console.log(`🗑️ Удаление лота ${lotId} из избранного пользователя ${req.user.id}`);
        
        const result = await pool.query(`
            DELETE FROM watchlist 
            WHERE user_id = $1 AND lot_id = $2
        `, [req.user.id, lotId]);
        
        if (result.rowCount > 0) {
            console.log(`✅ Лот ${lotId} удален из избранного`);
            res.json({ message: 'Лот удален из избранного', removed: true });
        } else {
            console.log(`ℹ️ Лот ${lotId} не найден в избранном`);
            res.json({ message: 'Лот не найден в избранном', removed: false });
        }
        
    } catch (error) {
        console.error('Ошибка удаления из избранного:', error);
        res.status(500).json({ error: 'Ошибка удаления из избранного' });
    }
});

// Check if lot is in watchlist
app.get('/api/watchlist/check/:lotId', authenticateToken, async (req, res) => {
    try {
        const { lotId } = req.params;
        
        const result = await pool.query(`
            SELECT id FROM watchlist 
            WHERE user_id = $1 AND lot_id = $2
        `, [req.user.id, lotId]);
        
        res.json({ inWatchlist: result.rows.length > 0 });
        
    } catch (error) {
        console.error('Ошибка проверки избранного:', error);
        res.status(500).json({ error: 'Ошибка проверки избранного' });
    }
});

// app.use(express.static(path.join(__dirname, 'public'))); // ПЕРЕМЕЩЕНО В КОНЕЦ

// Database connection
const pool = new Pool(config.dbConfig);

// Category Parser instance
let categoryParser = null;

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
                MIN(parsing_number) as parsing_number,
                MIN(auction_end_date) as start_date,
                MAX(auction_end_date) as end_date,
                COUNT(*) as lots_count,
                SUM(winning_bid) as total_value,
                AVG(winning_bid) as avg_bid,
                MAX(winning_bid) as max_price,
                MIN(winning_bid) as min_price,
                COUNT(CASE WHEN category IS NOT NULL AND category != '' THEN 1 END) as lots_with_categories,
                COUNT(DISTINCT category) as categories_count,
                bool_or(source_url ILIKE '%wolmar.ru%') as is_wolmar
            FROM auction_lots
            WHERE auction_number IS NOT NULL
            GROUP BY auction_number
            ORDER BY auction_number DESC
        `;
        
        const result = await pool.query(query);

        // Категории по всем аукционам ОДНИМ запросом (раньше было N+1: отдельный
        // запрос на каждый аукцион через Promise.all → при 78 аукционах пул
        // соединений исчерпывался и запрос падал с connection timeout).
        const categoriesResult = await pool.query(`
            SELECT auction_number, category, COUNT(*) as lots_count
            FROM auction_lots
            WHERE auction_number IS NOT NULL
              AND category IS NOT NULL
              AND category != ''
            GROUP BY auction_number, category
            ORDER BY auction_number, lots_count DESC
        `);

        const categoriesByAuction = {};
        for (const row of categoriesResult.rows) {
            (categoriesByAuction[row.auction_number] ||= []).push({
                category: row.category,
                lots_count: row.lots_count
            });
        }

        const auctionsWithCategories = result.rows.map((auction) => {
            auction.categories = categoriesByAuction[auction.auction_number] || [];
            return auction;
        });

        res.json(auctionsWithCategories);
    } catch (error) {
        console.error('Ошибка получения списка аукционов:', error);
        res.status(500).json({ error: 'Ошибка получения списка аукционов' });
    }
});

// API route for auction lots
app.get('/api/auctions/:auctionNumber/lots', async (req, res) => {
    try {
        const { auctionNumber } = req.params;
        const { page = 1, limit = 20, search, metal, condition, category, year, minPrice, maxPrice } = req.query;
        
        console.log(`🔍 API запрос лотов аукциона ${auctionNumber}:`, { page, limit, search, metal, condition, category, year, minPrice, maxPrice });
        
        let query = `
            SELECT 
                id, lot_number, auction_number, coin_description,
                winning_bid, auction_end_date, bids_count, lot_status,
                metal, condition, weight, year,
                avers_image_url, revers_image_url,
                winner_login, category
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
        
        if (category) {
            console.log(`🔍 Фильтрация по категории: "${category}"`);
            query += ` AND category = $${paramIndex}`;
            params.push(category);
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
        
        // Диагностика: проверяем, что возвращает запрос
        if (result.rows.length > 0) {
            console.log(`🔍 Первый лот из результата:`, {
                lot_number: result.rows[0].lot_number,
                avers_image_url: result.rows[0].avers_image_url,
                revers_image_url: result.rows[0].revers_image_url,
                category: result.rows[0].category
            });
        }
        
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
        
        if (category) {
            countQuery += ` AND category = $${countParamIndex}`;
            countParams.push(category);
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
        
        // Получаем металлы, состояния и годы (только для лотов с металлом)
        let metalQuery = `
            SELECT DISTINCT metal, condition, year
            FROM auction_lots 
            WHERE metal IS NOT NULL AND metal != ''
        `;
        
        const metalParams = [];
        if (auctionNumber) {
            metalQuery += ` AND auction_number = $1`;
            metalParams.push(auctionNumber);
        }
        
        const metalResult = await pool.query(metalQuery, metalParams);
        const metals = [...new Set(metalResult.rows.map(row => row.metal).filter(Boolean))];
        const conditions = [...new Set(metalResult.rows.map(row => row.condition).filter(Boolean))];
        const years = [...new Set(metalResult.rows.map(row => row.year).filter(Boolean))].sort((a, b) => b - a);
        
        // Получаем все категории из таблицы wolmar_categories
        let categories = [];
        try {
            const categoryQuery = 'SELECT name FROM wolmar_categories ORDER BY name';
            const categoryResult = await pool.query(categoryQuery);
            categories = categoryResult.rows.map(row => row.name);
            console.log(`📋 Загружено ${categories.length} категорий из wolmar_categories`);
        } catch (error) {
            console.error('❌ Ошибка загрузки категорий из wolmar_categories:', error);
            // Fallback: получаем категории из auction_lots
            let fallbackQuery = `
                SELECT DISTINCT category
                FROM auction_lots 
                WHERE category IS NOT NULL AND category != ''
            `;
            
            const fallbackParams = [];
            if (auctionNumber) {
                fallbackQuery += ` AND auction_number = $1`;
                fallbackParams.push(auctionNumber);
            }
            
            const fallbackResult = await pool.query(fallbackQuery, fallbackParams);
            categories = [...new Set(fallbackResult.rows.map(row => row.category).filter(Boolean))];
            console.log(`📋 Fallback: загружено ${categories.length} категорий из auction_lots`);
        }
        
        res.json({
            metals,
            conditions,
            years,
            categories
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
        const { page = 1, limit = 20, search, metal, condition, category, year, minPrice, maxPrice } = req.query;
        
        let query = `
            SELECT 
                id, lot_number, coin_description, 
                avers_image_url, revers_image_url,
                winner_login, winning_bid, auction_end_date,
                bids_count, lot_status, year, letters, metal, condition, weight,
                parsed_at, source_url, auction_number, category
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
        
        if (category) {
            query += ` AND category = $${paramIndex}`;
            queryParams.push(category);
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
        
        if (category) {
            countQuery += ` AND category = $${countParamIndex}`;
            countParams.push(category);
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

// ============================================
// API для управления пользователями
// ============================================

// Получить список всех пользователей (победители + участники)
app.get('/api/users', async (req, res) => {
    try {
        const {
            page = 1,
            limit = 50,
            status, // 'all', 'winners', 'participants'
            risk_level, // 'all', 'critical', 'high', 'medium', 'low', 'normal'
            rating_category, // 'all', 'vip', 'premium', 'standard', 'basic', 'newbie'
            search,
            sort_by = 'suspicious_score',
            sort_order = 'DESC'
        } = req.query;
        
        const offset = (parseInt(page) - 1) * parseInt(limit);
        const validSortFields = ['suspicious_score', 'rating', 'total_spent', 'total_lots', 'total_bids', 'last_activity', 'login'];
        const sortField = validSortFields.includes(sort_by) ? sort_by : 'suspicious_score';
        const sortDirection = sort_order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
        
        // Строим запрос для получения всех пользователей
        let query = `
            WITH all_users AS (
                SELECT DISTINCT bidder_login as login FROM lot_bids WHERE bidder_login IS NOT NULL AND bidder_login != ''
                UNION
                SELECT DISTINCT winner_login as login FROM auction_lots WHERE winner_login IS NOT NULL AND winner_login != ''
            ),
            user_stats AS (
                SELECT 
                    u.login,
                    -- Статус
                    CASE WHEN w.winner_login IS NOT NULL THEN 'Победитель' ELSE 'Участник' END as status,
                    -- Финансовая статистика (только для победителей)
                    COALESCE(w.total_lots, 0) as total_lots,
                    COALESCE(w.total_spent, 0) as total_spent,
                    wr.rating,
                    wr.category,
                    -- Риск-профиль
                    COALESCE(wr.suspicious_score, 0) as suspicious_score,
                    CASE 
                        WHEN COALESCE(wr.suspicious_score, 0) > 300 THEN 'КРИТИЧЕСКИЙ РИСК'
                        WHEN COALESCE(wr.suspicious_score, 0) > 150 THEN 'ВЫСОКИЙ РИСК'
                        WHEN COALESCE(wr.suspicious_score, 0) > 50 THEN 'ПОДОЗРИТЕЛЬНО'
                        WHEN COALESCE(wr.suspicious_score, 0) > 0 THEN 'ВНИМАНИЕ'
                        ELSE 'НОРМА'
                    END as risk_level,
                    -- Активность
                    (SELECT COUNT(*) FROM lot_bids WHERE bidder_login = u.login) as total_bids,
                    (SELECT COUNT(DISTINCT auction_number) FROM lot_bids WHERE bidder_login = u.login) as unique_auctions,
                    GREATEST(
                        (SELECT MAX(bid_timestamp) FROM lot_bids WHERE bidder_login = u.login),
                        (SELECT MAX(auction_end_date) FROM auction_lots WHERE winner_login = u.login)
                    ) as last_activity
                FROM all_users u
                LEFT JOIN (
                    SELECT winner_login, COUNT(*) as total_lots, SUM(winning_bid) as total_spent
                    FROM auction_lots
                    WHERE winner_login IS NOT NULL AND winning_bid IS NOT NULL AND winning_bid > 0
                    GROUP BY winner_login
                ) w ON u.login = w.winner_login
                LEFT JOIN winner_ratings wr ON u.login = wr.winner_login
            )
            SELECT * FROM user_stats
            WHERE 1=1
        `;
        
        const params = [];
        let paramIndex = 1;
        
        // Фильтр по статусу
        if (status === 'winners') {
            query += ` AND status = 'Победитель'`;
        } else if (status === 'participants') {
            query += ` AND status = 'Участник'`;
        }
        
        // Фильтр по риск-уровню
        if (risk_level && risk_level !== 'all') {
            const riskMap = {
                'critical': 'КРИТИЧЕСКИЙ РИСК',
                'high': 'ВЫСОКИЙ РИСК',
                'medium': 'ПОДОЗРИТЕЛЬНО',
                'low': 'ВНИМАНИЕ',
                'normal': 'НОРМА'
            };
            if (riskMap[risk_level]) {
                query += ` AND risk_level = $${paramIndex}`;
                params.push(riskMap[risk_level]);
                paramIndex++;
            }
        }
        
        // Фильтр по категории рейтинга
        if (rating_category && rating_category !== 'all') {
            const categoryMap = {
                'vip': 'VIP',
                'premium': 'Премиум',
                'standard': 'Стандарт',
                'basic': 'Базовый',
                'newbie': 'Новичок'
            };
            if (categoryMap[rating_category]) {
                query += ` AND category = $${paramIndex}`;
                params.push(categoryMap[rating_category]);
                paramIndex++;
            }
        }
        
        // Поиск по логину
        if (search) {
            query += ` AND login ILIKE $${paramIndex}`;
            params.push(`%${search}%`);
            paramIndex++;
        }
        
        // Сортировка
        query += ` ORDER BY ${sortField} ${sortDirection} NULLS LAST, login ASC`;
        
        // Пагинация
        query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        params.push(parseInt(limit), offset);
        
        const result = await pool.query(query, params);
        
        // Получаем общее количество для пагинации
        let countQuery = `
            WITH all_users AS (
                SELECT DISTINCT bidder_login as login FROM lot_bids WHERE bidder_login IS NOT NULL AND bidder_login != ''
                UNION
                SELECT DISTINCT winner_login as login FROM auction_lots WHERE winner_login IS NOT NULL AND winner_login != ''
            ),
            user_stats AS (
                SELECT 
                    u.login,
                    CASE WHEN w.winner_login IS NOT NULL THEN 'Победитель' ELSE 'Участник' END as status,
                    COALESCE(wr.suspicious_score, 0) as suspicious_score,
                    CASE 
                        WHEN COALESCE(wr.suspicious_score, 0) > 300 THEN 'КРИТИЧЕСКИЙ РИСК'
                        WHEN COALESCE(wr.suspicious_score, 0) > 150 THEN 'ВЫСОКИЙ РИСК'
                        WHEN COALESCE(wr.suspicious_score, 0) > 50 THEN 'ПОДОЗРИТЕЛЬНО'
                        WHEN COALESCE(wr.suspicious_score, 0) > 0 THEN 'ВНИМАНИЕ'
                        ELSE 'НОРМА'
                    END as risk_level,
                    wr.category
                FROM all_users u
                LEFT JOIN (
                    SELECT winner_login FROM auction_lots WHERE winner_login IS NOT NULL GROUP BY winner_login
                ) w ON u.login = w.winner_login
                LEFT JOIN winner_ratings wr ON u.login = wr.winner_login
            )
            SELECT COUNT(*) as total FROM user_stats WHERE 1=1
        `;
        
        const countParams = [];
        let countParamIndex = 1;
        
        if (status === 'winners') {
            countQuery += ` AND status = 'Победитель'`;
        } else if (status === 'participants') {
            countQuery += ` AND status = 'Участник'`;
        }
        
        if (risk_level && risk_level !== 'all') {
            const riskMap = {
                'critical': 'КРИТИЧЕСКИЙ РИСК',
                'high': 'ВЫСОКИЙ РИСК',
                'medium': 'ПОДОЗРИТЕЛЬНО',
                'low': 'ВНИМАНИЕ',
                'normal': 'НОРМА'
            };
            if (riskMap[risk_level]) {
                countQuery += ` AND risk_level = $${countParamIndex}`;
                countParams.push(riskMap[risk_level]);
                countParamIndex++;
            }
        }
        
        if (rating_category && rating_category !== 'all') {
            const categoryMap = {
                'vip': 'VIP',
                'premium': 'Премиум',
                'standard': 'Стандарт',
                'basic': 'Базовый',
                'newbie': 'Новичок'
            };
            if (categoryMap[rating_category]) {
                countQuery += ` AND category = $${countParamIndex}`;
                countParams.push(categoryMap[rating_category]);
                countParamIndex++;
            }
        }
        
        if (search) {
            countQuery += ` AND login ILIKE $${countParamIndex}`;
            countParams.push(`%${search}%`);
        }
        
        const countResult = await pool.query(countQuery, countParams);
        const total = parseInt(countResult.rows[0].total);
        
        res.json({
            data: result.rows,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: total,
                totalPages: Math.ceil(total / parseInt(limit))
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения списка пользователей:', error);
        res.status(500).json({ error: 'Ошибка получения списка пользователей', details: error.message });
    }
});

// Получить полный профиль пользователя
app.get('/api/users/:login', async (req, res) => {
    try {
        const { login } = req.params;
        
        // Получаем общую статистику
        const statsQuery = `
            SELECT 
                u.login,
                CASE WHEN w.winner_login IS NOT NULL THEN 'Победитель' ELSE 'Участник' END as status,
                COALESCE(w.total_lots, 0) as total_lots,
                COALESCE(w.total_spent, 0) as total_spent,
                COALESCE(w.avg_lot_price, 0) as avg_lot_price,
                COALESCE(w.max_lot_price, 0) as max_lot_price,
                w.first_auction_date,
                w.last_auction_date,
                (SELECT COUNT(*) FROM lot_bids WHERE bidder_login = u.login) as total_bids,
                (SELECT COUNT(*) FILTER (WHERE EXISTS (
                    SELECT 1 FROM auction_lots al 
                    WHERE al.winner_login = u.login AND al.id = lb.lot_id
                )) FROM lot_bids lb WHERE lb.bidder_login = u.login) as winning_bids,
                (SELECT COUNT(DISTINCT auction_number) FROM lot_bids WHERE bidder_login = u.login) as unique_auctions,
                (SELECT COUNT(DISTINCT lot_id) FROM lot_bids WHERE bidder_login = u.login) as unique_lots,
                GREATEST(
                    (SELECT MAX(bid_timestamp) FROM lot_bids WHERE bidder_login = u.login),
                    (SELECT MAX(auction_end_date) FROM auction_lots WHERE winner_login = u.login)
                ) as last_activity,
                (SELECT MIN(bid_timestamp) FROM lot_bids WHERE bidder_login = u.login) as first_activity
            FROM (SELECT $1::VARCHAR as login) u
            LEFT JOIN (
                SELECT 
                    winner_login,
                    COUNT(*) as total_lots,
                    SUM(winning_bid) as total_spent,
                    AVG(winning_bid) as avg_lot_price,
                    MAX(winning_bid) as max_lot_price,
                    MIN(auction_end_date) as first_auction_date,
                    MAX(auction_end_date) as last_auction_date
                FROM auction_lots
                WHERE winner_login = $1 AND winning_bid IS NOT NULL AND winning_bid > 0
                GROUP BY winner_login
            ) w ON u.login = w.winner_login
        `;
        
        const statsResult = await pool.query(statsQuery, [login]);
        
        if (statsResult.rows.length === 0) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }
        
        const stats = statsResult.rows[0];
        
        // Получаем рейтинг и риск-профиль
        const ratingQuery = `
            SELECT 
                rating,
                category,
                suspicious_score,
                CASE 
                    WHEN suspicious_score > 300 THEN 'КРИТИЧЕСКИЙ РИСК'
                    WHEN suspicious_score > 150 THEN 'ВЫСОКИЙ РИСК'
                    WHEN suspicious_score > 50 THEN 'ПОДОЗРИТЕЛЬНО'
                    WHEN suspicious_score > 0 THEN 'ВНИМАНИЕ'
                    ELSE 'НОРМА'
                END as risk_level,
                linked_accounts_score,
                carousel_score,
                self_boost_score,
                decoy_tactics_score,
                pricing_strategies_score,
                circular_buyers_score,
                fast_bids_score,
                autobid_traps_score,
                abandonment_score,
                technical_bidders_score,
                updated_at,
                last_analysis_date
            FROM winner_ratings
            WHERE winner_login = $1
        `;
        
        const ratingResult = await pool.query(ratingQuery, [login]);
        const rating = ratingResult.rows[0] || null;
        
        res.json({
            login: stats.login,
            status: stats.status,
            stats: {
                financial: {
                    total_lots: parseInt(stats.total_lots),
                    total_spent: parseFloat(stats.total_spent),
                    avg_lot_price: parseFloat(stats.avg_lot_price),
                    max_lot_price: parseFloat(stats.max_lot_price),
                    first_auction_date: stats.first_auction_date,
                    last_auction_date: stats.last_auction_date
                },
                activity: {
                    total_bids: parseInt(stats.total_bids),
                    winning_bids: parseInt(stats.winning_bids),
                    unique_auctions: parseInt(stats.unique_auctions),
                    unique_lots: parseInt(stats.unique_lots),
                    first_activity: stats.first_activity,
                    last_activity: stats.last_activity
                }
            },
            rating: rating ? {
                rating: rating.rating,
                category: rating.category,
                suspicious_score: rating.suspicious_score || 0,
                risk_level: rating.risk_level || 'НОРМА',
                updated_at: rating.updated_at
            } : null,
            risk_profile: rating ? {
                suspicious_score: rating.suspicious_score || 0,
                risk_level: rating.risk_level || 'НОРМА',
                scores: {
                    linked_accounts_score: rating.linked_accounts_score || 0,
                    carousel_score: rating.carousel_score || 0,
                    self_boost_score: rating.self_boost_score || 0,
                    decoy_tactics_score: rating.decoy_tactics_score || 0,
                    pricing_strategies_score: rating.pricing_strategies_score || 0,
                    circular_buyers_score: rating.circular_buyers_score || 0,
                    fast_bids_score: rating.fast_bids_score || 0,
                    autobid_traps_score: rating.autobid_traps_score || 0,
                    abandonment_score: rating.abandonment_score || 0,
                    technical_bidders_score: rating.technical_bidders_score || 0
                },
                last_analysis_date: rating.last_analysis_date
            } : null
        });
        
    } catch (error) {
        console.error('Ошибка получения профиля пользователя:', error);
        res.status(500).json({ error: 'Ошибка получения профиля пользователя', details: error.message });
    }
});

// Получить историю изменений рейтинга пользователя
app.get('/api/users/:login/rating-history', async (req, res) => {
    try {
        const { login } = req.params;
        const { limit = 50 } = req.query;
        
        const query = `
            SELECT 
                id,
                winner_login,
                rating,
                category,
                total_spent,
                total_lots,
                unique_auctions,
                avg_lot_price,
                max_lot_price,
                activity_days,
                changed_at,
                change_reason
            FROM rating_history
            WHERE winner_login = $1
            ORDER BY changed_at DESC
            LIMIT $2
        `;
        
        const result = await pool.query(query, [login, parseInt(limit)]);
        res.json(result.rows);
        
    } catch (error) {
        console.error('Ошибка получения истории рейтинга:', error);
        res.status(500).json({ error: 'Ошибка получения истории рейтинга', details: error.message });
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
            category,
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
        let whereConditions = ['al.auction_number = $1'];
        let queryParams = [currentAuctionNumber];
        let paramIndex = 2;
        
        // Фильтр по металлу
        if (metal) {
            whereConditions.push(`al.metal = $${paramIndex}`);
            queryParams.push(metal);
            paramIndex++;
        }
        
        // Фильтр по состоянию
        if (condition) {
            whereConditions.push(`al.condition = $${paramIndex}`);
            queryParams.push(condition);
            paramIndex++;
        }
        
        // Фильтр по категории
        if (category) {
            whereConditions.push(`al.category = $${paramIndex}`);
            queryParams.push(category);
            paramIndex++;
        }
        
        // Фильтр по стране (поиск в описании)
        if (country) {
            whereConditions.push(`al.coin_description ILIKE $${paramIndex}`);
            queryParams.push(`%${country}%`);
            paramIndex++;
        }
        
        // Фильтр по редкости (поиск в описании)
        if (rarity) {
            whereConditions.push(`al.coin_description ILIKE $${paramIndex}`);
            queryParams.push(`%${rarity}%`);
            paramIndex++;
        }
        
        // Фильтр по монетному двору (поиск в описании)
        if (mint) {
            whereConditions.push(`al.coin_description ILIKE $${paramIndex}`);
            queryParams.push(`%${mint}%`);
            paramIndex++;
        }
        
        // Фильтр по году
        if (yearFrom) {
            whereConditions.push(`al.year >= $${paramIndex}`);
            queryParams.push(parseInt(yearFrom));
            paramIndex++;
        }
        
        if (yearTo) {
            whereConditions.push(`al.year <= $${paramIndex}`);
            queryParams.push(parseInt(yearTo));
            paramIndex++;
        }
        
        // Поиск по описанию
        if (search) {
            whereConditions.push(`al.coin_description ILIKE $${paramIndex}`);
            queryParams.push(`%${search}%`);
            paramIndex++;
        }
        
        // Фильтр по цене (текущая цена = winning_bid)
        if (priceFrom) {
            whereConditions.push(`al.winning_bid >= $${paramIndex}`);
            queryParams.push(parseFloat(priceFrom));
            paramIndex++;
        }
        
        if (priceTo) {
            whereConditions.push(`al.winning_bid <= $${paramIndex}`);
            queryParams.push(parseFloat(priceTo));
            paramIndex++;
        }
        
        // Сортировка
        let orderBy = 'al.lot_number::int ASC';
        switch (sort) {
            case 'premium-desc':
                orderBy = 'al.winning_bid DESC';
                break;
            case 'premium-asc':
                orderBy = 'al.winning_bid ASC';
                break;
            case 'price-desc':
                orderBy = 'al.winning_bid DESC';
                break;
            case 'price-asc':
                orderBy = 'al.winning_bid ASC';
                break;
            case 'weight-desc':
                orderBy = 'al.weight DESC';
                break;
            case 'weight-asc':
                orderBy = 'al.weight ASC';
                break;
            case 'year-desc':
                orderBy = 'al.year DESC';
                break;
            case 'year-asc':
                orderBy = 'al.year ASC';
                break;
        }
        
        // Строим финальный запрос
        const whereClause = 'WHERE ' + whereConditions.join(' AND ');
        
        const query = `
            SELECT 
                al.id, al.lot_number, al.auction_number, al.coin_description,
                al.avers_image_url, al.revers_image_url, al.winner_login, 
                al.winning_bid, al.auction_end_date, al.bids_count, al.lot_status,
                al.year, al.letters, al.metal, al.condition, al.weight, al.parsed_at, al.source_url, al.category,
                NULL as country, NULL as rarity, NULL as mint,
                -- Добавляем расчет наценки (пока упрощенный)
                CASE 
                    WHEN al.winning_bid > 0 THEN 
                        ROUND(((al.winning_bid - COALESCE(al.weight * 0.001, 0)) / COALESCE(al.weight * 0.001, 1)) * 100, 1)
                    ELSE 0 
                END as premium
            FROM auction_lots al
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
            FROM auction_lots al
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
        console.error('Стек ошибки:', error.stack);
        res.status(500).json({ 
            error: 'Ошибка получения данных текущего аукциона',
            details: error.message
        });
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

// Получить историю ставок для лота
app.get('/api/lots/:lotId/bids', async (req, res) => {
    try {
        const { lotId } = req.params;
        
        const query = `
            SELECT 
                bid_amount, bidder_login, bid_timestamp, is_auto_bid
            FROM lot_bids 
            WHERE lot_id = $1
            ORDER BY bid_timestamp DESC
        `;
        
        const result = await pool.query(query, [lotId]);
        
        res.json({
            success: true,
            bids: result.rows,
            count: result.rows.length
        });
        
    } catch (error) {
        console.error('Ошибка получения истории ставок:', error);
        res.status(500).json({ 
            success: false,
            error: 'Ошибка получения истории ставок' 
        });
    }
});

// Получить прогнозы цен для лотов текущего аукциона
// Последний (самый свежий) wolmar VIP-аукцион — игнорируем чужие серии (1052-1062 и т.п.)
app.get('/api/current-vip-auction', async (req, res) => {
    try {
        // Берём аукцион с максимальным номером среди тех, у кого лоты с wolmar.ru.
        // Приоритет активному (auction_end_date в будущем), иначе самый свежий завершённый.
        const q = `
            WITH wolmar AS (
                SELECT
                    auction_number,
                    MAX(auction_end_date) AS end_date,
                    COUNT(*)              AS lots_count
                FROM auction_lots
                WHERE auction_number ~ '^[0-9]+$'
                  AND source_url ILIKE '%wolmar.ru%'
                GROUP BY auction_number
            )
            SELECT auction_number, end_date, lots_count,
                   (end_date > NOW()) AS is_active
            FROM wolmar
            ORDER BY (end_date > NOW()) DESC, auction_number::int DESC
            LIMIT 1
        `;
        const r = await pool.query(q);
        if (r.rows.length === 0) {
            return res.json({ success: false, error: 'Нет wolmar-аукционов в базе' });
        }
        const row = r.rows[0];
        res.json({
            success: true,
            auctionNumber: row.auction_number,
            endDate: row.end_date,
            lotsCount: parseInt(row.lots_count, 10),
            isActive: row.is_active
        });
    } catch (error) {
        console.error('Ошибка /api/current-vip-auction:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

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
                al.avers_image_url,
                al.revers_image_url,
                al.source_url,
                al.auction_number,
                lpp.predicted_price,
                lpp.metal_value,
                lpp.numismatic_premium,
                lpp.confidence_score,
                lpp.prediction_method,
                lpp.sample_size,
                lpp.created_at as prediction_created_at,
                lb.bid_amount as current_bid_amount
            FROM auction_lots al
            LEFT JOIN lot_price_predictions lpp ON al.id = lpp.lot_id
            LEFT JOIN LATERAL (
                SELECT bid_amount
                FROM lot_bids 
                WHERE lot_id = al.id 
                ORDER BY bid_timestamp DESC 
                LIMIT 1
            ) lb ON true
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
        
        // Используем универсальную функцию извлечения номинала и валюты
        const { extractDenominationAndCurrency, createDenominationSQLCondition } = require('./utils/denomination-extractor');
        const denominationData = extractDenominationAndCurrency(currentLot.coin_description);
        
        const currentDenomination = denominationData ? denominationData.denomination.toString() : null;
        const currentCurrency = denominationData ? denominationData.currency : null;
        
        console.log(`🔍 Извлеченные данные о номинале:`, denominationData);
        
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
        
        // Если номинал и валюта найдены, добавляем их в условие поиска
        if (denominationData) {
            const denominationCondition = createDenominationSQLCondition(denominationData, params);
            similarQuery += denominationCondition;
            console.log(`🔍 Добавлено условие по номиналу и валюте: ${denominationData.fullText}`);
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
        
        // Используем существующую конфигурацию Supabase
        const pool = new Pool(config.dbConfig);
        
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
// API для получения статистики категорий
app.get('/api/catalog/category-stats', async (req, res) => {
    try {
        console.log('📊 Запрос статистики категорий');
        
        const result = await pool.query(`
            SELECT category, COUNT(*) as count
            FROM coin_catalog 
            WHERE category IS NOT NULL AND category != ''
            GROUP BY category 
            ORDER BY count DESC, category
        `);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Ошибка получения статистики категорий:', error);
        res.status(500).json({ error: 'Ошибка получения статистики категорий' });
    }
});

app.get('/api/catalog/filters', async (req, res) => {
    try {
        console.log('🔍 Запрос всех фильтров каталога');
        
        // Загружаем все фильтры параллельно
        const [countriesResult, metalsResult, raritiesResult, conditionsResult, mintsResult, categoriesResult, denominationsResult] = await Promise.all([
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
            `),
            pool.query(`
                SELECT DISTINCT category, COUNT(*) as count
                FROM coin_catalog 
                WHERE category IS NOT NULL AND category != ''
                GROUP BY category 
                ORDER BY count DESC, category
            `),
            pool.query(`
                SELECT DISTINCT denomination, COUNT(*) as count
                FROM coin_catalog 
                WHERE denomination IS NOT NULL AND denomination != ''
                GROUP BY denomination 
                ORDER BY count DESC, denomination
            `)
        ]);

        const result = {
            countries: countriesResult.rows.map(row => row.country),
            metals: metalsResult.rows.map(row => row.metal),
            rarities: raritiesResult.rows.map(row => row.rarity),
            conditions: conditionsResult.rows.map(row => row.condition),
            mints: mintsResult.rows.map(row => row.mint),
            categories: categoriesResult.rows.map(row => row.category),
            denominations: denominationsResult.rows.map(row => row.denomination)
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
            category,
            search,
            denomination,
            mint,
            yearFrom,
            yearTo,
            minMintage,
            maxMintage,
            minWeight,
            maxWeight,
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

        if (category) {
            whereConditions.push(`category = $${paramIndex++}`);
            queryParams.push(category);
        }

        if (search) {
            whereConditions.push(`(coin_name ILIKE $${paramIndex} OR denomination ILIKE $${paramIndex} OR original_description ILIKE $${paramIndex})`);
            queryParams.push(`%${search}%`);
            paramIndex++;
        }

        if (denomination) {
            whereConditions.push(`denomination = $${paramIndex++}`);
            queryParams.push(denomination);
        }

        if (mint) {
            whereConditions.push(`mint = $${paramIndex++}`);
            queryParams.push(mint);
        }

        if (yearFrom) {
            whereConditions.push(`year >= $${paramIndex++}`);
            queryParams.push(parseInt(yearFrom));
        }

        if (yearTo) {
            whereConditions.push(`year <= $${paramIndex++}`);
            queryParams.push(parseInt(yearTo));
        }

        if (minMintage) {
            whereConditions.push(`mintage >= $${paramIndex++}`);
            queryParams.push(parseInt(minMintage));
        }

        if (maxMintage) {
            whereConditions.push(`mintage <= $${paramIndex++}`);
            queryParams.push(parseInt(maxMintage));
        }

        if (minWeight) {
            whereConditions.push(`coin_weight >= $${paramIndex++}`);
            queryParams.push(parseFloat(minWeight));
        }

        if (maxWeight) {
            whereConditions.push(`coin_weight <= $${paramIndex++}`);
            queryParams.push(parseFloat(maxWeight));
        }

        const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';
        
        const offset = (parseInt(page) - 1) * parseInt(limit);
        
        const countQuery = `SELECT COUNT(*) FROM coin_catalog ${whereClause}`;
        const countResult = await pool.query(countQuery, queryParams);
        const total = parseInt(countResult.rows[0].count);

        const dataQuery = `
            SELECT 
                id, coin_name, denomination, year, metal, country, category,
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

// Update coin category
app.put('/api/catalog/coins/:id/category', async (req, res) => {
    try {
        const { id } = req.params;
        const { category } = req.body;
        
        if (!category) {
            return res.status(400).json({ error: 'Категория обязательна' });
        }
        
        const validCategories = ['coin', 'medal', 'badge', 'order', 'banknote', 'jewelry', 'watch', 'tableware', 'token', 'other'];
        if (!validCategories.includes(category)) {
            return res.status(400).json({ error: 'Недопустимая категория' });
        }
        
        const result = await pool.query(
            'UPDATE coin_catalog SET category = $1 WHERE id = $2 RETURNING *',
            [category, id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Предмет не найден' });
        }
        
        console.log(`✅ Категория предмета ${id} изменена на ${category}`);
        res.json({ success: true, item: result.rows[0] });
    } catch (error) {
        console.error('Ошибка изменения категории:', error);
        res.status(500).json({ error: 'Ошибка изменения категории' });
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
        // Используем 400, чтобы не провоцировать повторный Basic Auth prompt в браузере
        res.status(400).json({ error: error.message });
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
// Пересчет прогнозов для лотов из избранного
app.post('/api/watchlist/recalculate-predictions', authenticateToken, async (req, res) => {
    try {
        console.log(`🔄 Пересчет прогнозов для лотов из избранного пользователя ${req.user.id}`);
        
        const { lotIds } = req.body;
        if (!lotIds || !Array.isArray(lotIds)) {
            return res.status(400).json({ error: 'Необходимо указать массив ID лотов' });
        }
        
        console.log(`📊 Пересчитываем прогнозы для ${lotIds.length} лотов`);
        
        // Запускаем пересчет прогнозов в фоновом режиме
        const { spawn } = require('child_process');
        
        const recalculateProcess = spawn('node', ['improved-predictions-generator.js', '--watchlist', lotIds.join(',')], {
            cwd: __dirname,
            stdio: ['ignore', 'pipe', 'pipe']
        });
        
        let output = '';
        let errorOutput = '';
        
        recalculateProcess.stdout.on('data', (data) => {
            output += data.toString();
        });
        
        recalculateProcess.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });
        
        recalculateProcess.on('close', (code) => {
            if (code === 0) {
                console.log('✅ Пересчет прогнозов завершен успешно');
                console.log('📊 Вывод скрипта:', output);
            } else {
                console.error('❌ Ошибка пересчета прогнозов:', errorOutput);
                console.error('📊 Код завершения:', code);
            }
        });
        
        // Логируем запуск скрипта
        console.log(`🚀 Запускаем пересчет прогнозов для лотов: ${lotIds.join(', ')}`);
        
        // Возвращаем ответ сразу, не дожидаясь завершения
        res.json({
            success: true,
            message: 'Пересчет прогнозов запущен в фоновом режиме',
            results: {
                recalculatedPredictions: 0, // Будет обновлено в фоновом режиме
                errors: []
            }
        });
        
    } catch (error) {
        console.error('Ошибка запуска пересчета прогнозов:', error);
        res.status(500).json({ error: 'Ошибка запуска пересчета прогнозов' });
    }
});

app.post('/api/watchlist/update-lots', authenticateToken, async (req, res) => {
    try {
        console.log(`🔄 Обновление данных лотов из избранного для пользователя ${req.user.id}`);
        
        const { lotIds } = req.body;
        if (!lotIds || !Array.isArray(lotIds)) {
            return res.status(400).json({ error: 'Необходимо указать массив ID лотов' });
        }
        
        console.log(`📊 Обрабатываем ${lotIds.length} лотов из избранного`);
        
        // Запускаем обновление ставок в фоновом режиме
        const { spawn } = require('child_process');
        
        const updateProcess = spawn('node', ['update-watchlist-bids.js', req.user.id.toString()], {
            cwd: __dirname,
            stdio: ['ignore', 'pipe', 'pipe']
        });
        
        let output = '';
        let errorOutput = '';
        
        updateProcess.stdout.on('data', (data) => {
            output += data.toString();
        });
        
        updateProcess.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });
        
        updateProcess.on('close', (code) => {
            if (code === 0) {
                console.log('✅ Обновление ставок завершено успешно');
                console.log('📊 Вывод скрипта:', output);
            } else {
                console.error('❌ Ошибка обновления ставок:', errorOutput);
                console.error('📊 Код завершения:', code);
            }
        });
        
        // Логируем запуск скрипта
        console.log(`🚀 Запускаем скрипт: node update-watchlist-bids.js ${req.user.id}`);
        
        // Возвращаем ответ сразу, не дожидаясь завершения
        res.json({
            success: true,
            message: 'Обновление ставок запущено в фоновом режиме',
            results: {
                updatedBids: 0, // Будет обновлено в фоновом режиме
                updatedPredictions: 0, // Пока не реализовано
                errors: []
            }
        });
        
    } catch (error) {
        console.error('Ошибка запуска обновления лотов из избранного:', error);
        res.status(500).json({ error: 'Ошибка запуска обновления лотов из избранного' });
    }
});

// API для получения рискованности лота на основе участников торгов
app.get('/api/lots/:lotId/risk', async (req, res) => {
    try {
        const { lotId } = req.params;
        
        // Получаем всех уникальных участников торгов по лоту
        // lot_id в lot_bids может быть как ID из auction_lots, так и строковый идентификатор
        // Проверяем оба варианта
        const participantsQuery = `
            SELECT DISTINCT 
                lb.bidder_login,
                COALESCE(wr.suspicious_score, 0) as suspicious_score,
                CASE 
                    WHEN COALESCE(wr.suspicious_score, 0) > 300 THEN 'КРИТИЧЕСКИЙ РИСК'
                    WHEN COALESCE(wr.suspicious_score, 0) > 150 THEN 'ВЫСОКИЙ РИСК'
                    WHEN COALESCE(wr.suspicious_score, 0) > 50 THEN 'ПОДОЗРИТЕЛЬНО'
                    WHEN COALESCE(wr.suspicious_score, 0) > 0 THEN 'ВНИМАНИЕ'
                    ELSE 'НОРМА'
                END as risk_level
            FROM lot_bids lb
            LEFT JOIN winner_ratings wr ON wr.winner_login = lb.bidder_login
            WHERE lb.lot_id = $1
        `;
        
        const participantsResult = await pool.query(participantsQuery, [lotId]);
        const participants = participantsResult.rows;
        
        if (participants.length === 0) {
            return res.json({
                risk_level: 'БЕЗ РИСКА',
                risk_score: 0,
                total_participants: 0,
                suspicious_count: 0,
                suspicious_percentage: 0,
                has_critical: false,
                participants: []
            });
        }
        
        const totalParticipants = participants.length;
        const suspiciousParticipants = participants.filter(p => p.suspicious_score > 0);
        const suspiciousCount = suspiciousParticipants.length;
        const suspiciousPercentage = (suspiciousCount / totalParticipants) * 100;
        
        // Проверяем наличие критических участников
        const hasCritical = participants.some(p => p.suspicious_score > 300);
        
        // Определяем уровень риска
        let riskLevel, riskScore;
        
        if (hasCritical) {
            riskLevel = 'КРИТИЧЕСКИЙ РИСК';
            riskScore = 5;
        } else if (suspiciousCount >= 3 || suspiciousPercentage >= 50) {
            riskLevel = 'ВЫСОКИЙ РИСК';
            riskScore = 4;
        } else if (suspiciousCount >= 1 && suspiciousCount <= 2 || (suspiciousPercentage >= 10 && suspiciousPercentage < 50)) {
            riskLevel = 'СРЕДНИЙ РИСК';
            riskScore = 3;
        } else if (suspiciousCount === 1 && suspiciousPercentage < 10) {
            riskLevel = 'НИЗКИЙ РИСК';
            riskScore = 2;
        } else {
            riskLevel = 'БЕЗ РИСКА';
            riskScore = 1;
        }
        
        // Сортируем участников: сначала подозрительные (по убыванию балла), потом остальные
        const sortedParticipants = [...participants].sort((a, b) => {
            if (a.suspicious_score > 0 && b.suspicious_score === 0) return -1;
            if (a.suspicious_score === 0 && b.suspicious_score > 0) return 1;
            return b.suspicious_score - a.suspicious_score;
        });
        
        res.json({
            risk_level: riskLevel,
            risk_score: riskScore,
            total_participants: totalParticipants,
            suspicious_count: suspiciousCount,
            suspicious_percentage: Math.round(suspiciousPercentage * 10) / 10,
            has_critical: hasCritical,
            participants: sortedParticipants.map(p => ({
                bidder_login: p.bidder_login,
                suspicious_score: p.suspicious_score,
                risk_level: p.risk_level
            }))
        });
        
    } catch (error) {
        console.error('Ошибка расчета рискованности лота:', error);
        res.status(500).json({ error: 'Ошибка расчета рискованности лота' });
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

// Place bid on lot
app.post('/api/place-bid', authenticateToken, async (req, res) => {
    try {
        console.log(`🎯 API /api/place-bid вызван пользователем ${req.user.id}`);
        console.log(`📥 Тело запроса:`, req.body);
        console.log(`🆔 ВЕРСИЯ КОДА: 2025-10-16 17:00 - Логирование добавлено`);
        
        // Логируем в файл для отладки
        const fs = require('fs');
        const logMessage = `${new Date().toISOString()} - API /api/place-bid вызван пользователем ${req.user.id}\n`;
        fs.appendFileSync('bid-debug.log', logMessage);
        
        const { lotId, amount, useAutoBid = false } = req.body;
        fs.appendFileSync('bid-debug.log', `${new Date().toISOString()} - lotId: ${lotId}, amount: ${amount}, useAutoBid: ${useAutoBid}\n`);
        
        // Валидация входных данных
        if (!lotId || !amount) {
            return res.status(400).json({ error: 'Необходимо указать lotId и amount' });
        }
        
        if (amount < 1 || amount > 1000000) {
            return res.status(400).json({ error: 'Сумма ставки должна быть от 1 до 1,000,000 рублей' });
        }
        
        console.log(`📊 Параметры ставки: lotId=${lotId}, сумма ${amount}₽`);
        
        // Получаем source_url из базы данных
        const lotQuery = `
            SELECT source_url
            FROM auction_lots 
            WHERE id = $1
        `;
        console.log(`🔍 Выполняем запрос: ${lotQuery} с параметрами [${lotId}]`);
        fs.appendFileSync('bid-debug.log', `${new Date().toISOString()} - SQL запрос: ${lotQuery} с параметрами [${lotId}]\n`);
        const lotResult = await pool.query(lotQuery, [lotId]);
        console.log(`📊 Результат запроса: найдено ${lotResult.rows.length} записей`);
        fs.appendFileSync('bid-debug.log', `${new Date().toISOString()} - SQL результат: найдено ${lotResult.rows.length} записей\n`);
        
        if (lotResult.rows.length === 0) {
            return res.status(404).json({ error: 'Лот не найден в базе данных' });
        }
        
        const sourceUrl = lotResult.rows[0].source_url;
        
        // Логируем source_url из базы данных
        fs.appendFileSync('bid-debug.log', `${new Date().toISOString()} - Из БД: source_url=${sourceUrl}\n`);
        
        if (!sourceUrl) {
            return res.status(400).json({ error: 'У лота отсутствует source_url' });
        }
        
        // Парсим URL для извлечения параметров
        // Пример: https://www.wolmar.ru/auction/2119/7491006?page=29
        const urlMatch = sourceUrl.match(/\/auction\/(\d+)\/(\d+)/);
        if (!urlMatch) {
            return res.status(400).json({ error: 'Не удалось извлечь параметры из source_url' });
        }
        
        const wolmarAuctionNumber = urlMatch[1]; // 2119
        const wolmarLotNumber = urlMatch[2];     // 7491006
        
        fs.appendFileSync('bid-debug.log', `${new Date().toISOString()} - Извлечено: auction=${wolmarAuctionNumber}, lot=${wolmarLotNumber}\n`);
        
        console.log(`📊 Извлечено из URL: auction=${wolmarAuctionNumber}, lot=${wolmarLotNumber} для лота ${lotId}`);
        console.log(`📊 Финальные параметры для скрипта: auctionNumber=${wolmarAuctionNumber}, lotNumber=${wolmarLotNumber}, amount=${amount}`);
        
        // Запускаем скрипт постановки ставки в фоновом режиме
        const { spawn } = require('child_process');

        const bidProcess = spawn('node', ['place-bid.js', wolmarAuctionNumber.toString(), wolmarLotNumber.toString(), amount.toString(), useAutoBid.toString()], {
            cwd: __dirname,
            stdio: ['ignore', 'pipe', 'pipe']
        });
        
        let output = '';
        let errorOutput = '';
        
        bidProcess.stdout.on('data', (data) => {
            output += data.toString();
        });
        
        bidProcess.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });
        
        bidProcess.on('close', (code) => {
            if (code === 0) {
                console.log('✅ Ставка поставлена успешно');
                console.log('📊 Вывод скрипта:', output);
            } else {
                console.error('❌ Ошибка постановки ставки:', errorOutput);
                console.error('📊 Код завершения:', code);
            }
        });
        
        // Логируем запуск скрипта
        console.log(`🚀 Запускаем скрипт: node place-bid.js ${wolmarAuctionNumber} ${wolmarLotNumber} ${amount} ${useAutoBid}`);
        fs.appendFileSync('bid-debug.log', `${new Date().toISOString()} - Запускаем скрипт: node place-bid.js ${wolmarAuctionNumber} ${wolmarLotNumber} ${amount} ${useAutoBid}\n`);
        
        // Возвращаем ответ сразу, не дожидаясь завершения
        res.json({
            success: true,
            message: 'Ставка поставлена успешно',
            data: {
                lotId,
                wolmarAuctionNumber,
                wolmarLotNumber,
                amount,
                useAutoBid,
                timestamp: new Date().toISOString()
            }
        });
        
        fs.appendFileSync('bid-debug.log', `${new Date().toISOString()} - Отправлен успешный ответ клиенту\n`);
        
    } catch (error) {
        console.error('Ошибка постановки ставки:', error);
        res.status(500).json({ error: 'Ошибка постановки ставки' });
    }
});

// ==================== ФИЛЬТРЫ ДЛЯ ТЕКУЩЕГО АУКЦИОНА ====================

// Получить опции фильтров из справочной таблицы
app.get('/api/auction-filter-options', async (req, res) => {
    try {
        const { type } = req.query;
        console.log('🔍 API /api/auction-filter-options вызван с типом:', type);
        
        let query = `
            SELECT value, display_name 
            FROM filter_options 
            WHERE type = $1 
            ORDER BY display_name
        `;
        
        console.log('📡 SQL запрос:', query);
        console.log('📡 Параметры:', [type]);
        
        const result = await pool.query(query, [type]);
        
        console.log('📊 Результат запроса:', result.rows.length, 'записей');
        
        res.json(result.rows);
    } catch (error) {
        console.error('❌ Ошибка получения опций фильтров:', error);
        console.error('❌ Стек ошибки:', error.stack);
        res.status(500).json({ error: 'Ошибка получения опций фильтров', details: error.message });
    }
});

// API для работы с файлом прогресса Category Parser
app.get('/api/category-parser/progress/:auctionNumber', async (req, res) => {
    try {
        const { auctionNumber } = req.params;
        console.log('🔍 API /api/category-parser/progress вызван для аукциона:', auctionNumber);
        
        const fs = require('fs');
        const path = require('path');
        
        // Путь к файлу прогресса
        const progressFile = path.join(__dirname, `parser_progress_category-parser-${auctionNumber}.json`);
        
        if (fs.existsSync(progressFile)) {
            const progressData = fs.readFileSync(progressFile, 'utf8');
            const progress = JSON.parse(progressData);
            
            console.log('📂 Найден файл прогресса:', progress);
            
            res.json({
                exists: true,
                progress: progress
            });
        } else {
            console.log('📂 Файл прогресса не найден:', progressFile);
            
            res.json({
                exists: false,
                message: 'Файл прогресса не найден'
            });
        }
    } catch (error) {
        console.error('❌ Ошибка получения файла прогресса:', error);
        res.status(500).json({ error: 'Ошибка получения файла прогресса', details: error.message });
    }
});

app.put('/api/category-parser/progress/:auctionNumber', async (req, res) => {
    try {
        const { auctionNumber } = req.params;
        const { lastProcessedLot, lastProcessedCategory } = req.body;
        
        console.log('🔍 API PUT /api/category-parser/progress вызван для аукциона:', auctionNumber);
        console.log('📝 Данные для обновления:', { lastProcessedLot, lastProcessedCategory });
        
        const fs = require('fs');
        const path = require('path');
        
        // Путь к файлу прогресса
        const progressFile = path.join(__dirname, `parser_progress_category-parser-${auctionNumber}.json`);
        
        
        let progress = {};
        
        // Если файл существует, загружаем его
        if (fs.existsSync(progressFile)) {
            const progressData = fs.readFileSync(progressFile, 'utf8');
            progress = JSON.parse(progressData);
        }
        
        // Обновляем данные
        progress.lastProcessedLot = lastProcessedLot;
        progress.lastProcessedCategory = lastProcessedCategory;
        progress.timestamp = new Date().toISOString();
        progress.mode = 'resume';
        progress.targetAuctionNumber = parseInt(auctionNumber);
        
        // Сохраняем файл
        fs.writeFileSync(progressFile, JSON.stringify(progress, null, 2));
        
        console.log('💾 Файл прогресса обновлен:', progress);
        
        res.json({
            success: true,
            message: 'Файл прогресса обновлен',
            progress: progress
        });
    } catch (error) {
        console.error('❌ Ошибка обновления файла прогресса:', error);
        res.status(500).json({ error: 'Ошибка обновления файла прогресса', details: error.message });
    }
});

app.delete('/api/category-parser/progress/:auctionNumber', async (req, res) => {
    try {
        const { auctionNumber } = req.params;
        console.log('🔍 API DELETE /api/category-parser/progress вызван для аукциона:', auctionNumber);
        
        const fs = require('fs');
        const path = require('path');
        
        // Путь к файлу прогресса
        const progressFile = path.join(__dirname, `parser_progress_category-parser-${auctionNumber}.json`);
        
        if (fs.existsSync(progressFile)) {
            fs.unlinkSync(progressFile);
            console.log('🗑️ Файл прогресса удален:', progressFile);
            
            res.json({
                success: true,
                message: 'Файл прогресса удален'
            });
        } else {
            console.log('📂 Файл прогресса не найден для удаления:', progressFile);
            
            res.json({
                success: true,
                message: 'Файл прогресса не найден (уже удален)'
            });
        }
    } catch (error) {
        console.error('❌ Ошибка удаления файла прогресса:', error);
        res.status(500).json({ error: 'Ошибка удаления файла прогресса', details: error.message });
    }
});

// API для диагностики завершения аукциона
app.get('/api/category-parser/check-completion/:auctionNumber', async (req, res) => {
    try {
        const { auctionNumber } = req.params;
        console.log('🔍 API /api/category-parser/check-completion вызван для аукциона:', auctionNumber);
        console.log('🔍 Тип auctionNumber:', typeof auctionNumber);
        console.log('🔍 auctionNumber как число:', parseInt(auctionNumber));
        
        // Получаем все категории из БД (используем правильную таблицу)
        const categoriesQuery = `
            SELECT name, url_slug, url_template
            FROM wolmar_categories 
            ORDER BY name
        `;
        const categoriesResult = await pool.query(categoriesQuery);
        const allCategories = categoriesResult.rows;
        
        console.log('📊 Все категории из wolmar_categories:', {
            count: allCategories.length,
            categories: allCategories.map(cat => cat.name)
        });
        
        console.log('📊 Категории из wolmar_categories:', {
            totalCategories: allCategories.length,
            categories: allCategories.map(cat => cat.name)
        });
        
        // Получаем статистику по лотам в БД для этого аукциона (используем parsing_number)
        const statsQuery = `
            SELECT 
                COUNT(*) as total_lots,
                COUNT(CASE WHEN category IS NOT NULL AND category != '' THEN 1 END) as lots_with_categories,
                COUNT(DISTINCT category) as categories_count
            FROM auction_lots 
            WHERE parsing_number = $1
        `;
        const statsResult = await pool.query(statsQuery, [parseInt(auctionNumber)]);
        const stats = statsResult.rows[0];
        
        console.log('📊 Статистика аукциона:', {
            auctionNumber,
            stats,
            totalLots: stats.total_lots,
            lotsWithCategories: stats.lots_with_categories,
            categoriesCount: stats.categories_count
        });
        
        // Получаем детальную статистику по категориям (используем parsing_number)
        const categoryStatsQuery = `
            SELECT 
                category,
                COUNT(*) as lots_count
            FROM auction_lots 
            WHERE parsing_number = $1 
                AND category IS NOT NULL 
                AND category != ''
            GROUP BY category
            ORDER BY lots_count DESC
        `;
        const categoryStatsResult = await pool.query(categoryStatsQuery, [parseInt(auctionNumber)]);
        const categoryStats = categoryStatsResult.rows;
        
        console.log('📊 Статистика по категориям:', {
            auctionNumber,
            categoryStatsCount: categoryStats.length,
            categoryStats: categoryStats
        });
        
        // Анализируем завершение
        const expectedCategories = allCategories.length; // Все категории из wolmar_categories
        const processedCategories = parseInt(stats.categories_count) || 0;
        const isComplete = processedCategories >= expectedCategories;
        
        // Находим категории, которые есть в wolmar_categories, но не обработаны для данного аукциона
        const processedCategoryNames = categoryStats.map(cat => cat.category).filter(name => name !== null);
        const unprocessedCategories = allCategories.filter(cat => 
            !processedCategoryNames.includes(cat.name)
        );
        
        console.log('📊 Анализ завершения:', {
            expectedCategories,
            processedCategories,
            isComplete,
            unprocessedCount: unprocessedCategories.length
        });
        
        res.json({
            auctionNumber: parseInt(auctionNumber),
            expectedCategories,
            processedCategories,
            totalLots: parseInt(stats.total_lots),
            isComplete,
            unprocessedCategories: unprocessedCategories.map(cat => ({
                name: cat.name,
                url: cat.url_template.replace('{AUCTION_NUMBER}', auctionNumber)
            })),
            categoryStats: categoryStats.map(cat => ({
                name: cat.category,
                lotCount: parseInt(cat.lots_count)
            }))
        });
        
    } catch (error) {
        console.error('❌ Ошибка проверки завершения аукциона:', error);
        res.status(500).json({ error: 'Ошибка проверки завершения аукциона', details: error.message });
    }
});

// API для создания файла прогресса на основе данных из БД
app.post('/api/category-parser/create-progress-from-db/:auctionNumber', async (req, res) => {
    try {
        const { auctionNumber } = req.params;
        const { lastProcessedLot, lastProcessedCategory } = req.body;
        
        console.log('🔍 API POST /api/category-parser/create-progress-from-db вызван для аукциона:', auctionNumber);
        console.log('📝 Данные для создания:', { lastProcessedLot, lastProcessedCategory });
        
        const fs = require('fs');
        const path = require('path');
        
        // Получаем статистику из БД
        const statsQuery = `
            SELECT 
                COUNT(*) as processed,
                COUNT(CASE WHEN category IS NULL THEN 1 END) as skipped,
                0 as errors
            FROM auction_lots 
            WHERE auction_number = $1
        `;
        const statsResult = await pool.query(statsQuery, [auctionNumber]);
        const stats = statsResult.rows[0];
        
        // Получаем прогресс по категориям
        const categoryProgressQuery = `
            SELECT 
                category,
                COUNT(*) as processed,
                COUNT(*) as total
            FROM auction_lots 
            WHERE auction_number = $1 AND category IS NOT NULL
            GROUP BY category
        `;
        const categoryProgressResult = await pool.query(categoryProgressQuery, [auctionNumber]);
        const categoryProgress = {};
        categoryProgressResult.rows.forEach(row => {
            categoryProgress[row.category] = {
                processed: parseInt(row.processed),
                total: parseInt(row.total)
            };
        });
        
        // Создаем объект прогресса
        const progress = {
            timestamp: new Date().toISOString(),
            mode: 'resume',
            targetAuctionNumber: parseInt(auctionNumber),
            processed: parseInt(stats.processed),
            errors: parseInt(stats.errors),
            skipped: parseInt(stats.skipped),
            categoryProgress: categoryProgress,
            lastProcessedLot: lastProcessedLot ? parseInt(lastProcessedLot) : null,
            lastProcessedCategory: lastProcessedCategory || null,
            lastProcessedCategoryIndex: 0,
            createdFromDatabase: true
        };
        
        // Путь к файлу прогресса
        const progressFile = path.join(__dirname, `parser_progress_category-parser-${auctionNumber}.json`);
        
        
        // Сохраняем файл
        fs.writeFileSync(progressFile, JSON.stringify(progress, null, 2));
        
        console.log('💾 Файл прогресса создан из БД:', progress);
        
        res.json({
            success: true,
            message: 'Файл прогресса создан на основе данных из БД',
            progress: progress
        });
        
    } catch (error) {
        console.error('❌ Ошибка создания файла прогресса из БД:', error);
        res.status(500).json({ error: 'Ошибка создания файла прогресса из БД', details: error.message });
    }
});

// API для получения списка категорий для селектора
app.get('/api/categories/list', async (req, res) => {
    try {
        console.log('🔍 API /api/categories/list вызван');
        
        const categoriesQuery = `
            SELECT name, url_slug
            FROM wolmar_categories 
            ORDER BY name
        `;
        const categoriesResult = await pool.query(categoriesQuery);
        
        console.log('📊 Загружено категорий:', categoriesResult.rows.length);
        
        res.json(categoriesResult.rows);
    } catch (error) {
        console.error('❌ Ошибка получения списка категорий:', error);
        res.status(500).json({ error: 'Ошибка получения списка категорий', details: error.message });
    }
});

// Главная → тёмный лендинг аукционов; старый SPA остаётся доступен на /legacy
app.get('/', (req, res) => res.redirect(302, '/auctions.html'));
app.get('/legacy', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Serve static files - ПОСЛЕ всех API routes (index:false — чтобы "/" не отдавал старый SPA)
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// Fallback (старый SPA-роутинг для неизвестных путей)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Ошибка сервера:', error);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

// Start server
const HOST = isProduction ? config.serverConfig?.host || '0.0.0.0' : '0.0.0.0';
app.listen(PORT, HOST, () => {
    console.log(`🚀 Сервер запущен на ${HOST}:${PORT}`);
    console.log(`📊 API доступно по адресу: http://${HOST}:${PORT}/api`);
    console.log(`🌐 Веб-интерфейс: http://${HOST}:${PORT}`);
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
        
        // Получаем ВСЕ лоты текущего аукциона с данными из каталога (через JOIN)
        const query = `
            SELECT 
                al.id, al.lot_number, al.auction_number, al.coin_description,
                al.avers_image_url, al.revers_image_url, al.winner_login, 
                al.winning_bid, al.auction_end_date, al.bids_count, al.lot_status,
                al.year, al.letters, al.metal, al.condition, al.weight, al.parsed_at, al.source_url,
                cc.country, cc.rarity, cc.mint
            FROM auction_lots al
            LEFT JOIN coin_catalog cc ON (
                al.auction_number = cc.auction_number 
                AND al.lot_number = cc.lot_number
            )
            WHERE al.auction_number = $1
            ORDER BY al.lot_number::int ASC
        `;
        
        const result = await pool.query(query, [currentAuctionNumber]);
        
        res.json({
            currentAuctionNumber: currentAuctionNumber,
            lots: result.rows,
            total: result.rows.length
        });
        
    } catch (error) {
        console.error('Ошибка получения всех лотов текущего аукциона:', error);
        console.error('Стек ошибки:', error.stack);
        res.status(500).json({ 
            error: 'Ошибка получения лотов',
            details: error.message
        });
    }
});

// ==================== ФИЛЬТРЫ ДЛЯ ТЕКУЩЕГО АУКЦИОНА ====================

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

// API для очистки логов
app.post('/api/admin/logs/clear', (req, res) => {
    try {
        adminFunctions.clearLogs('main');
        adminFunctions.clearLogs('update');
        adminFunctions.clearLogs('predictions');
        
        // Также очищаем логи парсера каталога и парсера категорий
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
        
        // Очищаем логи парсера категорий
        const categoryParserLogs = [
            'logs/category-parser.log'
        ];
        
        for (const logFile of categoryParserLogs) {
            const logPath = path.join(process.cwd(), logFile);
            if (fs.existsSync(logPath)) {
                fs.writeFileSync(logPath, '');
            }
        }
        
        res.json({ success: true, message: 'Все логи очищены (включая логи парсера каталога и парсера категорий)' });
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

// Graceful shutdown — устойчиво к повторным сигналам.
// Раньше: при повторном SIGINT pool.end() бросал "Cannot use a pool after end",
// из-за чего process.exit не вызывался и процесс жил с мёртвым пулом (все запросы → 500).
let _shuttingDown = false;
async function gracefulShutdown(signal) {
    if (_shuttingDown) return;        // защита от повторного входа
    _shuttingDown = true;
    console.log(`\n🛑 Получен сигнал ${signal}, закрываем соединения...`);
    try {
        await pool.end();
    } catch (e) {
        console.warn('⚠️ pool.end():', e.message); // пул уже закрыт — игнорируем
    } finally {
        process.exit(0);              // выходим всегда
    }
}
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

module.exports = app;

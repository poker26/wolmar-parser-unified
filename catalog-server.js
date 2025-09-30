const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const cors = require('cors');
const config = require('./config');
const AuthService = require('./auth-service');
const CollectionService = require('./collection-service');
const CollectionPriceService = require('./collection-price-service');

const app = express();
const pool = new Pool(config.dbConfig);
const authService = new AuthService();
const collectionService = new CollectionService();
const collectionPriceService = new CollectionPriceService();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('catalog-public'));

// Serve images
app.use('/images', express.static('catalog-images'));

// API Routes

// Get catalog statistics
app.get('/api/catalog/stats', async (req, res) => {
    try {
        const query = `
            SELECT 
                COUNT(*) as total_coins,
                COUNT(DISTINCT denomination) as denominations_count,
                COUNT(DISTINCT year) as years_count,
                COUNT(DISTINCT metal) as metals_count,
                COUNT(DISTINCT rarity) as rarities_count,
                COUNT(DISTINCT mint) as mints_count,
                AVG(mintage) as avg_mintage,
                MIN(year) as earliest_year,
                MAX(year) as latest_year
            FROM coin_catalog
        `;
        
        const result = await pool.query(query);
        res.json(result.rows[0]);
        
    } catch (error) {
        console.error('Ошибка получения статистики каталога:', error);
        res.status(500).json({ error: 'Ошибка получения статистики каталога' });
    }
});

// Get list of countries
app.get('/api/catalog/countries', async (req, res) => {
    try {
        const query = `
            SELECT DISTINCT country 
            FROM coin_catalog 
            WHERE country IS NOT NULL 
            ORDER BY country
        `;
        
        const result = await pool.query(query);
        const countries = result.rows.map(row => row.country);
        res.json(countries);
        
    } catch (error) {
        console.error('Ошибка получения списка стран:', error);
        res.status(500).json({ error: 'Ошибка получения списка стран' });
    }
});

// Get catalog coins with filters and pagination
app.get('/api/catalog/coins', async (req, res) => {
    try {
        const { 
            page = 1, 
            limit = 20, 
            search, 
            denomination, 
            metal, 
            rarity, 
            year, 
            yearFrom,
            yearTo,
            mint,
            country,
            minMintage,
            maxMintage
        } = req.query;
        
        // Логируем входящие параметры
        console.log('Incoming query params:', req.query);
        console.log('Search param:', search);
        console.log('Metal param:', metal);
        
        let query = `
            SELECT 
                id, lot_id, denomination, coin_name, year, metal, rarity,
                mint, mintage, condition, country,
                bitkin_info, uzdenikov_info, ilyin_info, 
                petrov_info, severin_info, dyakov_info,
                avers_image_path, revers_image_path,
                avers_image_url, revers_image_url,
                coin_weight, fineness, pure_metal_weight, weight_oz,
                CASE WHEN avers_image_data IS NOT NULL THEN true ELSE false END as has_avers_image,
                CASE WHEN revers_image_data IS NOT NULL THEN true ELSE false END as has_revers_image,
                auction_number, lot_number,
                original_description
            FROM coin_catalog 
            WHERE 1=1
        `;
        
        const queryParams = [];
        let paramIndex = 1;
        
        // Add filters
        if (search) {
            // Улучшенная логика поиска: приоритет номиналу и названию, затем описанию
            query += ` AND (
                denomination ILIKE $${paramIndex} OR 
                coin_name ILIKE $${paramIndex} OR 
                (original_description ILIKE $${paramIndex} AND original_description NOT ILIKE $${paramIndex + 1})
            )`;
            queryParams.push(`%${search}%`);
            // Исключаем результаты, где поисковый запрос встречается в контексте цен/стоимости
            queryParams.push(`%рублей%${search}%`);
            paramIndex += 2;
        }
        
        if (denomination) {
            query += ` AND denomination = $${paramIndex}`;
            queryParams.push(denomination);
            paramIndex++;
        }
        
        if (metal) {
            query += ` AND metal = $${paramIndex}`;
            queryParams.push(metal);
            paramIndex++;
        }
        
        if (rarity) {
            query += ` AND rarity = $${paramIndex}`;
            queryParams.push(rarity);
            paramIndex++;
        }
        
        if (year) {
            query += ` AND year = $${paramIndex}`;
            queryParams.push(parseInt(year));
            paramIndex++;
        }
        
        if (yearFrom) {
            query += ` AND year >= $${paramIndex}`;
            queryParams.push(parseInt(yearFrom));
            paramIndex++;
        }
        
        if (yearTo) {
            query += ` AND year <= $${paramIndex}`;
            queryParams.push(parseInt(yearTo));
            paramIndex++;
        }
        
        if (mint) {
            query += ` AND mint ILIKE $${paramIndex}`;
            queryParams.push(`%${mint}%`);
            paramIndex++;
        }
        
        if (country) {
            query += ` AND country = $${paramIndex}`;
            queryParams.push(country);
            paramIndex++;
        }
        
        if (minMintage) {
            query += ` AND mintage >= $${paramIndex}`;
            queryParams.push(parseInt(minMintage));
            paramIndex++;
        }
        
        if (maxMintage) {
            query += ` AND mintage <= $${paramIndex}`;
            queryParams.push(parseInt(maxMintage));
            paramIndex++;
        }
        
        // Add sorting and pagination
        query += ` ORDER BY year DESC, denomination ASC, coin_name ASC`;
        
        const offset = (page - 1) * limit;
        query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        queryParams.push(parseInt(limit), offset);
        
        // Логируем SQL запрос для отладки
        console.log('=== SQL DEBUG ===');
        console.log('Query:', query);
        console.log('Params:', queryParams);
        console.log('================');
        
        const result = await pool.query(query, queryParams);
        
        // Get total count for pagination
        let countQuery = `
            SELECT COUNT(*) as total
            FROM coin_catalog 
            WHERE 1=1
        `;
        
        const countParams = [];
        let countParamIndex = 1;
        
        if (search) {
            countQuery += ` AND (
                denomination ILIKE $${countParamIndex} OR 
                coin_name ILIKE $${countParamIndex} OR 
                (original_description ILIKE $${countParamIndex} AND original_description NOT ILIKE $${countParamIndex + 1})
            )`;
            countParams.push(`%${search}%`);
            countParams.push(`%рублей%${search}%`);
            countParamIndex += 2;
        }
        
        if (denomination) {
            countQuery += ` AND denomination = $${countParamIndex}`;
            countParams.push(denomination);
            countParamIndex++;
        }
        
        if (metal) {
            countQuery += ` AND metal = $${countParamIndex}`;
            countParams.push(metal);
            countParamIndex++;
        }
        
        if (rarity) {
            countQuery += ` AND rarity = $${countParamIndex}`;
            countParams.push(rarity);
            countParamIndex++;
        }
        
        if (year) {
            countQuery += ` AND year = $${countParamIndex}`;
            countParams.push(parseInt(year));
            countParamIndex++;
        }
        
        if (yearFrom) {
            countQuery += ` AND year >= $${countParamIndex}`;
            countParams.push(parseInt(yearFrom));
            countParamIndex++;
        }
        
        if (yearTo) {
            countQuery += ` AND year <= $${countParamIndex}`;
            countParams.push(parseInt(yearTo));
            countParamIndex++;
        }
        
        if (mint) {
            countQuery += ` AND mint ILIKE $${countParamIndex}`;
            countParams.push(`%${mint}%`);
            countParamIndex++;
        }
        
        if (minMintage) {
            countQuery += ` AND mintage >= $${countParamIndex}`;
            countParams.push(parseInt(minMintage));
            countParamIndex++;
        }
        
        if (maxMintage) {
            countQuery += ` AND mintage <= $${countParamIndex}`;
            countParams.push(parseInt(maxMintage));
            countParamIndex++;
        }
        
        const countResult = await pool.query(countQuery, countParams);
        const total = parseInt(countResult.rows[0].total);
        
        res.json({
            coins: result.rows,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: total,
                pages: Math.ceil(total / limit)
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения монет каталога:', error);
        res.status(500).json({ error: 'Ошибка получения монет каталога' });
    }
});

// Get filter options
app.get('/api/catalog/filters', async (req, res) => {
    try {
        const queries = {
            denominations: `
                SELECT denomination, COUNT(*) as count 
                FROM coin_catalog 
                WHERE denomination IS NOT NULL AND denomination != ''
                GROUP BY denomination 
                ORDER BY count DESC
            `,
            metals: `
                SELECT metal, COUNT(*) as count 
                FROM coin_catalog 
                WHERE metal IS NOT NULL AND metal != ''
                GROUP BY metal 
                ORDER BY count DESC
            `,
            rarities: `
                SELECT rarity, COUNT(*) as count 
                FROM coin_catalog 
                WHERE rarity IS NOT NULL AND rarity != ''
                GROUP BY rarity 
                ORDER BY 
                    CASE rarity 
                        WHEN 'R' THEN 1 
                        WHEN 'RR' THEN 2 
                        WHEN 'RRR' THEN 3 
                        ELSE 4 
                    END
            `,
            years: `
                SELECT year, COUNT(*) as count 
                FROM coin_catalog 
                WHERE year IS NOT NULL
                GROUP BY year 
                ORDER BY year DESC
            `,
            mints: `
                SELECT mint, COUNT(*) as count 
                FROM coin_catalog 
                WHERE mint IS NOT NULL AND mint != ''
                GROUP BY mint 
                ORDER BY count DESC
            `,
            countries: `
                SELECT country, COUNT(*) as count 
                FROM coin_catalog 
                WHERE country IS NOT NULL AND country != ''
                GROUP BY country 
                ORDER BY count DESC
            `
        };
        
        const results = {};
        
        for (const [key, query] of Object.entries(queries)) {
            const result = await pool.query(query);
            // Извлекаем только значения, без count, фильтруем null
            if (key === 'years') {
                results[key] = result.rows.map(row => row.year).filter(year => year !== null);
            } else {
                // Определяем правильное имя поля для каждого типа
                const fieldMap = {
                    'metals': 'metal',
                    'countries': 'country', 
                    'mints': 'mint',
                    'rarities': 'rarity'
                };
                const fieldName = fieldMap[key] || key.slice(0, -1);
                results[key] = result.rows
                    .map(row => row[fieldName])
                    .filter(value => value !== null && value !== '');
            }
        }
        
        res.json(results);
        
    } catch (error) {
        console.error('Ошибка получения фильтров каталога:', error);
        res.status(500).json({ error: 'Ошибка получения фильтров каталога' });
    }
});

// Get single coin details
app.get('/api/catalog/coins/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const query = `
            SELECT 
                id, lot_id, denomination, coin_name, year, metal, rarity,
                mint, mintage, condition,
                bitkin_info, uzdenikov_info, ilyin_info, 
                petrov_info, severin_info, dyakov_info,
                avers_image_path, revers_image_path,
                avers_image_url, revers_image_url,
                coin_weight, fineness, pure_metal_weight, weight_oz,
                auction_number, lot_number,
                original_description, parsed_at
            FROM coin_catalog
            WHERE id = $1
        `;
        
        const result = await pool.query(query, [id]);
        
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
        
        const column = type === 'avers' ? 'avers_image_data' : 'revers_image_data';
        const query = `SELECT ${column} FROM coin_catalog WHERE id = $1`;
        
        const result = await pool.query(query, [coin_id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Монета не найдена' });
        }
        
        const imageData = result.rows[0][column];
        
        if (!imageData) {
            return res.status(404).json({ error: 'Изображение не найдено' });
        }
        
        // Определяем тип изображения по первым байтам
        let contentType = 'image/jpeg'; // по умолчанию
        if (imageData[0] === 0x89 && imageData[1] === 0x50 && imageData[2] === 0x4E && imageData[3] === 0x47) {
            contentType = 'image/png';
        } else if (imageData[0] === 0x47 && imageData[1] === 0x49 && imageData[2] === 0x46) {
            contentType = 'image/gif';
        }
        
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=31536000'); // Кешируем на год
        res.send(imageData);
        
    } catch (error) {
        console.error('Ошибка получения изображения:', error);
        res.status(500).json({ error: 'Ошибка получения изображения' });
    }
});

// Export catalog to CSV
app.get('/api/catalog/export/csv', async (req, res) => {
    try {
        const query = `
            SELECT 
                denomination, coin_name, year, metal, rarity,
                mint, mintage,
                bitkin_info, uzdenikov_info, ilyin_info, 
                petrov_info, severin_info, dyakov_info,
                auction_number, lot_number
            FROM coin_catalog 
            ORDER BY year DESC, denomination ASC, coin_name ASC
        `;
        
        const result = await pool.query(query);
        
        // Create CSV content
        const headers = [
            'Номинал', 'Название', 'Год', 'Металл', 'Редкость',
            'Монетный двор', 'Тираж',
            'Биткин', 'Уздеников', 'Ильин', 'Петров', 'Северин', 'Дьяков',
            'Аукцион', 'Лот'
        ];
        
        const csvContent = [
            headers.join(','),
            ...result.rows.map(coin => [
                `"${coin.denomination}"`,
                `"${coin.coin_name || ''}"`,
                coin.year || '',
                coin.metal || '',
                coin.rarity || '',
                `"${coin.mint || ''}"`,
                coin.mintage || '',
                `"${coin.bitkin_info || ''}"`,
                `"${coin.uzdenikov_info || ''}"`,
                `"${coin.ilyin_info || ''}"`,
                `"${coin.petrov_info || ''}"`,
                `"${coin.severin_info || ''}"`,
                `"${coin.dyakov_info || ''}"`,
                coin.auction_number || '',
                coin.lot_number || ''
            ].join(','))
        ].join('\n');
        
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="coin_catalog.csv"');
        res.send('\ufeff' + csvContent); // UTF-8 BOM
        
    } catch (error) {
        console.error('Ошибка экспорта каталога:', error);
        res.status(500).json({ error: 'Ошибка экспорта каталога' });
    }
});

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
        
        req.user = user;
        next();
    } catch (error) {
        return res.status(403).json({ error: 'Ошибка проверки токена' });
    }
};

// ===== AUTHENTICATION API =====

// Регистрация пользователя
app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, password, email, fullName } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'Имя пользователя и пароль обязательны' });
        }

        if (password.length < 6) {
            return res.status(400).json({ error: 'Пароль должен содержать минимум 6 символов' });
        }

        const user = await authService.register(username, password, email, fullName);
        res.status(201).json({ message: 'Пользователь успешно зарегистрирован', user });

    } catch (error) {
        console.error('Ошибка регистрации:', error);
        res.status(400).json({ error: error.message });
    }
});

// Авторизация пользователя
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'Имя пользователя и пароль обязательны' });
        }

        const result = await authService.login(username, password);
        res.json(result);

    } catch (error) {
        console.error('Ошибка авторизации:', error);
        res.status(401).json({ error: error.message });
    }
});

// Получение профиля пользователя
app.get('/api/auth/profile', authenticateToken, async (req, res) => {
    try {
        res.json({ user: req.user });
    } catch (error) {
        console.error('Ошибка получения профиля:', error);
        res.status(500).json({ error: 'Ошибка получения профиля' });
    }
});

// ===== COLLECTION API =====

// Получить коллекцию пользователя
app.get('/api/collection', authenticateToken, async (req, res) => {
    try {
        const { page = 1, limit = 20, ...filters } = req.query;
        const result = await collectionService.getUserCollection(
            req.user.id, 
            parseInt(page), 
            parseInt(limit), 
            filters
        );
        res.json(result);
    } catch (error) {
        console.error('Ошибка получения коллекции:', error);
        res.status(500).json({ error: 'Ошибка получения коллекции' });
    }
});

// Добавить монету в коллекцию
app.post('/api/collection/add', authenticateToken, async (req, res) => {
    try {
        const { coinId, notes, conditionRating, purchasePrice, purchaseDate } = req.body;

        if (!coinId) {
            return res.status(400).json({ error: 'ID монеты обязателен' });
        }

        const result = await collectionService.addToCollection(
            req.user.id, 
            coinId, 
            notes, 
            conditionRating, 
            purchasePrice, 
            purchaseDate
        );
        res.status(201).json({ message: 'Монета добавлена в коллекцию', result });

    } catch (error) {
        console.error('Ошибка добавления в коллекцию:', error);
        res.status(400).json({ error: error.message });
    }
});

// Удалить монету из коллекции
app.delete('/api/collection/remove', authenticateToken, async (req, res) => {
    try {
        const { coinId } = req.body;

        if (!coinId) {
            return res.status(400).json({ error: 'ID монеты обязателен' });
        }

        await collectionService.removeFromCollection(req.user.id, coinId);
        res.json({ message: 'Монета удалена из коллекции' });

    } catch (error) {
        console.error('Ошибка удаления из коллекции:', error);
        res.status(400).json({ error: error.message });
    }
});

// Обновить информацию о монете в коллекции
app.put('/api/collection/update', authenticateToken, async (req, res) => {
    try {
        const { coinId, ...updates } = req.body;

        if (!coinId) {
            return res.status(400).json({ error: 'ID монеты обязателен' });
        }

        const result = await collectionService.updateCollectionItem(req.user.id, coinId, updates);
        res.json({ message: 'Информация о монете обновлена', result });

    } catch (error) {
        console.error('Ошибка обновления коллекции:', error);
        res.status(400).json({ error: error.message });
    }
});

// Проверить, есть ли монета в коллекции
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

// Получить статистику коллекции
app.get('/api/collection/stats', authenticateToken, async (req, res) => {
    try {
        const stats = await collectionService.getCollectionStats(req.user.id);
        res.json(stats);
    } catch (error) {
        console.error('Ошибка получения статистики:', error);
        res.status(500).json({ error: 'Ошибка получения статистики' });
    }
});

// ===== PRICE PREDICTION API =====

// Пересчет прогнозных цен для всей коллекции пользователя
app.post('/api/collection/recalculate-prices', authenticateToken, async (req, res) => {
    try {
        console.log(`🔄 Пересчет прогнозных цен для пользователя ${req.user.id}`);
        
        // Инициализируем сервис если еще не инициализирован
        if (!collectionPriceService.calibrationTable) {
            await collectionPriceService.init();
        }
        
        const result = await collectionPriceService.recalculateUserCollectionPrices(req.user.id);
        
        res.json({
            message: 'Прогнозные цены пересчитаны',
            updated: result.updated,
            errors: result.errors,
            totalProcessed: result.updated + result.errors
        });
        
    } catch (error) {
        console.error('Ошибка пересчета прогнозных цен:', error);
        res.status(500).json({ error: 'Ошибка пересчета прогнозных цен' });
    }
});

// Получение суммарной прогнозной стоимости коллекции
app.get('/api/collection/total-value', authenticateToken, async (req, res) => {
    try {
        const totalValue = await collectionPriceService.getCollectionTotalValue(req.user.id);
        res.json(totalValue);
    } catch (error) {
        console.error('Ошибка получения суммарной стоимости:', error);
        res.status(500).json({ error: 'Ошибка получения суммарной стоимости' });
    }
});

// Получение прогнозной цены для конкретной монеты
app.get('/api/collection/coin/:coinId/predicted-price', authenticateToken, async (req, res) => {
    try {
        const { coinId } = req.params;
        const predictedPrice = await collectionPriceService.getCoinPredictedPrice(req.user.id, parseInt(coinId));
        
        if (!predictedPrice) {
            return res.status(404).json({ error: 'Монета не найдена в коллекции' });
        }
        
        res.json(predictedPrice);
    } catch (error) {
        console.error('Ошибка получения прогнозной цены:', error);
        res.status(500).json({ error: 'Ошибка получения прогнозной цены' });
    }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Сервер каталога запущен на порту ${PORT}`);
    console.log(`📊 Каталог доступен по адресу: http://localhost:${PORT}`);
    console.log(`🔐 API аутентификации: http://localhost:${PORT}/api/auth/`);
    console.log(`📚 API коллекций: http://localhost:${PORT}/api/collection/`);
});

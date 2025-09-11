const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const cors = require('cors');
const config = require('./config');

const app = express();
const pool = new Pool(config.dbConfig);

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
            mint,
            country,
            minMintage,
            maxMintage
        } = req.query;
        
        let query = `
            SELECT 
                id, denomination, coin_name, year, metal, rarity,
                mint, mintage, condition, country,
                bitkin_info, uzdenikov_info, ilyin_info, 
                petrov_info, severin_info, dyakov_info,
                avers_image_path, revers_image_path,
                avers_image_url, revers_image_url,
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
            query += ` AND (coin_name ILIKE $${paramIndex} OR original_description ILIKE $${paramIndex})`;
            queryParams.push(`%${search}%`);
            paramIndex++;
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
            countQuery += ` AND (coin_name ILIKE $${countParamIndex} OR original_description ILIKE $${countParamIndex})`;
            countParams.push(`%${search}%`);
            countParamIndex++;
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
            `
        };
        
        const results = {};
        
        for (const [key, query] of Object.entries(queries)) {
            const result = await pool.query(query);
            results[key] = result.rows;
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
                id, denomination, coin_name, year, metal, rarity,
                mint, mintage, condition,
                bitkin_info, uzdenikov_info, ilyin_info, 
                petrov_info, severin_info, dyakov_info,
                avers_image_path, revers_image_path,
                avers_image_url, revers_image_url,
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
app.get('/api/catalog/coins/:id/image/:type', async (req, res) => {
    try {
        const { id, type } = req.params;
        
        if (!['avers', 'revers'].includes(type)) {
            return res.status(400).json({ error: 'Неверный тип изображения' });
        }
        
        const column = type === 'avers' ? 'avers_image_data' : 'revers_image_data';
        const query = `SELECT ${column} FROM coin_catalog WHERE id = $1`;
        
        const result = await pool.query(query, [id]);
        
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
                mint, mintage, condition,
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
            'Монетный двор', 'Тираж', 'Состояние',
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
                `"${coin.condition || ''}"`,
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

// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`🚀 Сервер каталога запущен на порту ${PORT}`);
    console.log(`📊 Каталог доступен по адресу: http://localhost:${PORT}`);
});

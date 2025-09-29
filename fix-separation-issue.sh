#!/bin/bash

# Исправление разделения основного сайта и каталога
# Основной сайт на порту 3001, каталог на порту 3000

echo "🔧 ИСПРАВЛЕНИЕ РАЗДЕЛЕНИЯ САЙТОВ..."
echo "================================="

echo "📊 ЭТАП 1: Проверка текущего состояния..."
echo "======================================"

echo "🔍 Статус PM2:"
pm2 status

echo ""
echo "📊 ЭТАП 2: Остановка всех процессов..."
echo "==================================="

pm2 stop all 2>/dev/null || true
pm2 delete all 2>/dev/null || true

echo "✅ Все процессы остановлены"

echo ""
echo "📊 ЭТАП 3: Восстановление основного сайта..."
echo "=========================================="

cd /var/www/wolmar-parser

echo "📋 Проверка основного server.js:"
if [ -f "server.js" ]; then
    echo "✅ server.js найден"
    echo "📋 Размер: $(wc -l < server.js) строк"
    
    # Проверяем есть ли API эндпоинты
    if grep -q "app.get.*api.*auctions" server.js; then
        echo "✅ API эндпоинты найдены в основном server.js"
    else
        echo "❌ API эндпоинты отсутствуют в основном server.js"
        echo "🔄 Восстановление API эндпоинтов..."
        
        # Создаем резервную копию
        cp server.js server.js.backup
        
        # Добавляем API эндпоинты
        cat > temp_api_endpoints.js << 'EOF'
// API эндпоинты для основного сайта
app.get('/api/auctions', async (req, res) => {
    try {
        console.log('📊 API: Запрос списка аукционов');
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
        console.log(`📊 API: Найдено ${result.rows.length} аукционов`);
        res.json(result.rows);
    } catch (error) {
        console.error('❌ API: Ошибка получения аукционов:', error);
        res.status(500).json({ error: 'Ошибка получения данных об аукционах' });
    }
});

app.get('/api/auctions/:auctionNumber/lots', async (req, res) => {
    try {
        const { auctionNumber } = req.params;
        const { page = 1, limit = 20, search, metal, condition, year, minPrice, maxPrice } = req.query;
        
        console.log(`📊 API: Запрос лотов аукциона ${auctionNumber}`);
        
        const offset = (page - 1) * limit;
        let whereClause = 'WHERE auction_number = $1';
        const queryParams = [auctionNumber];
        let paramCount = 1;
        
        if (search) {
            paramCount++;
            whereClause += ` AND coin_description ILIKE $${paramCount}`;
            queryParams.push(`%${search}%`);
        }
        
        if (metal) {
            paramCount++;
            whereClause += ` AND metal = $${paramCount}`;
            queryParams.push(metal);
        }
        
        if (condition) {
            paramCount++;
            whereClause += ` AND condition = $${paramCount}`;
            queryParams.push(condition);
        }
        
        if (year) {
            paramCount++;
            whereClause += ` AND year = $${paramCount}`;
            queryParams.push(year);
        }
        
        if (minPrice) {
            paramCount++;
            whereClause += ` AND winning_bid >= $${paramCount}`;
            queryParams.push(parseFloat(minPrice));
        }
        
        if (maxPrice) {
            paramCount++;
            whereClause += ` AND winning_bid <= $${paramCount}`;
            queryParams.push(parseFloat(maxPrice));
        }
        
        const query = `
            SELECT 
                id, lot_number, coin_description, avers_image_url, revers_image_url,
                winner_login, winning_bid, auction_end_date, bids_count,
                metal, condition, year
            FROM auction_lots 
            ${whereClause}
            ORDER BY lot_number::int
            LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
        `;
        
        queryParams.push(parseInt(limit), offset);
        
        const result = await pool.query(query, queryParams);
        console.log(`📊 API: Найдено ${result.rows.length} лотов для аукциона ${auctionNumber}`);
        res.json(result.rows);
    } catch (error) {
        console.error('❌ API: Ошибка получения лотов:', error);
        res.status(500).json({ error: 'Ошибка получения данных о лотах' });
    }
});

app.get('/api/lots/:id', async (req, res) => {
    try {
        const { id } = req.params;
        console.log(`📊 API: Запрос деталей лота ${id}`);
        const query = `
            SELECT 
                id, lot_number, auction_number, coin_description,
                avers_image_url, revers_image_url, winner_login,
                winning_bid, auction_end_date, bids_count,
                metal, condition, year
            FROM auction_lots 
            WHERE id = $1
        `;
        
        const result = await pool.query(query, [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Лот не найден' });
        }
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error('❌ API: Ошибка получения лота:', error);
        res.status(500).json({ error: 'Ошибка получения данных о лоте' });
    }
});

app.get('/api/auctions/:auctionNumber/stats', async (req, res) => {
    try {
        const { auctionNumber } = req.params;
        console.log(`📊 API: Запрос статистики аукциона ${auctionNumber}`);
        const query = `
            SELECT 
                COUNT(*) as total_lots,
                SUM(winning_bid) as total_value,
                AVG(winning_bid) as avg_bid,
                MAX(winning_bid) as max_bid,
                MIN(winning_bid) as min_bid,
                COUNT(DISTINCT winner_login) as unique_winners,
                COUNT(DISTINCT metal) as unique_metals,
                COUNT(DISTINCT condition) as unique_conditions
            FROM auction_lots 
            WHERE auction_number = $1
        `;
        
        const result = await pool.query(query, [auctionNumber]);
        res.json(result.rows[0]);
    } catch (error) {
        console.error('❌ API: Ошибка получения статистики:', error);
        res.status(500).json({ error: 'Ошибка получения статистики аукциона' });
    }
});

app.get('/api/filters', async (req, res) => {
    try {
        const { auctionNumber } = req.query;
        console.log(`📊 API: Запрос фильтров для аукциона ${auctionNumber || 'всех'}`);
        let whereClause = '';
        const queryParams = [];
        
        if (auctionNumber) {
            whereClause = 'WHERE auction_number = $1';
            queryParams.push(auctionNumber);
        }
        
        const query = `
            SELECT 
                metal,
                condition,
                year
            FROM auction_lots 
            ${whereClause}
            GROUP BY metal, condition, year
            ORDER BY metal, condition, year
        `;
        
        const result = await pool.query(query, queryParams);
        
        const filters = {
            metals: [...new Set(result.rows.map(row => row.metal).filter(Boolean))],
            conditions: [...new Set(result.rows.map(row => row.condition).filter(Boolean))],
            years: [...new Set(result.rows.map(row => row.year).filter(Boolean))].sort()
        };
        
        res.json(filters);
    } catch (error) {
        console.error('❌ API: Ошибка получения фильтров:', error);
        res.status(500).json({ error: 'Ошибка получения фильтров' });
    }
});
EOF
        
        # Находим строку с catch-all route
        CATCH_ALL_LINE=$(grep -n "app.get('*'" server.js | head -1 | cut -d: -f1)
        
        if [ -n "$CATCH_ALL_LINE" ]; then
            echo "📋 Найдена catch-all route на строке $CATCH_ALL_LINE"
            
            # Создаем новый server.js с API эндпоинтами
            head -n $((CATCH_ALL_LINE - 1)) server.js > temp_server.js
            cat temp_api_endpoints.js >> temp_server.js
            tail -n +$CATCH_ALL_LINE server.js >> temp_server.js
            
            mv temp_server.js server.js
            echo "✅ API эндпоинты добавлены в основной server.js"
        else
            echo "❌ Catch-all route не найден"
        fi
        
        rm -f temp_api_endpoints.js
    fi
else
    echo "❌ server.js не найден"
    exit 1
fi

echo ""
echo "📊 ЭТАП 4: Запуск основного сайта на порту 3001..."
echo "================================================"

# Запуск основного сайта на порту 3001
pm2 start server.js --name "wolmar-parser" -- --port 3001

if [ $? -eq 0 ]; then
    echo "✅ Основной сайт запущен на порту 3001"
else
    echo "❌ Ошибка запуска основного сайта"
    exit 1
fi

echo ""
echo "📊 ЭТАП 5: Запуск каталога на порту 3000..."
echo "=========================================="

cd /var/www/catalog-interface

# Проверяем есть ли каталог
if [ -f "server.js" ]; then
    echo "✅ Каталог найден"
    
    # Запуск каталога на порту 3000
    pm2 start server.js --name "catalog-interface"
    
    if [ $? -eq 0 ]; then
        echo "✅ Каталог запущен на порту 3000"
    else
        echo "❌ Ошибка запуска каталога"
    fi
else
    echo "❌ Каталог не найден"
    echo "🔄 Создание каталога..."
    
    # Создаем каталог если его нет
    mkdir -p /var/www/catalog-interface
    cd /var/www/catalog-interface
    
    # Создаем package.json для каталога
    cat > package.json << 'EOF'
{
  "name": "catalog-interface",
  "version": "1.0.0",
  "description": "Каталог монет Wolmar",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "cors": "^2.8.5",
    "pg": "^8.11.3"
  }
}
EOF
    
    # Создаем server.js для каталога
    cat > server.js << 'EOF'
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');

// Конфигурация базы данных
const dbConfig = {
    user: 'postgres.xkwgspqwebfeteoblayu',
    host: 'aws-0-eu-north-1.pooler.supabase.com',
    database: 'postgres',
    password: 'Gopapopa326+',
    port: 6543,
    ssl: {
        rejectUnauthorized: false
    }
};

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Подключение к базе данных
const pool = new Pool(dbConfig);

// Обработчики подключения к БД
pool.on('connect', () => {
    console.log('🗄️ КАТАЛОГ: Подключение к базе данных установлено');
});

pool.on('error', (err) => {
    console.error('❌ КАТАЛОГ: Ошибка подключения к базе данных:', err);
});

// Тестовый API
app.get('/api/test', (req, res) => {
    console.log('🧪 КАТАЛОГ: Тестовый запрос');
    res.json({ 
        message: 'Каталог монет работает!', 
        timestamp: new Date().toISOString(),
        port: PORT,
        status: 'ok'
    });
});

// API для получения списка аукционов
app.get('/api/auctions', async (req, res) => {
    try {
        console.log('📊 КАТАЛОГ: Запрос списка аукционов');
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
        console.log(`📊 КАТАЛОГ: Найдено ${result.rows.length} аукционов`);
        res.json(result.rows);
    } catch (error) {
        console.error('❌ КАТАЛОГ: Ошибка получения аукционов:', error);
        res.status(500).json({ error: 'Ошибка получения данных об аукционах' });
    }
});

// API для получения лотов аукциона
app.get('/api/auctions/:auctionNumber/lots', async (req, res) => {
    try {
        const { auctionNumber } = req.params;
        console.log(`📊 КАТАЛОГ: Запрос лотов аукциона ${auctionNumber}`);
        
        const query = `
            SELECT 
                id, lot_number, coin_description, avers_image_url, revers_image_url,
                winner_login, winning_bid, auction_end_date, bids_count,
                metal, condition, year
            FROM auction_lots 
            WHERE auction_number = $1
            ORDER BY lot_number::int
        `;
        
        const result = await pool.query(query, [auctionNumber]);
        console.log(`📊 КАТАЛОГ: Найдено ${result.rows.length} лотов для аукциона ${auctionNumber}`);
        res.json(result.rows);
    } catch (error) {
        console.error('❌ КАТАЛОГ: Ошибка получения лотов:', error);
        res.status(500).json({ error: 'Ошибка получения данных о лотах' });
    }
});

// API для получения деталей лота
app.get('/api/lots/:id', async (req, res) => {
    try {
        const { id } = req.params;
        console.log(`📊 КАТАЛОГ: Запрос деталей лота ${id}`);
        
        const query = `
            SELECT 
                id, lot_number, auction_number, coin_description,
                avers_image_url, revers_image_url, winner_login,
                winning_bid, auction_end_date, bids_count,
                metal, condition, year
            FROM auction_lots 
            WHERE id = $1
        `;
        
        const result = await pool.query(query, [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Лот не найден' });
        }
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error('❌ КАТАЛОГ: Ошибка получения лота:', error);
        res.status(500).json({ error: 'Ошибка получения данных о лоте' });
    }
});

// API для получения статистики аукциона
app.get('/api/auctions/:auctionNumber/stats', async (req, res) => {
    try {
        const { auctionNumber } = req.params;
        console.log(`📊 КАТАЛОГ: Запрос статистики аукциона ${auctionNumber}`);
        
        const query = `
            SELECT 
                COUNT(*) as total_lots,
                SUM(winning_bid) as total_value,
                AVG(winning_bid) as avg_bid,
                MAX(winning_bid) as max_bid,
                MIN(winning_bid) as min_bid,
                COUNT(DISTINCT winner_login) as unique_winners,
                COUNT(DISTINCT metal) as unique_metals,
                COUNT(DISTINCT condition) as unique_conditions
            FROM auction_lots 
            WHERE auction_number = $1
        `;
        
        const result = await pool.query(query, [auctionNumber]);
        res.json(result.rows[0]);
    } catch (error) {
        console.error('❌ КАТАЛОГ: Ошибка получения статистики:', error);
        res.status(500).json({ error: 'Ошибка получения статистики аукциона' });
    }
});

// API для получения фильтров
app.get('/api/filters', async (req, res) => {
    try {
        const { auctionNumber } = req.query;
        console.log(`📊 КАТАЛОГ: Запрос фильтров для аукциона ${auctionNumber || 'всех'}`);
        
        let whereClause = '';
        const queryParams = [];
        
        if (auctionNumber) {
            whereClause = 'WHERE auction_number = $1';
            queryParams.push(auctionNumber);
        }
        
        const query = `
            SELECT 
                metal,
                condition,
                year
            FROM auction_lots 
            ${whereClause}
            GROUP BY metal, condition, year
            ORDER BY metal, condition, year
        `;
        
        const result = await pool.query(query, queryParams);
        
        const filters = {
            metals: [...new Set(result.rows.map(row => row.metal).filter(Boolean))],
            conditions: [...new Set(result.rows.map(row => row.condition).filter(Boolean))],
            years: [...new Set(result.rows.map(row => row.year).filter(Boolean))].sort()
        };
        
        res.json(filters);
    } catch (error) {
        console.error('❌ КАТАЛОГ: Ошибка получения фильтров:', error);
        res.status(500).json({ error: 'Ошибка получения фильтров' });
    }
});

// Catch-all handler для SPA
app.get('*', (req, res) => {
    console.log(`🌐 КАТАЛОГ: Запрос страницы ${req.path}`);
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Запуск сервера
app.listen(PORT, () => {
    console.log(`🚀 КАТАЛОГ МОНЕТ запущен на порту ${PORT}`);
    console.log(`📊 API каталога: http://localhost:${PORT}/api`);
    console.log(`🌐 Веб-интерфейс каталога: http://localhost:${PORT}`);
    console.log(`🔗 Внешний доступ: http://46.173.19.68:${PORT}`);
    console.log(`🧪 Тестовый API: http://localhost:${PORT}/api/test`);
});
EOF
    
    # Устанавливаем зависимости
    npm install
    
    # Запускаем каталог
    pm2 start server.js --name "catalog-interface"
    
    if [ $? -eq 0 ]; then
        echo "✅ Каталог создан и запущен на порту 3000"
    else
        echo "❌ Ошибка создания каталога"
    fi
fi

echo ""
echo "⏳ ЭТАП 6: Ожидание запуска..."
echo "============================="

sleep 5

echo ""
echo "📊 ЭТАП 7: Проверка работы обоих сайтов..."
echo "======================================="

echo "🔍 Статус PM2:"
pm2 status

echo ""
echo "🧪 Тестирование основного сайта:"
curl -s http://localhost:3001/api/health > /dev/null
if [ $? -eq 0 ]; then
    echo "✅ Основной сайт работает на порту 3001"
else
    echo "❌ Основной сайт не работает на порту 3001"
fi

echo ""
echo "🧪 Тестирование каталога:"
curl -s http://localhost:3000/api/test > /dev/null
if [ $? -eq 0 ]; then
    echo "✅ Каталог работает на порту 3000"
else
    echo "❌ Каталог не работает на порту 3000"
fi

echo ""
echo "📊 ЭТАП 8: Тестирование внешнего доступа..."
echo "========================================"

echo "🌐 Основной сайт:"
curl -s http://46.173.19.68:3001/api/health > /dev/null
if [ $? -eq 0 ]; then
    echo "✅ Основной сайт доступен: http://46.173.19.68:3001"
else
    echo "❌ Основной сайт недоступен"
fi

echo ""
echo "🌐 Каталог:"
curl -s http://46.173.19.68:3000/api/test > /dev/null
if [ $? -eq 0 ]; then
    echo "✅ Каталог доступен: http://46.173.19.68:3000"
else
    echo "❌ Каталог недоступен"
fi

echo ""
echo "📊 ЭТАП 9: Проверка портов..."
echo "==========================="

echo "📋 Процессы на портах 3000-3001:"
netstat -tlnp | grep -E ":300[01]" || echo "Порты 3000-3001 не заняты"

echo ""
echo "📊 ЭТАП 10: Проверка логов..."
echo "==========================="

echo "📋 Логи основного сайта:"
pm2 logs wolmar-parser --lines 5

echo ""
echo "📋 Логи каталога:"
pm2 logs catalog-interface --lines 5

echo ""
echo "✅ ИСПРАВЛЕНИЕ РАЗДЕЛЕНИЯ САЙТОВ ЗАВЕРШЕНО!"
echo "========================================="
echo "🌐 Основной сайт: http://46.173.19.68:3001"
echo "🌐 Каталог монет: http://46.173.19.68:3000"
echo "📊 Мониторинг: pm2 status"
echo "📋 Логи основного сайта: pm2 logs wolmar-parser"
echo "📋 Логи каталога: pm2 logs catalog-interface"

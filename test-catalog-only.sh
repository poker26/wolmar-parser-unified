#!/bin/bash

# Тестирование каталога монет в изоляции
# Останавливает основной сайт и запускает только каталог

echo "🧪 ТЕСТИРОВАНИЕ КАТАЛОГА В ИЗОЛЯЦИИ..."
echo "===================================="

# Проверяем, что мы на сервере
if [ ! -f "/var/www/wolmar-parser/server.js" ]; then
    echo "❌ Ошибка: Скрипт должен запускаться на сервере в /var/www/wolmar-parser"
    exit 1
fi

cd /var/www/wolmar-parser

echo "📊 ЭТАП 1: Остановка основного сайта..."
echo "===================================="

echo "🔄 Остановка ВСЕХ процессов PM2..."
pm2 stop all 2>/dev/null || true
pm2 delete all 2>/dev/null || true

echo ""
echo "🔄 Убийство всех Node.js процессов..."
pkill -f "node.*server.js" || true
pkill -f "node.*3000" || true
pkill -f "node.*3001" || true
pkill -f "node.*3002" || true

echo ""
echo "🔄 Ожидание освобождения портов..."
sleep 3

echo ""
echo "🔍 Проверка что порты свободны:"
netstat -tlnp | grep -E ":(3000|3001|3002)" || echo "Порты свободны"

echo ""
echo "📊 ЭТАП 2: Подготовка каталога..."
echo "=============================="

echo "🔄 Переключение на ветку web-interface..."
git checkout web-interface --force

echo ""
echo "📦 Создание директории каталога..."
rm -rf /var/www/catalog-interface
mkdir -p /var/www/catalog-interface
cd /var/www/catalog-interface

echo ""
echo "📋 Копирование файлов каталога..."
cp -r /var/www/wolmar-parser/public/ ./
cp /var/www/wolmar-parser/package.json ./
cp /var/www/wolmar-parser/package-lock.json ./
cp /var/www/wolmar-parser/config.example.js ./

echo ""
echo "📝 Создание простого server.js для каталога..."
# Создаем максимально простой server.js для каталога
cat > server.js << 'EOF'
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');
const config = require('./config');

const app = express();
const PORT = 3000; // Используем порт 3000

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Database connection
const pool = new Pool(config.dbConfig);

// Test database connection
pool.on('connect', () => {
    console.log('🗄️ КАТАЛОГ: Подключение к базе данных установлено');
});

pool.on('error', (err) => {
    console.error('❌ КАТАЛОГ: Ошибка подключения к базе данных:', err);
});

// Простой API для тестирования
app.get('/api/test', (req, res) => {
    console.log('🧪 КАТАЛОГ: Тестовый запрос');
    res.json({ 
        message: 'Каталог монет работает!', 
        timestamp: new Date().toISOString(),
        port: PORT
    });
});

// Получить список всех аукционов
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

// Получить лоты конкретного аукциона
app.get('/api/auctions/:auctionNumber/lots', async (req, res) => {
    try {
        const { auctionNumber } = req.params;
        console.log(`📊 КАТАЛОГ: Запрос лотов аукциона ${auctionNumber}`);
        const { page = 1, limit = 20, search, metal, condition, year, minPrice, maxPrice } = req.query;
        
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
        console.log(`📊 КАТАЛОГ: Найдено ${result.rows.length} лотов для аукциона ${auctionNumber}`);
        res.json(result.rows);
    } catch (error) {
        console.error('❌ КАТАЛОГ: Ошибка получения лотов:', error);
        res.status(500).json({ error: 'Ошибка получения данных о лотах' });
    }
});

// Получить детальную информацию о лоте
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

// Получить статистику аукциона
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

// Получить доступные фильтры
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

// Catch-all handler для SPA каталога
app.get('*', (req, res) => {
    console.log(`🌐 КАТАЛОГ: Запрос страницы ${req.path}`);
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 КАТАЛОГ МОНЕТ запущен на порту ${PORT}`);
    console.log(`📊 API каталога: http://localhost:${PORT}/api`);
    console.log(`🌐 Веб-интерфейс каталога: http://localhost:${PORT}`);
    console.log(`🔗 Внешний доступ: http://46.173.19.68:${PORT}`);
    console.log(`🧪 Тестовый API: http://localhost:${PORT}/api/test`);
});
EOF

echo "✅ Простой server.js создан для каталога"

echo ""
echo "⚙️ ЭТАП 3: Настройка конфигурации..."
cp config.example.js config.js

# Проверяем и исправляем конфигурацию БД
if ! grep -q "postgres.xkwgspqwebfeteoblayu" config.js; then
    echo "⚠️ Конфигурация БД не найдена, создаем..."
    cat > config.js << 'EOF'
module.exports = {
    dbConfig: {
        user: 'postgres.xkwgspqwebfeteoblayu',
        host: 'aws-0-eu-north-1.pooler.supabase.com',
        database: 'postgres',
        password: 'Gopapopa326+',
        port: 6543,
        ssl: {
            rejectUnauthorized: false
        }
    }
};
EOF
    echo "✅ Конфигурация БД создана"
else
    echo "✅ Конфигурация БД найдена"
fi

echo ""
echo "📦 ЭТАП 4: Установка зависимостей..."
npm install

if [ $? -eq 0 ]; then
    echo "✅ Зависимости установлены"
else
    echo "❌ Ошибка установки зависимостей"
    exit 1
fi

echo ""
echo "🧪 ЭТАП 5: Тестирование server.js..."
node -c server.js
if [ $? -eq 0 ]; then
    echo "✅ server.js синтаксически корректен"
else
    echo "❌ Ошибка синтаксиса в server.js"
    exit 1
fi

echo ""
echo "🚀 ЭТАП 6: Запуск каталога монет..."
pm2 start server.js --name "catalog-interface"

if [ $? -eq 0 ]; then
    echo "✅ Каталог монет запущен через PM2"
else
    echo "❌ Ошибка запуска каталога монет"
    exit 1
fi

echo ""
echo "⏳ ЭТАП 7: Ожидание запуска каталога..."
sleep 5

echo ""
echo "📊 ЭТАП 8: Тестирование каталога..."
echo "================================="

echo "🔍 Статус PM2:"
pm2 status

echo ""
echo "🔍 Процессы на портах:"
netstat -tlnp | grep -E ":(3000|3001|3002)"

echo ""
echo "🧪 Тестирование тестового API:"
curl -s http://localhost:3000/api/test
if [ $? -eq 0 ]; then
    echo "✅ Тестовый API работает"
else
    echo "❌ Тестовый API не работает"
fi

echo ""
echo "🌐 Тестирование API аукционов:"
curl -s http://localhost:3000/api/auctions > /dev/null
if [ $? -eq 0 ]; then
    echo "✅ API аукционов работает"
else
    echo "❌ API аукционов не работает"
fi

echo ""
echo "🌐 Тестирование веб-интерфейса:"
curl -s http://localhost:3000/ | grep -o '<title>.*</title>' || echo "Заголовок не найден"

echo ""
echo "🌐 Тестирование внешнего доступа:"
curl -s http://46.173.19.68:3000/api/test
if [ $? -eq 0 ]; then
    echo "✅ Внешний доступ к каталогу работает"
    echo "🌐 Каталог доступен: http://46.173.19.68:3000"
else
    echo "❌ Внешний доступ к каталогу не работает"
fi

echo ""
echo "📋 Логи каталога:"
pm2 logs catalog-interface --lines 10

echo ""
echo "✅ ТЕСТИРОВАНИЕ КАТАЛОГА ЗАВЕРШЕНО!"
echo "============================================="
echo "🌐 Каталог монет: http://46.173.19.68:3000"
echo "🧪 Тестовый API: http://46.173.19.68:3000/api/test"
echo "📊 API аукционов: http://46.173.19.68:3000/api/auctions"
echo "📊 Мониторинг: pm2 status"
echo "📋 Логи каталога: pm2 logs catalog-interface"

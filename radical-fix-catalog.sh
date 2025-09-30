#!/bin/bash

# Радикальное исправление проблемы с каталогом
# Полная диагностика и исправление всех возможных проблем

echo "🔥 РАДИКАЛЬНОЕ ИСПРАВЛЕНИЕ КАТАЛОГА..."
echo "===================================="

# Проверяем, что мы на сервере
if [ ! -f "/var/www/wolmar-parser/server.js" ]; then
    echo "❌ Ошибка: Скрипт должен запускаться на сервере в /var/www/wolmar-parser"
    exit 1
fi

cd /var/www/wolmar-parser

echo "📊 ЭТАП 1: Полная диагностика системы..."
echo "====================================="

echo "🔍 Проверка PM2 процессов:"
pm2 status

echo ""
echo "🔍 Проверка процессов на портах:"
netstat -tlnp | grep -E ":(3000|3001)"

echo ""
echo "🔍 Проверка содержимого порта 3001:"
curl -s http://localhost:3001/ | grep -o '<title>.*</title>' || echo "Не удалось получить заголовок"

echo ""
echo "🔍 Проверка содержимого порта 3000:"
curl -s http://localhost:3000/ | grep -o '<title>.*</title>' || echo "Не удалось получить заголовок"

echo ""
echo "📊 ЭТАП 2: Полная очистка системы..."
echo "================================="

echo "🔄 Остановка ВСЕХ процессов PM2..."
pm2 stop all
pm2 delete all

echo ""
echo "🔄 Убийство всех процессов на портах 3000 и 3001..."
pkill -f "node.*server.js" || true
pkill -f "node.*3000" || true
pkill -f "node.*3001" || true

echo ""
echo "🔄 Ожидание освобождения портов..."
sleep 3

echo ""
echo "🔍 Проверка что порты свободны:"
netstat -tlnp | grep -E ":(3000|3001)" || echo "Порты свободны"

echo ""
echo "📊 ЭТАП 3: Пересоздание основного сервера..."
echo "=========================================="

echo "🔄 Переключение на основную ветку..."
git checkout catalog-parser --force
git pull origin catalog-parser

echo ""
echo "🚀 Запуск основного сервера..."
pm2 start ecosystem.config.js

echo ""
echo "⏳ Ожидание запуска основного сервера..."
sleep 5

echo ""
echo "🔍 Проверка основного сервера..."
curl -s http://localhost:3001/api/health > /dev/null
if [ $? -eq 0 ]; then
    echo "✅ Основной сервер работает на порту 3001"
else
    echo "❌ Основной сервер не работает"
    pm2 logs wolmar-parser --lines 10
    exit 1
fi

echo ""
echo "📊 ЭТАП 4: Создание каталога с нуля..."
echo "===================================="

echo "🔄 Переключение на ветку web-interface..."
git checkout web-interface --force

echo ""
echo "📦 Создание новой директории каталога..."
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
echo "📝 Создание УНИКАЛЬНОГО server.js для каталога..."
# Создаем server.js с уникальными логами и портом
cat > server.js << 'EOF'
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');
const config = require('./config');

const app = express();
const PORT = 3000; // Жестко задаем порт 3000

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

// API Routes для каталога

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
});
EOF

echo "✅ Уникальный server.js создан для каталога"

echo ""
echo "⚙️ ЭТАП 5: Настройка конфигурации..."
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
echo "📦 ЭТАП 6: Установка зависимостей..."
npm install

if [ $? -eq 0 ]; then
    echo "✅ Зависимости установлены"
else
    echo "❌ Ошибка установки зависимостей"
    exit 1
fi

echo ""
echo "🧪 ЭТАП 7: Тестирование server.js..."
node -c server.js
if [ $? -eq 0 ]; then
    echo "✅ server.js синтаксически корректен"
else
    echo "❌ Ошибка синтаксиса в server.js"
    exit 1
fi

echo ""
echo "🚀 ЭТАП 8: Запуск каталога монет..."
pm2 start server.js --name "catalog-interface"

if [ $? -eq 0 ]; then
    echo "✅ Каталог монет запущен через PM2"
else
    echo "❌ Ошибка запуска каталога монет"
    exit 1
fi

echo ""
echo "⏳ ЭТАП 9: Ожидание запуска каталога..."
sleep 5

echo ""
echo "📊 ЭТАП 10: Финальная проверка..."
echo "==============================="

echo "🔍 Статус PM2:"
pm2 status

echo ""
echo "🔍 Процессы на портах:"
netstat -tlnp | grep -E ":(3000|3001)"

echo ""
echo "🌐 Тестирование основного сервера (порт 3001):"
curl -s http://localhost:3001/api/health > /dev/null
if [ $? -eq 0 ]; then
    echo "✅ Основной сервер работает"
    curl -s http://localhost:3001/ | grep -o '<title>.*</title>' || echo "Не удалось получить заголовок"
else
    echo "❌ Основной сервер не работает"
fi

echo ""
echo "🌐 Тестирование каталога (порт 3000):"
curl -s http://localhost:3000/api/auctions > /dev/null
if [ $? -eq 0 ]; then
    echo "✅ Каталог монет работает"
    curl -s http://localhost:3000/ | grep -o '<title>.*</title>' || echo "Не удалось получить заголовок"
else
    echo "❌ Каталог монет не работает"
    echo "📋 Логи каталога:"
    pm2 logs catalog-interface --lines 10
fi

echo ""
echo "🔍 Сравнение содержимого портов:"
echo "📋 Первые 3 строки порта 3001:"
curl -s http://localhost:3001/ | head -3

echo ""
echo "📋 Первые 3 строки порта 3000:"
curl -s http://localhost:3000/ | head -3

echo ""
echo "✅ РАДИКАЛЬНОЕ ИСПРАВЛЕНИЕ ЗАВЕРШЕНО!"
echo "============================================="
echo "🌐 Основной сервер: http://46.173.19.68:3001"
echo "📚 Каталог монет: http://46.173.19.68:3000"
echo "📊 Мониторинг: pm2 status"
echo "📋 Логи каталога: pm2 logs catalog-interface"

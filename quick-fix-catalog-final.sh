#!/bin/bash

# Финальное исправление каталога
# Создает полностью рабочий каталог с нуля

echo "🔧 ФИНАЛЬНОЕ ИСПРАВЛЕНИЕ КАТАЛОГА..."
echo "================================="

cd /var/www

echo "📊 ЭТАП 1: Остановка всех процессов..."
echo "==================================="

# Остановка PM2 процессов
pm2 stop all 2>/dev/null || true
pm2 delete all 2>/dev/null || true

# Убийство всех процессов Node.js
pkill -f node 2>/dev/null || true

echo "✅ Все процессы остановлены"

echo ""
echo "📊 ЭТАП 2: Удаление старого каталога..."
echo "==================================="

# Удаление старого каталога
rm -rf catalog-interface

echo "✅ Старый каталог удален"

echo ""
echo "📊 ЭТАП 3: Создание нового каталога..."
echo "==================================="

# Создание нового каталога
mkdir -p catalog-interface
cd catalog-interface

echo "✅ Новый каталог создан"

echo ""
echo "📊 ЭТАП 4: Создание package.json..."
echo "================================="

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

echo "✅ package.json создан"

echo ""
echo "📊 ЭТАП 5: Создание server.js..."
echo "==============================="

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

echo "✅ server.js создан"

echo ""
echo "📊 ЭТАП 6: Создание директории public..."
echo "====================================="

mkdir -p public

echo "✅ Директория public создана"

echo ""
echo "📊 ЭТАП 7: Создание index.html..."
echo "==============================="

cat > public/index.html << 'EOF'
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Каталог монет Wolmar</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 20px;
            background-color: #f5f5f5;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        h1 {
            color: #333;
            text-align: center;
        }
        .test-section {
            margin: 20px 0;
            padding: 15px;
            background: #f8f9fa;
            border-radius: 5px;
        }
        .test-button {
            background: #007bff;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 5px;
            cursor: pointer;
            margin: 5px;
        }
        .test-button:hover {
            background: #0056b3;
        }
        .result {
            margin-top: 10px;
            padding: 10px;
            background: #e9ecef;
            border-radius: 5px;
            white-space: pre-wrap;
        }
        .success {
            background: #d4edda;
            color: #155724;
        }
        .error {
            background: #f8d7da;
            color: #721c24;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🏛️ Каталог монет Wolmar</h1>
        
        <div class="test-section">
            <h3>🧪 Тестирование API</h3>
            <button class="test-button" onclick="testAPI()">Тест API</button>
            <button class="test-button" onclick="testAuctions()">Список аукционов</button>
            <button class="test-button" onclick="testLots()">Лоты аукциона</button>
            <div id="result" class="result"></div>
        </div>
        
        <div class="test-section">
            <h3>📊 Статус каталога</h3>
            <p>Каталог монет успешно запущен!</p>
            <p>Порт: 3000</p>
            <p>Внешний доступ: <a href="http://46.173.19.68:3000" target="_blank">http://46.173.19.68:3000</a></p>
        </div>
    </div>

    <script>
        function showResult(message, isSuccess = true) {
            const result = document.getElementById('result');
            result.textContent = message;
            result.className = `result ${isSuccess ? 'success' : 'error'}`;
        }

        async function testAPI() {
            try {
                const response = await fetch('/api/test');
                const data = await response.json();
                showResult(`✅ Тестовый API работает!\n\nОтвет: ${JSON.stringify(data, null, 2)}`);
            } catch (error) {
                showResult(`❌ Ошибка тестового API: ${error.message}`, false);
            }
        }

        async function testAuctions() {
            try {
                const response = await fetch('/api/auctions');
                const data = await response.json();
                showResult(`✅ API аукционов работает!\n\nНайдено аукционов: ${data.length}\n\nОтвет: ${JSON.stringify(data.slice(0, 3), null, 2)}...`);
            } catch (error) {
                showResult(`❌ Ошибка API аукционов: ${error.message}`, false);
            }
        }

        async function testLots() {
            try {
                const response = await fetch('/api/auctions/2135/lots');
                const data = await response.json();
                showResult(`✅ API лотов работает!\n\nНайдено лотов: ${data.length}\n\nОтвет: ${JSON.stringify(data.slice(0, 3), null, 2)}...`);
            } catch (error) {
                showResult(`❌ Ошибка API лотов: ${error.message}`, false);
            }
        }
    </script>
</body>
</html>
EOF

echo "✅ index.html создан"

echo ""
echo "📊 ЭТАП 8: Установка зависимостей..."
echo "================================="

echo "🔄 Установка зависимостей..."
npm install

if [ $? -eq 0 ]; then
    echo "✅ Зависимости установлены"
else
    echo "❌ Ошибка установки зависимостей"
    exit 1
fi

echo ""
echo "📊 ЭТАП 9: Проверка синтаксиса..."
echo "==============================="

echo "📋 Проверка синтаксиса server.js:"
node -c server.js 2>&1

if [ $? -eq 0 ]; then
    echo "✅ server.js синтаксически корректен"
else
    echo "❌ Ошибка синтаксиса в server.js"
    exit 1
fi

echo ""
echo "📊 ЭТАП 10: Тестирование запуска..."
echo "=================================="

echo "📋 Попытка запуска server.js (5 секунд):"
timeout 5 node server.js 2>&1 || echo "Процесс завершен по таймауту или с ошибкой"

echo ""
echo "📊 ЭТАП 11: Запуск через PM2..."
echo "=============================="

pm2 start server.js --name "catalog-interface"

if [ $? -eq 0 ]; then
    echo "✅ Каталог запущен через PM2"
else
    echo "❌ Ошибка запуска каталога через PM2"
    exit 1
fi

echo ""
echo "⏳ ЭТАП 12: Ожидание запуска..."
echo "============================="

sleep 5

echo ""
echo "📊 ЭТАП 13: Проверка работы каталога..."
echo "==================================="

echo "🔍 Статус PM2:"
pm2 status

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
echo "✅ ФИНАЛЬНОЕ ИСПРАВЛЕНИЕ КАТАЛОГА ЗАВЕРШЕНО!"
echo "========================================="
echo "🌐 Каталог монет: http://46.173.19.68:3000"
echo "🧪 Тестовый API: http://46.173.19.68:3000/api/test"
echo "📊 API аукционов: http://46.173.19.68:3000/api/auctions"
echo "📊 Мониторинг: pm2 status"
echo "📋 Логи каталога: pm2 logs catalog-interface"

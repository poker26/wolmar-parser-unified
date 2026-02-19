#!/bin/bash

# Диагностика проблемы с основным сайтом
# Проверяет почему не загружаются аукционы

echo "🔍 ДИАГНОСТИКА ПРОБЛЕМЫ С ОСНОВНЫМ САЙТОМ..."
echo "========================================="

cd /var/www/wolmar-parser

echo "📊 ЭТАП 1: Проверка статуса PM2..."
echo "================================="

echo "🔍 Статус PM2:"
pm2 status

echo ""
echo "📊 ЭТАП 2: Проверка логов основного сайта..."
echo "=========================================="

echo "📋 Логи основного сайта:"
pm2 logs wolmar-parser --lines 20

echo ""
echo "📊 ЭТАП 3: Проверка API основного сайта..."
echo "======================================="

echo "🧪 Тестирование API здоровья:"
curl -s http://localhost:3001/api/health | jq . 2>/dev/null || curl -s http://localhost:3001/api/health

echo ""
echo "🧪 Тестирование API аукционов:"
curl -s http://localhost:3001/api/auctions | jq '.[0:3]' 2>/dev/null || curl -s http://localhost:3001/api/auctions | head -20

echo ""
echo "📊 ЭТАП 4: Проверка портов..."
echo "==========================="

echo "📋 Процессы на портах 3000-3001:"
netstat -tlnp | grep -E ":300[01]" || echo "Порты 3000-3001 не заняты"

echo ""
echo "📊 ЭТАП 5: Проверка файлов основного сайта..."
echo "==========================================="

echo "📋 Проверка server.js:"
if [ -f "server.js" ]; then
    echo "✅ server.js найден"
    echo "📋 Размер: $(wc -l < server.js) строк"
else
    echo "❌ server.js не найден"
fi

echo ""
echo "📋 Проверка public/app.js:"
if [ -f "public/app.js" ]; then
    echo "✅ public/app.js найден"
    echo "📋 Размер: $(wc -l < public/app.js) строк"
else
    echo "❌ public/app.js не найден"
fi

echo ""
echo "📋 Проверка public/index.html:"
if [ -f "public/index.html" ]; then
    echo "✅ public/index.html найден"
    echo "📋 Размер: $(wc -l < public/index.html) строк"
else
    echo "❌ public/index.html не найден"
fi

echo ""
echo "📊 ЭТАП 6: Проверка API эндпоинтов в server.js..."
echo "=============================================="

echo "📋 Поиск API аукционов:"
grep -n "app.get.*auctions" server.js || echo "API аукционов не найден"

echo ""
echo "📋 Поиск API здоровья:"
grep -n "app.get.*health" server.js || echo "API здоровья не найден"

echo ""
echo "📋 Поиск статических файлов:"
grep -n "express.static" server.js || echo "Статические файлы не настроены"

echo ""
echo "📊 ЭТАП 7: Проверка базы данных..."
echo "==============================="

echo "📋 Проверка подключения к БД:"
node -e "
const { Pool } = require('pg');
const pool = new Pool({
    user: 'postgres.xkwgspqwebfeteoblayu',
    host: 'sup.begemot26.ru',
    database: 'postgres',
    password: 'Gopapopa326+',
    port: 6543,
    ssl: { rejectUnauthorized: false }
});

pool.query('SELECT COUNT(*) FROM auction_lots')
    .then(result => {
        console.log('✅ Подключение к БД работает');
        console.log('📋 Количество лотов:', result.rows[0].count);
        pool.end();
    })
    .catch(err => {
        console.error('❌ Ошибка подключения к БД:', err.message);
        pool.end();
    });
"

echo ""
echo "📊 ЭТАП 8: Проверка внешнего доступа..."
echo "====================================="

echo "🌐 Внешний доступ к основному сайту:"
curl -s http://46.173.19.68:3001/api/health | jq . 2>/dev/null || curl -s http://46.173.19.68:3001/api/health

echo ""
echo "🌐 Внешний доступ к API аукционов:"
curl -s http://46.173.19.68:3001/api/auctions | jq '.[0:3]' 2>/dev/null || curl -s http://46.173.19.68:3001/api/auctions | head -20

echo ""
echo "📊 ЭТАП 9: Проверка конфигурации..."
echo "================================="

echo "📋 Проверка config.js:"
if [ -f "config.js" ]; then
    echo "✅ config.js найден"
    echo "📋 Содержимое config.js:"
    cat config.js
else
    echo "❌ config.js не найден"
fi

echo ""
echo "📊 ЭТАП 10: Проверка package.json..."
echo "=================================="

echo "📋 Проверка package.json:"
if [ -f "package.json" ]; then
    echo "✅ package.json найден"
    echo "📋 Зависимости:"
    grep -A 20 '"dependencies"' package.json || echo "Секция dependencies не найдена"
else
    echo "❌ package.json не найден"
fi

echo ""
echo "✅ ДИАГНОСТИКА ПРОБЛЕМЫ С ОСНОВНЫМ САЙТОМ ЗАВЕРШЕНА!"
echo "================================================="
echo "💡 Проанализируйте результаты выше для определения проблемы"
echo "💡 Возможные причины: отсутствие API эндпоинтов, проблемы с БД, неправильная конфигурация"

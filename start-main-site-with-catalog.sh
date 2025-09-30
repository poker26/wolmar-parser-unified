#!/bin/bash

# Запуск основного сайта вместе с каталогом
# Основной сайт на порту 3001, каталог на порту 3000

echo "🚀 ЗАПУСК ОСНОВНОГО САЙТА С КАТАЛОГОМ..."
echo "====================================="

cd /var/www/wolmar-parser

echo "📊 ЭТАП 1: Проверка статуса каталога..."
echo "==================================="

echo "🔍 Статус PM2:"
pm2 status

echo ""
echo "📊 ЭТАП 2: Проверка работы каталога..."
echo "==================================="

echo "🧪 Тестирование каталога:"
curl -s http://localhost:3000/api/test > /dev/null
if [ $? -eq 0 ]; then
    echo "✅ Каталог работает на порту 3000"
else
    echo "❌ Каталог не работает на порту 3000"
    echo "🔄 Запуск каталога..."
    cd /var/www/catalog-interface
    pm2 start server.js --name "catalog-interface"
    cd /var/www/wolmar-parser
fi

echo ""
echo "📊 ЭТАП 3: Запуск основного сайта..."
echo "================================="

echo "🔄 Запуск основного сайта на порту 3001..."
pm2 start server.js --name "wolmar-parser" -- --port 3001

if [ $? -eq 0 ]; then
    echo "✅ Основной сайт запущен на порту 3001"
else
    echo "❌ Ошибка запуска основного сайта"
    exit 1
fi

echo ""
echo "⏳ ЭТАП 4: Ожидание запуска..."
echo "============================="

sleep 5

echo ""
echo "📊 ЭТАП 5: Проверка работы обоих сайтов..."
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
echo "📊 ЭТАП 6: Тестирование внешнего доступа..."
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
echo "📊 ЭТАП 7: Проверка портов..."
echo "==========================="

echo "📋 Процессы на портах 3000-3001:"
netstat -tlnp | grep -E ":300[01]" || echo "Порты 3000-3001 не заняты"

echo ""
echo "📊 ЭТАП 8: Проверка логов..."
echo "==========================="

echo "📋 Логи основного сайта:"
pm2 logs wolmar-parser --lines 5

echo ""
echo "📋 Логи каталога:"
pm2 logs catalog-interface --lines 5

echo ""
echo "✅ ЗАПУСК ОСНОВНОГО САЙТА С КАТАЛОГОМ ЗАВЕРШЕН!"
echo "============================================="
echo "🌐 Основной сайт: http://46.173.19.68:3001"
echo "🌐 Каталог монет: http://46.173.19.68:3000"
echo "📊 Мониторинг: pm2 status"
echo "📋 Логи основного сайта: pm2 logs wolmar-parser"
echo "📋 Логи каталога: pm2 logs catalog-interface"

#!/bin/bash

# Скрипт для проверки и исправления проблемы с портом 3000
# Диагностирует проблему "Connection refused"

echo "🔍 Диагностика проблемы с портом 3000..."
echo "======================================="

# Проверяем, что мы на сервере
if [ ! -f "/var/www/wolmar-parser/server.js" ]; then
    echo "❌ Ошибка: Скрипт должен запускаться на сервере в /var/www/wolmar-parser"
    exit 1
fi

echo "📊 ЭТАП 1: Проверка процессов на порту 3000..."
netstat -tlnp | grep :3000

echo ""
echo "📊 ЭТАП 2: Проверка статуса PM2..."
pm2 status

echo ""
echo "📊 ЭТАП 3: Проверка процессов каталога..."
ps aux | grep catalog-interface

echo ""
echo "📊 ЭТАП 4: Проверка директории каталога..."
ls -la /var/www/catalog-interface/

echo ""
echo "📊 ЭТАП 5: Проверка файлов каталога..."
if [ -f "/var/www/catalog-interface/server.js" ]; then
    echo "✅ server.js найден"
else
    echo "❌ server.js не найден"
fi

if [ -f "/var/www/catalog-interface/package.json" ]; then
    echo "✅ package.json найден"
else
    echo "❌ package.json не найден"
fi

if [ -f "/var/www/catalog-interface/config.js" ]; then
    echo "✅ config.js найден"
else
    echo "❌ config.js не найден"
fi

echo ""
echo "📊 ЭТАП 6: Проверка логов каталога..."
pm2 logs catalog-interface --lines 10

echo ""
echo "📊 ЭТАП 7: Проверка доступности каталога..."
curl -v http://localhost:3000/api/auctions 2>&1 | head -20

echo ""
echo "📊 ЭТАП 8: Проверка файрвола..."
ufw status 2>/dev/null || echo "UFW не установлен"
iptables -L INPUT | grep 3000 || echo "Правила для порта 3000 не найдены"

echo ""
echo "📊 ЭТАП 9: Попытка запуска каталога вручную..."
cd /var/www/catalog-interface
node server.js &
CATALOG_PID=$!
sleep 3

echo "🔍 Проверка работы каталога..."
curl -s http://localhost:3000/api/auctions > /dev/null
if [ $? -eq 0 ]; then
    echo "✅ Каталог работает при ручном запуске"
    kill $CATALOG_PID 2>/dev/null
else
    echo "❌ Каталог не работает даже при ручном запуске"
    kill $CATALOG_PID 2>/dev/null
fi

echo ""
echo "✅ ДИАГНОСТИКА ЗАВЕРШЕНА!"
echo "💡 Запустите ./fix-catalog-port-3000.sh для исправления"

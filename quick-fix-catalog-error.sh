#!/bin/bash

# Быстрое исправление ошибки MODULE_NOT_FOUND в каталоге
# Простое решение для проблемы с модулями

echo "⚡ Быстрое исправление ошибки каталога..."
echo "======================================"

cd /var/www/wolmar-parser

echo "🔄 Переключение на ветку web-interface..."
git checkout web-interface --force

echo "📦 Очистка каталога..."
rm -rf /var/www/catalog-interface
mkdir -p /var/www/catalog-interface
cd /var/www/catalog-interface

echo "📋 Копирование файлов..."
cp -r /var/www/wolmar-parser/public/ ./
cp /var/www/wolmar-parser/server.js ./
cp /var/www/wolmar-parser/package.json ./
cp /var/www/wolmar-parser/package-lock.json ./
cp /var/www/wolmar-parser/config.example.js ./

echo "⚙️ Настройка..."
cp config.example.js config.js

echo "📦 Установка зависимостей..."
npm install

echo "🔄 Остановка старого процесса..."
pm2 stop catalog-interface 2>/dev/null || true
pm2 delete catalog-interface 2>/dev/null || true

echo "🚀 Запуск каталога..."
pm2 start server.js --name "catalog-interface"

echo "⏳ Ожидание запуска..."
sleep 5

echo "🔍 Проверка..."
pm2 status catalog-interface

echo "🌐 Тест API..."
curl -s http://localhost:3000/api/auctions > /dev/null
if [ $? -eq 0 ]; then
    echo "✅ Каталог работает!"
    echo "🌐 Доступен: http://46.173.19.68:3000"
else
    echo "❌ Каталог не работает"
    echo "📋 Логи:"
    pm2 logs catalog-interface --lines 5
fi

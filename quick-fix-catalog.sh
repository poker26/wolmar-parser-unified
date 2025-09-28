#!/bin/bash

# Быстрое исправление проблемы с каталогом на порту 3000
# Простое решение для "Connection refused"

echo "⚡ Быстрое исправление каталога на порту 3000..."
echo "=============================================="

cd /var/www/wolmar-parser

echo "🔄 Переключение на ветку web-interface..."
git checkout web-interface --force

echo "📦 Создание каталога..."
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
curl -s http://localhost:3000/api/auctions > /dev/null
if [ $? -eq 0 ]; then
    echo "✅ Каталог работает на порту 3000!"
    echo "🌐 Доступен по адресу: http://46.173.19.68:3000"
else
    echo "❌ Каталог все еще не работает"
    echo "📋 Проверьте логи: pm2 logs catalog-interface"
fi

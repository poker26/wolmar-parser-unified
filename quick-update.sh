#!/bin/bash

# Быстрое обновление сервера
# Выполняет только git pull и pm2 restart

echo "⚡ Быстрое обновление сервера..."

# Проверяем, что мы в правильной директории
if [ ! -f "server.js" ]; then
    echo "❌ Ошибка: Запустите из директории wolmar-parser"
    exit 1
fi

# Git pull
echo "🔄 git pull..."
git pull origin catalog-parser

# PM2 restart
echo "🔄 pm2 restart..."
pm2 restart wolmar-parser

echo "✅ Готово!"

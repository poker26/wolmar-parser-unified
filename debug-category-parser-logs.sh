#!/bin/bash

# Скрипт для диагностики проблемы с логами парсера категорий
# Запускать на сервере: bash debug-category-parser-logs.sh

echo "🔍 Диагностика логов парсера категорий"
echo "======================================"

# 1. Проверяем директорию логов
echo "📁 Проверяем директорию логов:"
if [ -d "/var/www/wolmar-parser/logs" ]; then
    echo "✅ Директория /var/www/wolmar-parser/logs существует"
    ls -la /var/www/wolmar-parser/logs/
else
    echo "❌ Директория /var/www/wolmar-parser/logs не существует"
    echo "🔧 Создаем директорию..."
    mkdir -p /var/www/wolmar-parser/logs
    chown www-data:www-data /var/www/wolmar-parser/logs
    echo "✅ Директория создана"
fi

echo ""

# 2. Проверяем файл логов парсера категорий
echo "📄 Проверяем файл логов парсера категорий:"
if [ -f "/var/www/wolmar-parser/logs/category-parser.log" ]; then
    echo "✅ Файл /var/www/wolmar-parser/logs/category-parser.log существует"
    echo "📊 Размер файла: $(stat -c%s /var/www/wolmar-parser/logs/category-parser.log) байт"
    echo "📅 Последнее изменение: $(stat -c%y /var/www/wolmar-parser/logs/category-parser.log)"
    echo ""
    echo "📋 Последние 10 строк лога:"
    tail -10 /var/www/wolmar-parser/logs/category-parser.log
else
    echo "❌ Файл /var/www/wolmar-parser/logs/category-parser.log не существует"
fi

echo ""

# 3. Проверяем права доступа
echo "🔐 Проверяем права доступа:"
ls -la /var/www/wolmar-parser/logs/ 2>/dev/null || echo "Директория не существует"

echo ""

# 4. Проверяем API endpoint
echo "🌐 Проверяем API endpoint:"
curl -s "http://localhost:3001/api/admin/logs/category-parser" | head -5

echo ""

# 5. Проверяем, запущен ли парсер категорий
echo "⚙️ Проверяем процессы Node.js:"
ps aux | grep node | grep -v grep

echo ""

# 6. Проверяем логи сервера
echo "📋 Проверяем логи сервера (последние 20 строк):"
if [ -f "/var/log/nginx/error.log" ]; then
    echo "Nginx ошибки:"
    tail -5 /var/log/nginx/error.log
fi

echo ""

# 7. Создаем тестовый лог
echo "🧪 Создаем тестовый лог:"
echo "$(date): Тестовое сообщение для проверки логов парсера категорий" >> /var/www/wolmar-parser/logs/category-parser.log
echo "✅ Тестовое сообщение добавлено"

echo ""

# 8. Проверяем API снова
echo "🔄 Проверяем API после добавления тестового сообщения:"
curl -s "http://localhost:3001/api/admin/logs/category-parser" | head -5

echo ""
echo "🎯 Диагностика завершена!"

#!/bin/bash

# Скрипт для развертывания веб-интерфейса каталога монет на сервере
# Переключается на ветку web-interface и развертывает ее

echo "🌐 Развертывание веб-интерфейса каталога монет..."
echo "==============================================="

# Проверяем, что мы в правильной директории
if [ ! -f "package.json" ]; then
    echo "❌ Ошибка: Запустите из директории wolmar-parser"
    exit 1
fi

echo "📋 Текущая ветка:"
git branch --show-current

echo ""
echo "🔄 Переключаемся на ветку web-interface..."
git checkout web-interface

if [ $? -eq 0 ]; then
    echo "✅ Переключились на ветку web-interface"
else
    echo "❌ Ошибка переключения на ветку web-interface"
    exit 1
fi

echo ""
echo "📊 Проверяем содержимое ветки web-interface..."
echo "Файлы в ветке:"
ls -la | head -20

echo ""
echo "🔍 Проверяем веб-интерфейс..."
if [ -f "public/index.html" ]; then
    echo "✅ Найден веб-интерфейс: public/index.html"
else
    echo "❌ Веб-интерфейс не найден"
    exit 1
fi

if [ -f "server.js" ]; then
    echo "✅ Найден сервер: server.js"
else
    echo "❌ Сервер не найден"
    exit 1
fi

echo ""
echo "📦 Проверяем зависимости..."
if [ -f "package.json" ]; then
    echo "✅ Найден package.json"
    echo "Зависимости:"
    cat package.json | grep -A 20 '"dependencies"'
else
    echo "❌ package.json не найден"
    exit 1
fi

echo ""
echo "🚀 Готовим к развертыванию на сервере..."
echo "======================================="

# Создаем архив для переноса
echo "📦 Создаем архив для переноса..."
tar -czf catalog-interface.tar.gz \
    --exclude=node_modules \
    --exclude=.git \
    --exclude=*.log \
    --exclude=*.json.bak \
    .

if [ $? -eq 0 ]; then
    echo "✅ Архив создан: catalog-interface.tar.gz"
    echo "📊 Размер архива: $(du -h catalog-interface.tar.gz | cut -f1)"
else
    echo "❌ Ошибка создания архива"
    exit 1
fi

echo ""
echo "📋 Инструкции для развертывания на сервере:"
echo "=========================================="
echo "1. Скопируйте архив на сервер:"
echo "   scp catalog-interface.tar.gz root@46.173.19.68:/var/www/"
echo ""
echo "2. На сервере распакуйте архив:"
echo "   cd /var/www/"
echo "   tar -xzf catalog-interface.tar.gz -C catalog-interface/"
echo ""
echo "3. Установите зависимости:"
echo "   cd /var/www/catalog-interface/"
echo "   npm install"
echo ""
echo "4. Настройте конфигурацию:"
echo "   cp config.example.js config.js"
echo "   # Отредактируйте config.js с настройками БД"
echo ""
echo "5. Запустите сервер:"
echo "   node server.js"
echo ""
echo "6. Или через PM2:"
echo "   pm2 start server.js --name catalog-interface"
echo ""
echo "✅ Готово к развертыванию!"

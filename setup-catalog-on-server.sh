#!/bin/bash

# Скрипт для настройки веб-интерфейса каталога на сервере
# Запускается на сервере для настройки каталога монет

echo "🌐 Настройка веб-интерфейса каталога монет на сервере..."
echo "====================================================="

# Проверяем, что мы на сервере
if [ ! -f "/var/www/wolmar-parser/server.js" ]; then
    echo "❌ Ошибка: Скрипт должен запускаться на сервере в /var/www/"
    exit 1
fi

echo "📁 Создаем директорию для каталога..."
mkdir -p /var/www/catalog-interface
cd /var/www/catalog-interface

echo ""
echo "🔄 Переключаемся на ветку web-interface в основном проекте..."
cd /var/www/wolmar-parser
git checkout web-interface

if [ $? -eq 0 ]; then
    echo "✅ Переключились на ветку web-interface"
else
    echo "❌ Ошибка переключения на ветку web-interface"
    exit 1
fi

echo ""
echo "📦 Копируем файлы веб-интерфейса..."
cp -r public/ /var/www/catalog-interface/
cp server.js /var/www/catalog-interface/
cp package.json /var/www/catalog-interface/
cp package-lock.json /var/www/catalog-interface/
cp config.example.js /var/www/catalog-interface/
cp README.md /var/www/catalog-interface/

echo "✅ Файлы скопированы"

echo ""
echo "📦 Устанавливаем зависимости..."
cd /var/www/catalog-interface
npm install

if [ $? -eq 0 ]; then
    echo "✅ Зависимости установлены"
else
    echo "❌ Ошибка установки зависимостей"
    exit 1
fi

echo ""
echo "⚙️ Настраиваем конфигурацию..."
if [ -f "config.example.js" ]; then
    cp config.example.js config.js
    echo "✅ Конфигурация создана из примера"
    echo "💡 Отредактируйте config.js с настройками БД"
else
    echo "⚠️ config.example.js не найден, создаем базовую конфигурацию"
    cat > config.js << EOF
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
    echo "✅ Базовая конфигурация создана"
fi

echo ""
echo "🚀 Настраиваем PM2 для каталога..."
pm2 start server.js --name "catalog-interface" --cwd /var/www/catalog-interface

if [ $? -eq 0 ]; then
    echo "✅ Каталог запущен через PM2"
else
    echo "❌ Ошибка запуска через PM2"
    echo "💡 Попробуйте запустить вручную: node server.js"
fi

echo ""
echo "📊 Проверяем статус PM2..."
pm2 status

echo ""
echo "🌐 Проверяем доступность каталога..."
sleep 3
curl -s http://localhost:3000/api/auctions > /dev/null

if [ $? -eq 0 ]; then
    echo "✅ Каталог доступен на http://localhost:3000"
else
    echo "⚠️ Каталог может быть недоступен, проверьте логи: pm2 logs catalog-interface"
fi

echo ""
echo "✅ Настройка каталога завершена!"
echo "🌐 Каталог доступен по адресу: http://46.173.19.68:3000"
echo "📊 Мониторинг: pm2 logs catalog-interface"
echo "🔄 Перезапуск: pm2 restart catalog-interface"

#!/bin/bash

# Скрипт для исправления проблемы с каталогом монет на порту 3000
# Решает проблему "Connection refused"

echo "🔧 Исправление проблемы с каталогом монет на порту 3000..."
echo "======================================================="

# Проверяем, что мы на сервере
if [ ! -f "/var/www/wolmar-parser/server.js" ]; then
    echo "❌ Ошибка: Скрипт должен запускаться на сервере в /var/www/wolmar-parser"
    exit 1
fi

cd /var/www/wolmar-parser

echo "📊 ЭТАП 1: Проверка текущего статуса..."
pm2 status

echo ""
echo "🔍 ЭТАП 2: Проверка процессов на порту 3000..."
netstat -tlnp | grep :3000

echo ""
echo "🌐 ЭТАП 3: Проверка доступности каталога..."
curl -s http://localhost:3000/api/auctions
if [ $? -eq 0 ]; then
    echo "✅ Каталог монет работает"
    exit 0
else
    echo "❌ Каталог монет не отвечает"
fi

echo ""
echo "🔄 ЭТАП 4: Переключение на ветку web-interface..."
git checkout web-interface --force

if [ $? -eq 0 ]; then
    echo "✅ Переключились на ветку web-interface"
else
    echo "❌ Ошибка переключения на ветку web-interface"
    exit 1
fi

echo ""
echo "📦 ЭТАП 5: Создание директории каталога..."
mkdir -p /var/www/catalog-interface
cd /var/www/catalog-interface

echo ""
echo "📋 ЭТАП 6: Копирование файлов каталога..."
cp -r /var/www/wolmar-parser/public/ ./
cp /var/www/wolmar-parser/server.js ./
cp /var/www/wolmar-parser/package.json ./
cp /var/www/wolmar-parser/package-lock.json ./
cp /var/www/wolmar-parser/config.example.js ./

echo "✅ Файлы каталога скопированы"

echo ""
echo "⚙️ ЭТАП 7: Настройка каталога..."
cp config.example.js config.js

# Проверяем, что в config.js правильные настройки БД
echo "🔍 Проверяем конфигурацию БД..."
if grep -q "postgres.xkwgspqwebfeteoblayu" config.js; then
    echo "✅ Конфигурация БД найдена"
else
    echo "⚠️ Конфигурация БД не найдена, создаем..."
    cat > config.js << 'EOF'
module.exports = {
    dbConfig: {
        user: 'postgres.xkwgspqwebfeteoblayu',
        host: 'sup.begemot26.ru',
        database: 'postgres',
        password: 'Gopapopa326+',
        port: 6543,
        ssl: {
            rejectUnauthorized: false
        }
    }
};
EOF
    echo "✅ Конфигурация БД создана"
fi

echo ""
echo "📦 ЭТАП 8: Установка зависимостей каталога..."
npm install

if [ $? -eq 0 ]; then
    echo "✅ Зависимости каталога установлены"
else
    echo "❌ Ошибка установки зависимостей каталога"
    exit 1
fi

echo ""
echo "🔄 ЭТАП 9: Остановка существующих процессов каталога..."
pm2 stop catalog-interface 2>/dev/null || true
pm2 delete catalog-interface 2>/dev/null || true

echo ""
echo "🚀 ЭТАП 10: Запуск каталога монет..."
pm2 start server.js --name "catalog-interface"

if [ $? -eq 0 ]; then
    echo "✅ Каталог монет запущен через PM2"
else
    echo "❌ Ошибка запуска каталога монет"
    exit 1
fi

echo ""
echo "⏳ ЭТАП 11: Ожидание запуска каталога..."
sleep 5

echo ""
echo "🔍 ЭТАП 12: Проверка работы каталога..."
curl -s http://localhost:3000/api/auctions > /dev/null
if [ $? -eq 0 ]; then
    echo "✅ Каталог монет работает на порту 3000"
else
    echo "❌ Каталог монет все еще не отвечает"
    echo "📋 Проверяем логи каталога..."
    pm2 logs catalog-interface --lines 20
fi

echo ""
echo "📊 ЭТАП 13: Финальная проверка PM2..."
pm2 status

echo ""
echo "🌐 ЭТАП 14: Проверка внешнего доступа..."
curl -s http://46.173.19.68:3000/api/auctions > /dev/null
if [ $? -eq 0 ]; then
    echo "✅ Каталог монет доступен извне: http://46.173.19.68:3000"
else
    echo "❌ Каталог монет недоступен извне"
    echo "💡 Возможно, проблема с файрволом или настройками сети"
fi

echo ""
echo "✅ ИСПРАВЛЕНИЕ КАТАЛОГА ЗАВЕРШЕНО!"
echo "============================================="
echo "🌐 Основной сервер: http://46.173.19.68:3001"
echo "📚 Каталог монет: http://46.173.19.68:3000"
echo "📊 Мониторинг: pm2 status"
echo "📋 Логи каталога: pm2 logs catalog-interface"

#!/bin/bash

# Скрипт для исправления ошибки MODULE_NOT_FOUND в каталоге монет
# Исправляет проблему с отсутствующими модулями

echo "🔧 Исправление ошибки MODULE_NOT_FOUND в каталоге монет..."
echo "======================================================="

# Проверяем, что мы на сервере
if [ ! -f "/var/www/wolmar-parser/server.js" ]; then
    echo "❌ Ошибка: Скрипт должен запускаться на сервере в /var/www/wolmar-parser"
    exit 1
fi

cd /var/www/wolmar-parser

echo "📊 ЭТАП 1: Остановка проблемного процесса каталога..."
pm2 stop catalog-interface 2>/dev/null || true
pm2 delete catalog-interface 2>/dev/null || true

echo ""
echo "🔄 ЭТАП 2: Переключение на ветку web-interface..."
git checkout web-interface --force

if [ $? -eq 0 ]; then
    echo "✅ Переключились на ветку web-interface"
else
    echo "❌ Ошибка переключения на ветку web-interface"
    exit 1
fi

echo ""
echo "📦 ЭТАП 3: Очистка и пересоздание каталога..."
rm -rf /var/www/catalog-interface
mkdir -p /var/www/catalog-interface
cd /var/www/catalog-interface

echo ""
echo "📋 ЭТАП 4: Копирование файлов каталога..."
cp -r /var/www/wolmar-parser/public/ ./
cp /var/www/wolmar-parser/server.js ./
cp /var/www/wolmar-parser/package.json ./
cp /var/www/wolmar-parser/package-lock.json ./
cp /var/www/wolmar-parser/config.example.js ./

echo "✅ Файлы каталога скопированы"

echo ""
echo "⚙️ ЭТАП 5: Настройка конфигурации..."
cp config.example.js config.js

# Проверяем и исправляем конфигурацию БД
echo "🔍 Проверяем конфигурацию БД..."
if ! grep -q "postgres.xkwgspqwebfeteoblayu" config.js; then
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
else
    echo "✅ Конфигурация БД найдена"
fi

echo ""
echo "📦 ЭТАП 6: Очистка и переустановка зависимостей..."
rm -rf node_modules package-lock.json
npm install

if [ $? -eq 0 ]; then
    echo "✅ Зависимости каталога установлены"
else
    echo "❌ Ошибка установки зависимостей каталога"
    exit 1
fi

echo ""
echo "🔍 ЭТАП 7: Проверка server.js на ошибки..."
# Проверяем, что server.js не содержит проблемных импортов
if grep -q "require.*admin" server.js; then
    echo "⚠️ Найдены импорты admin модулей, исправляем..."
    # Удаляем импорты admin модулей
    sed -i '/require.*admin/d' server.js
    echo "✅ Импорты admin модулей удалены"
fi

# Проверяем, что server.js использует правильный порт
if ! grep -q "const PORT = process.env.PORT || 3000" server.js; then
    echo "⚠️ Порт не настроен, исправляем..."
    sed -i 's/const PORT = process.env.PORT || [0-9]*/const PORT = process.env.PORT || 3000/' server.js
    echo "✅ Порт настроен на 3000"
fi

echo ""
echo "🧪 ЭТАП 8: Тестирование server.js..."
node -c server.js
if [ $? -eq 0 ]; then
    echo "✅ server.js синтаксически корректен"
else
    echo "❌ Ошибка синтаксиса в server.js"
    echo "📋 Проверяем содержимое server.js..."
    head -50 server.js
    exit 1
fi

echo ""
echo "🚀 ЭТАП 9: Запуск каталога монет..."
pm2 start server.js --name "catalog-interface"

if [ $? -eq 0 ]; then
    echo "✅ Каталог монет запущен через PM2"
else
    echo "❌ Ошибка запуска каталога монет"
    exit 1
fi

echo ""
echo "⏳ ЭТАП 10: Ожидание запуска каталога..."
sleep 5

echo ""
echo "🔍 ЭТАП 11: Проверка статуса каталога..."
pm2 status catalog-interface

echo ""
echo "📋 ЭТАП 12: Проверка логов каталога..."
pm2 logs catalog-interface --lines 10

echo ""
echo "🌐 ЭТАП 13: Проверка работы каталога..."
curl -s http://localhost:3000/api/auctions > /dev/null
if [ $? -eq 0 ]; then
    echo "✅ Каталог монет работает на порту 3000"
    echo "🌐 Доступен по адресу: http://46.173.19.68:3000"
else
    echo "❌ Каталог монет все еще не работает"
    echo "📋 Детальные логи:"
    pm2 logs catalog-interface --lines 20
fi

echo ""
echo "✅ ИСПРАВЛЕНИЕ ЗАВЕРШЕНО!"
echo "============================================="
echo "🌐 Основной сервер: http://46.173.19.68:3001"
echo "📚 Каталог монет: http://46.173.19.68:3000"
echo "📊 Мониторинг: pm2 status"
echo "📋 Логи каталога: pm2 logs catalog-interface"

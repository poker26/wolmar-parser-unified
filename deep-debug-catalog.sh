#!/bin/bash

# Детальная диагностика ошибки MODULE_NOT_FOUND в каталоге
# Анализирует все возможные причины проблемы

echo "🔍 Детальная диагностика ошибки MODULE_NOT_FOUND..."
echo "================================================="

cd /var/www/catalog-interface

echo "📊 ЭТАП 1: Проверка файла server.js..."
if [ -f "server.js" ]; then
    echo "✅ server.js найден"
    echo "📋 Размер файла: $(wc -l < server.js) строк"
    echo "📋 Первые 10 строк:"
    head -10 server.js
    echo ""
    echo "📋 Строки 45-55 (около проблемной строки 48):"
    sed -n '45,55p' server.js
else
    echo "❌ server.js не найден"
    exit 1
fi

echo ""
echo "📊 ЭТАП 2: Проверка всех require() в server.js..."
echo "📋 Все импорты:"
grep -n "require(" server.js

echo ""
echo "📊 ЭТАП 3: Проверка package.json..."
if [ -f "package.json" ]; then
    echo "✅ package.json найден"
    echo "📋 Содержимое package.json:"
    cat package.json
else
    echo "❌ package.json не найден"
fi

echo ""
echo "📊 ЭТАП 4: Проверка node_modules..."
if [ -d "node_modules" ]; then
    echo "✅ node_modules найден"
    echo "📋 Количество модулей: $(ls node_modules | wc -l)"
    echo "📋 Основные модули:"
    ls node_modules | grep -E "^(express|cors|pg|path)$" || echo "Основные модули не найдены"
else
    echo "❌ node_modules не найден"
fi

echo ""
echo "📊 ЭТАП 5: Проверка конкретных модулей..."
for module in "express" "cors" "pg" "path"; do
    if [ -d "node_modules/$module" ]; then
        echo "✅ $module найден"
    else
        echo "❌ $module не найден"
    fi
done

echo ""
echo "📊 ЭТАП 6: Проверка проблемных импортов..."
echo "📋 Ищем импорты admin модулей:"
grep -n "admin" server.js || echo "Импорты admin не найдены"

echo "📋 Ищем импорты WinnerRatingsService:"
grep -n "WinnerRatingsService" server.js || echo "Импорт WinnerRatingsService не найден"

echo "📋 Ищем импорты admin-server:"
grep -n "admin-server" server.js || echo "Импорт admin-server не найден"

echo ""
echo "📊 ЭТАП 7: Тестирование синтаксиса server.js..."
echo "📋 Проверка синтаксиса:"
node -c server.js 2>&1

echo ""
echo "📊 ЭТАП 8: Проверка конфигурации..."
if [ -f "config.js" ]; then
    echo "✅ config.js найден"
    echo "📋 Содержимое config.js:"
    cat config.js
else
    echo "❌ config.js не найден"
fi

echo ""
echo "📊 ЭТАП 9: Проверка прав доступа..."
echo "📋 Права на файлы:"
ls -la server.js package.json config.js 2>/dev/null || echo "Файлы не найдены"

echo ""
echo "📊 ЭТАП 10: Проверка версии Node.js..."
node --version

echo ""
echo "📊 ЭТАП 11: Попытка запуска server.js вручную..."
echo "📋 Запуск: node server.js"
timeout 5 node server.js 2>&1 || echo "Процесс завершен по таймауту или с ошибкой"

echo ""
echo "✅ ДЕТАЛЬНАЯ ДИАГНОСТИКА ЗАВЕРШЕНА!"
echo "💡 Анализируйте результаты выше для определения проблемы"

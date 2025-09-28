#!/bin/bash

# Скрипт для диагностики ошибки MODULE_NOT_FOUND в каталоге
# Анализирует проблему в server.js:48:28

echo "🔍 Диагностика ошибки MODULE_NOT_FOUND в каталоге..."
echo "================================================="

cd /var/www/catalog-interface

echo "📊 ЭТАП 1: Проверка файла server.js..."
if [ -f "server.js" ]; then
    echo "✅ server.js найден"
    echo "📋 Строка 48 в server.js:"
    sed -n '48p' server.js
    echo ""
    echo "📋 Строки 45-50 в server.js:"
    sed -n '45,50p' server.js
else
    echo "❌ server.js не найден"
    exit 1
fi

echo ""
echo "📊 ЭТАП 2: Проверка package.json..."
if [ -f "package.json" ]; then
    echo "✅ package.json найден"
    echo "📋 Зависимости:"
    cat package.json | grep -A 20 '"dependencies"'
else
    echo "❌ package.json не найден"
fi

echo ""
echo "📊 ЭТАП 3: Проверка node_modules..."
if [ -d "node_modules" ]; then
    echo "✅ node_modules найден"
    echo "📋 Количество модулей: $(ls node_modules | wc -l)"
else
    echo "❌ node_modules не найден"
fi

echo ""
echo "📊 ЭТАП 4: Проверка импортов в server.js..."
echo "📋 Все require() в server.js:"
grep -n "require(" server.js | head -10

echo ""
echo "📊 ЭТАП 5: Проверка проблемных импортов..."
# Ищем импорты, которые могут вызывать ошибки
if grep -q "require.*admin" server.js; then
    echo "⚠️ Найдены импорты admin модулей:"
    grep -n "require.*admin" server.js
else
    echo "✅ Импорты admin модулей не найдены"
fi

if grep -q "require.*WinnerRatingsService" server.js; then
    echo "⚠️ Найден импорт WinnerRatingsService:"
    grep -n "require.*WinnerRatingsService" server.js
else
    echo "✅ Импорт WinnerRatingsService не найден"
fi

echo ""
echo "📊 ЭТАП 6: Проверка конфигурации..."
if [ -f "config.js" ]; then
    echo "✅ config.js найден"
    echo "📋 Содержимое config.js:"
    cat config.js
else
    echo "❌ config.js не найден"
fi

echo ""
echo "📊 ЭТАП 7: Тестирование синтаксиса server.js..."
node -c server.js
if [ $? -eq 0 ]; then
    echo "✅ server.js синтаксически корректен"
else
    echo "❌ Ошибка синтаксиса в server.js"
    echo "📋 Детальная ошибка:"
    node -c server.js 2>&1
fi

echo ""
echo "📊 ЭТАП 8: Проверка доступности модулей..."
# Проверяем, какие модули могут отсутствовать
echo "📋 Проверяем основные модули:"
for module in "express" "cors" "pg" "path"; do
    if [ -d "node_modules/$module" ]; then
        echo "✅ $module найден"
    else
        echo "❌ $module не найден"
    fi
done

echo ""
echo "✅ ДИАГНОСТИКА ЗАВЕРШЕНА!"
echo "💡 Запустите ./fix-catalog-module-error.sh для исправления"

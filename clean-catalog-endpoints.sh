#!/bin/bash

# Скрипт для очистки API endpoints каталога из основной ветки
# Удаляет дублирующиеся endpoints каталога из server.js

echo "🧹 Очистка API endpoints каталога из основной ветки..."
echo "===================================================="

# Проверяем, что мы в правильной ветке
current_branch=$(git branch --show-current)
if [ "$current_branch" != "catalog-parser" ]; then
    echo "❌ Ошибка: Скрипт должен запускаться в ветке catalog-parser"
    echo "💡 Текущая ветка: $current_branch"
    exit 1
fi

echo "📊 Текущая ветка: $current_branch"

echo ""
echo "🔍 Проверяем наличие API endpoints каталога в server.js..."

# Проверяем наличие endpoints каталога
if grep -q "/api/auctions" server.js; then
    echo "⚠️ Найдены API endpoints каталога в server.js"
    echo "📋 Найденные endpoints:"
    grep -n "/api/auctions\|/api/lots\|/api/filters" server.js
else
    echo "✅ API endpoints каталога не найдены в server.js"
    exit 0
fi

echo ""
echo "🔍 Проверяем содержимое ветки web-interface..."
git checkout web-interface

if grep -q "/api/auctions" server.js; then
    echo "✅ API endpoints каталога присутствуют в ветке web-interface"
else
    echo "❌ API endpoints каталога отсутствуют в ветке web-interface"
    git checkout catalog-parser
    exit 1
fi

echo ""
echo "🔄 Возвращаемся в основную ветку..."
git checkout catalog-parser

echo ""
echo "📝 Создаем резервную копию server.js..."
cp server.js server.js.backup

echo ""
echo "🧹 Удаляем API endpoints каталога из server.js..."

# Создаем временный файл без endpoints каталога
grep -v -E "(/api/auctions|/api/lots|/api/filters)" server.js > server_temp.js

# Проверяем, что файл создался корректно
if [ -f "server_temp.js" ]; then
    echo "✅ Временный файл создан"
    
    # Заменяем оригинальный файл
    mv server_temp.js server.js
    
    echo "✅ API endpoints каталога удалены из server.js"
else
    echo "❌ Ошибка создания временного файла"
    exit 1
fi

echo ""
echo "🔍 Проверяем результат..."
if grep -q "/api/auctions" server.js; then
    echo "⚠️ API endpoints каталога все еще присутствуют"
    echo "💡 Возможно, нужно ручное редактирование"
else
    echo "✅ API endpoints каталога успешно удалены"
fi

echo ""
echo "📊 Статистика изменений:"
echo "  • Резервная копия: server.js.backup"
echo "  • Основной файл: server.js (очищен)"
echo "  • Каталог остается в ветке: web-interface"

echo ""
echo "✅ Очистка завершена!"
echo "💡 API endpoints каталога теперь изолированы в ветке web-interface"

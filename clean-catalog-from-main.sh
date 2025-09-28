#!/bin/bash

# Скрипт для полной очистки каталога монет из основной ветки
# Удаляет все файлы и endpoints, связанные с каталогом

echo "🧹 Полная очистка каталога монет из основной ветки..."
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
echo "🔍 Находим файлы каталога в основной ветке..."

# Список файлов каталога для удаления
catalog_files=(
    "catalog-public/"
    "catalog-server.js"
    "catalog-monitor.js"
    "catalog-parser.js"
    "CATALOG-README.md"
    "CATALOG-DEPLOYMENT-GUIDE.md"
    "deploy-catalog-interface.sh"
    "setup-catalog-on-server.sh"
    "remove-catalog-endpoints.js"
    "clean-catalog-endpoints.sh"
    "clean-catalog-from-main.sh"
)

echo "📋 Файлы каталога для удаления:"
for file in "${catalog_files[@]}"; do
    if [ -e "$file" ]; then
        echo "  ✅ $file"
    else
        echo "  ❌ $file (не найден)"
    fi
done

echo ""
echo "🗑️ Удаляем файлы каталога..."

# Создаем резервную копию
backup_dir="backup-catalog-$(date +%Y%m%d_%H%M%S)"
mkdir -p "$backup_dir"

for file in "${catalog_files[@]}"; do
    if [ -e "$file" ]; then
        echo "📦 Сохраняем в резервную копию: $file"
        cp -r "$file" "$backup_dir/" 2>/dev/null || true
        
        echo "🗑️ Удаляем: $file"
        rm -rf "$file"
    fi
done

echo ""
echo "🧹 Очищаем API endpoints каталога из server.js..."

# Создаем резервную копию server.js
cp server.js server.js.backup

# Удаляем endpoints каталога
node remove-catalog-endpoints.js

echo ""
echo "🔍 Проверяем результат очистки..."

# Проверяем, что endpoints удалены
if grep -q "/api/auctions" server.js; then
    echo "⚠️ API endpoints каталога все еще присутствуют в server.js"
else
    echo "✅ API endpoints каталога удалены из server.js"
fi

# Проверяем, что файлы удалены
remaining_files=0
for file in "${catalog_files[@]}"; do
    if [ -e "$file" ]; then
        echo "⚠️ Файл все еще существует: $file"
        remaining_files=$((remaining_files + 1))
    fi
done

if [ $remaining_files -eq 0 ]; then
    echo "✅ Все файлы каталога удалены"
else
    echo "⚠️ Остались файлы: $remaining_files"
fi

echo ""
echo "📊 Результат очистки:"
echo "  • Резервная копия: $backup_dir/"
echo "  • Резервная копия server.js: server.js.backup"
echo "  • Удаленные файлы: ${#catalog_files[@]}"
echo "  • Каталог изолирован в ветке: web-interface"

echo ""
echo "✅ Очистка завершена!"
echo "💡 Каталог монет теперь полностью изолирован в ветке web-interface"
echo "🌐 Для развертывания каталога используйте ветку web-interface"

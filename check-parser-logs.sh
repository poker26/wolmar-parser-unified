#!/bin/bash

echo "🔍 ПРОВЕРКА ЛОГОВ ПАРСЕРА"
echo "========================="

echo ""
echo "1️⃣ Проверяем логи PM2 для category-parser:"
pm2 logs category-parser --lines 50

echo ""
echo "2️⃣ Проверяем файл логов парсера категорий:"
if [ -f "logs/category-parser.log" ]; then
    echo "📄 Последние 50 строк из logs/category-parser.log:"
    tail -50 logs/category-parser.log
else
    echo "❌ Файл logs/category-parser.log не найден"
fi

echo ""
echo "3️⃣ Проверяем файл прогресса:"
if [ -f "logs/category-parser-progress.json" ]; then
    echo "📄 Содержимое файла прогресса:"
    cat logs/category-parser-progress.json
else
    echo "❌ Файл logs/category-parser-progress.json не найден"
fi

echo ""
echo "4️⃣ Проверяем системные логи на ошибки БД:"
journalctl -u postgresql --since "1 hour ago" | grep -i error | tail -10

echo ""
echo "✅ Проверка логов завершена"

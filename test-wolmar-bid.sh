#!/bin/bash

echo "🎯 Запускаем тест размещения ставки на Wolmar..."
echo "📅 Время: $(date)"
echo ""

cd /var/www/wolmar-parser

node wolmar-bid-placer.js

echo ""
echo "📸 Проверяем созданные файлы:"
ls -la wolmar-*.png 2>/dev/null || echo "Файлы не найдены"

echo ""
echo "🎯 Тест завершен!"

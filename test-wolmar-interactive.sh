#!/bin/bash

echo "🎯 Запускаем интерактивный тест размещения ставки на Wolmar..."
echo "📅 Время: $(date)"
echo ""

cd /var/www/wolmar-parser

node wolmar-bid-interactive.js

echo ""
echo "🎯 Интерактивный тест завершен!"

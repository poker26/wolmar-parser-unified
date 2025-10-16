#!/bin/bash

echo "🚀 Запускаем простой тест входа в Wolmar..."
echo "📅 Время: $(date)"
echo ""

cd /var/www/wolmar-parser

node wolmar-login-simple.js

echo ""
echo "📸 Проверяем созданные файлы:"
ls -la wolmar-*.png wolmar-cookies.json 2>/dev/null || echo "Файлы не найдены"

echo ""
echo "🔍 Тест завершен!"

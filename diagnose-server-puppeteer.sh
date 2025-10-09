#!/bin/bash

echo "🔍 Диагностика Puppeteer на сервере..."

# Проверяем, какие браузеры доступны
echo "📋 Проверяем доступные браузеры:"
echo "   - /usr/bin/google-chrome:"
ls -la /usr/bin/google-chrome 2>/dev/null || echo "     ❌ Не найден"

echo "   - /usr/bin/chromium-browser:"
ls -la /usr/bin/chromium-browser 2>/dev/null || echo "     ❌ Не найден"

echo "   - /usr/bin/chromium:"
ls -la /usr/bin/chromium 2>/dev/null || echo "     ❌ Не найден"

echo "   - /snap/bin/chromium:"
ls -la /snap/bin/chromium 2>/dev/null || echo "     ❌ Не найден"

# Проверяем переменные окружения
echo ""
echo "📋 Переменные окружения:"
echo "   - PUPPETEER_EXECUTABLE_PATH: ${PUPPETEER_EXECUTABLE_PATH:-'не установлена'}"

# Проверяем права на /tmp
echo ""
echo "📋 Проверяем права на /tmp:"
ls -la /tmp/ | head -5

# Проверяем текущую конфигурацию в файле
echo ""
echo "📋 Текущая конфигурация Puppeteer в update-current-auction-fixed.js:"
grep -A 10 "puppeteer.launch" /var/www/update-current-auction-fixed.js

echo ""
echo "✅ Диагностика завершена!"

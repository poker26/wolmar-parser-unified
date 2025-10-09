#!/bin/bash

echo "🔍 Диагностика Puppeteer на сервере Debian"
echo "=========================================="

echo "📋 Информация о системе:"
echo "OS: $(uname -a)"
echo "Node.js: $(node --version)"
echo "NPM: $(npm --version)"

echo ""
echo "🔍 Проверяем установленные браузеры:"

# Проверяем Chrome
if command -v google-chrome &> /dev/null; then
    echo "✅ Google Chrome найден: $(which google-chrome)"
    google-chrome --version
else
    echo "❌ Google Chrome не найден"
fi

# Проверяем Chromium
if command -v chromium-browser &> /dev/null; then
    echo "✅ Chromium Browser найден: $(which chromium-browser)"
    chromium-browser --version
else
    echo "❌ Chromium Browser не найден"
fi

if command -v chromium &> /dev/null; then
    echo "✅ Chromium найден: $(which chromium)"
    chromium --version
else
    echo "❌ Chromium не найден"
fi

echo ""
echo "🔍 Проверяем возможные пути:"
possible_paths=(
    "/usr/bin/chromium-browser"
    "/usr/bin/chromium"
    "/usr/bin/google-chrome"
    "/snap/bin/chromium"
    "/opt/google/chrome/chrome"
)

for path in "${possible_paths[@]}"; do
    if [ -f "$path" ]; then
        echo "✅ Найден: $path"
        ls -la "$path"
    else
        echo "❌ Не найден: $path"
    fi
done

echo ""
echo "🔍 Проверяем переменные окружения:"
echo "PUPPETEER_EXECUTABLE_PATH: $PUPPETEER_EXECUTABLE_PATH"

echo ""
echo "🔍 Проверяем установку Puppeteer:"
npm list puppeteer puppeteer-core

echo ""
echo "🔍 Тестируем простой запуск браузера:"
node -e "
const puppeteer = require('puppeteer');
console.log('Puppeteer версия:', require('puppeteer/package.json').version);
console.log('Попытка запуска браузера...');
puppeteer.launch({headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox']}).then(browser => {
    console.log('✅ Браузер запущен успешно');
    browser.close();
}).catch(err => {
    console.error('❌ Ошибка запуска браузера:', err.message);
});
"
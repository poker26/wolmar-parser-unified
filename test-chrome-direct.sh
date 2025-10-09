#!/bin/bash

echo "🧪 Тестируем прямой запуск Chrome..."

# Устанавливаем переменную окружения
export PUPPETEER_EXECUTABLE_PATH="/usr/bin/google-chrome"

echo "📋 PUPPETEER_EXECUTABLE_PATH: $PUPPETEER_EXECUTABLE_PATH"

# Тестируем простой запуск
node -e "
const puppeteer = require('puppeteer-core');
console.log('🚀 Запускаем Chrome напрямую...');
puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--single-process',
    '--no-zygote',
    '--disable-gpu',
    '--disable-background-networking',
    '--user-data-dir=/tmp/test-chrome-' + Date.now()
  ]
}).then(browser => {
  console.log('✅ Chrome запущен успешно!');
  browser.close();
}).catch(err => {
  console.error('❌ Ошибка:', err.message);
});
"

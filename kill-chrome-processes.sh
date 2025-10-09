#!/bin/bash

echo "🧹 Очистка всех процессов Chrome/Chromium..."

# Убиваем все процессы Chrome
pkill -f chrome
pkill -f chromium
pkill -f google-chrome

# Ждем немного
sleep 2

# Проверяем, что процессы убиты
echo "🔍 Проверяем оставшиеся процессы:"
ps aux | grep -E "(chrome|chromium)" | grep -v grep

echo "🧹 Очистка временных директорий Chrome..."
rm -rf /tmp/.com.google.Chrome.*
rm -rf /tmp/chrome-user-data-*
rm -rf /tmp/.X11-unix/X*

echo "✅ Очистка завершена"

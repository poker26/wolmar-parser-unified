#!/bin/bash

echo "🛑 Принудительное завершение всех процессов Chrome..."

echo "🔍 Находим все процессы Chrome/Chromium:"
ps aux | grep -i chrome | grep -v grep

echo ""
echo "🛑 Завершаем все процессы Chrome/Chromium:"
pkill -f chrome
pkill -f chromium
pkill -f google-chrome

echo ""
echo "🛑 Завершаем все процессы Node.js (кроме системных):"
pkill -f "node.*server"
pkill -f "node.*parser"
pkill -f "node.*catalog"

echo ""
echo "🛑 Завершаем все процессы с puppeteer:"
pkill -f puppeteer

echo ""
echo "🔍 Проверяем, что процессы завершены:"
sleep 2
ps aux | grep -i chrome | grep -v grep || echo "✅ Все процессы Chrome завершены"

echo ""
echo "🔍 Проверяем Node.js процессы:"
ps aux | grep node | grep -v grep || echo "✅ Все процессы Node.js завершены"

echo ""
echo "🧹 Очищаем временные файлы Chrome:"
rm -rf /tmp/chrome-*
rm -rf /tmp/.com.google.Chrome.*
rm -rf /tmp/.org.chromium.Chromium.*
rm -rf /tmp/.config/google-chrome
rm -rf /tmp/.config/chromium

echo ""
echo "🧹 Очищаем файлы метрик:"
find /root/.config -name "BrowserMetrics-*.pma" -delete 2>/dev/null
find /tmp -name "BrowserMetrics-*.pma" -delete 2>/dev/null

echo ""
echo "✅ Очистка завершена!"

echo ""
echo "🔍 Проверяем использование диска:"
df -h /

echo ""
echo "🔍 Проверяем, создаются ли новые файлы метрик (ждем 10 секунд):"
echo "Создано файлов за последние 10 секунд:"
sleep 10
find /root/.config -name "BrowserMetrics-*.pma" -newermt "10 seconds ago" 2>/dev/null | wc -l

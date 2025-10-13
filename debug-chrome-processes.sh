#!/bin/bash

echo "🔍 Диагностика процессов Chrome на сервере..."

echo "📋 Все процессы PM2:"
pm2 list

echo ""
echo "🔍 Все процессы Chrome/Chromium:"
ps aux | grep -i chrome | grep -v grep

echo ""
echo "🔍 Все процессы Node.js:"
ps aux | grep node | grep -v grep

echo ""
echo "🔍 Все процессы с 'puppeteer' в названии:"
ps aux | grep puppeteer | grep -v grep

echo ""
echo "🔍 Все процессы с 'browser' в названии:"
ps aux | grep browser | grep -v grep

echo ""
echo "🔍 Сетевые соединения на портах 3000-3002:"
netstat -tlnp | grep -E ":(3000|3001|3002)"

echo ""
echo "🔍 Последние файлы метрик (созданные за последние 5 минут):"
find /root/.config -name "BrowserMetrics-*.pma" -newermt "5 minutes ago" 2>/dev/null | head -10

echo ""
echo "🔍 Размер директории с метриками:"
du -sh /root/.config/google-chrome/BrowserMetrics/ 2>/dev/null || echo "Директория не найдена"

echo ""
echo "🔍 Кто создает файлы метрик (lsof):"
lsof /root/.config/google-chrome/BrowserMetrics/ 2>/dev/null || echo "Нет активных процессов"

echo ""
echo "🔍 Системные процессы, которые могут запускать браузер:"
ps aux | grep -E "(cron|systemd|init)" | grep -v grep

echo ""
echo "🔍 Проверяем cron jobs:"
crontab -l 2>/dev/null || echo "Нет cron jobs"

echo ""
echo "🔍 Проверяем systemd сервисы:"
systemctl list-units --type=service --state=running | grep -E "(chrome|browser|node)" || echo "Нет связанных сервисов"

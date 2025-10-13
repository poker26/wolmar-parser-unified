#!/bin/bash

echo "🚨 ЭКСТРЕННАЯ БЛОКИРОВКА CHROME - файлы метрик создаются даже после перезагрузки!"

echo "🔍 1. Проверяем все процессы Chrome:"
ps aux | grep -i chrome | grep -v grep

echo ""
echo "🔍 2. Проверяем все процессы Node.js:"
ps aux | grep node | grep -v grep

echo ""
echo "🔍 3. Проверяем systemd сервисы:"
systemctl list-units --type=service --state=running | grep -E "(chrome|browser|node|wolmar|parser)"

echo ""
echo "🔍 4. Проверяем автозапуск systemd:"
systemctl list-unit-files --type=service | grep -E "(chrome|browser|node|wolmar|parser)"

echo ""
echo "🔍 5. Проверяем cron jobs:"
crontab -l 2>/dev/null || echo "Нет cron jobs для root"

echo ""
echo "🔍 6. Проверяем systemd timers:"
systemctl list-timers --all | grep -E "(chrome|browser|node|wolmar|parser)"

echo ""
echo "🔍 7. Проверяем процессы, которые могут запускать браузер:"
ps aux | grep -E "(cron|systemd|init|bash|sh)" | grep -v grep

echo ""
echo "🔍 8. Проверяем сетевые соединения:"
netstat -tlnp | grep -E ":(3000|3001|3002|8080|8000)"

echo ""
echo "🔍 9. Проверяем, кто создает файлы метрик:"
lsof /root/.config/google-chrome/BrowserMetrics/ 2>/dev/null || echo "Нет активных процессов"

echo ""
echo "🔍 10. Проверяем последние файлы метрик:"
find /root/.config -name "BrowserMetrics-*.pma" -newermt "1 minute ago" 2>/dev/null | head -5

echo ""
echo "🛑 ЭКСТРЕННОЕ ЗАВЕРШЕНИЕ ВСЕХ ПРОЦЕССОВ:"
pkill -9 -f chrome
pkill -9 -f chromium
pkill -9 -f google-chrome
pkill -9 -f node
pkill -9 -f puppeteer

echo ""
echo "🛑 БЛОКИРУЕМ ЗАПУСК CHROME:"
# Переименовываем исполняемые файлы Chrome
if [ -f "/usr/bin/google-chrome" ]; then
    mv /usr/bin/google-chrome /usr/bin/google-chrome.BLOCKED
    echo "✅ Заблокирован /usr/bin/google-chrome"
fi

if [ -f "/usr/bin/chromium" ]; then
    mv /usr/bin/chromium /usr/bin/chromium.BLOCKED
    echo "✅ Заблокирован /usr/bin/chromium"
fi

if [ -f "/usr/bin/chromium-browser" ]; then
    mv /usr/bin/chromium-browser /usr/bin/chromium-browser.BLOCKED
    echo "✅ Заблокирован /usr/bin/chromium-browser"
fi

echo ""
echo "🧹 ОЧИЩАЕМ ВСЕ ФАЙЛЫ МЕТРИК:"
find /root/.config -name "BrowserMetrics-*.pma" -delete 2>/dev/null
find /tmp -name "BrowserMetrics-*.pma" -delete 2>/dev/null
find /var/tmp -name "BrowserMetrics-*.pma" -delete 2>/dev/null

echo ""
echo "🔍 ПРОВЕРЯЕМ РЕЗУЛЬТАТ (ждем 30 секунд):"
echo "Создано файлов за последние 30 секунд:"
sleep 30
find /root/.config -name "BrowserMetrics-*.pma" -newermt "30 seconds ago" 2>/dev/null | wc -l

echo ""
echo "🔍 ПРОВЕРЯЕМ ПРОЦЕССЫ ПОСЛЕ БЛОКИРОВКИ:"
ps aux | grep -i chrome | grep -v grep || echo "✅ Все процессы Chrome заблокированы"

echo ""
echo "📊 ИСПОЛЬЗОВАНИЕ ДИСКА:"
df -h /

echo ""
echo "⚠️ ВНИМАНИЕ: Chrome заблокирован! Для разблокировки выполните:"
echo "mv /usr/bin/google-chrome.BLOCKED /usr/bin/google-chrome"
echo "mv /usr/bin/chromium.BLOCKED /usr/bin/chromium"
echo "mv /usr/bin/chromium-browser.BLOCKED /usr/bin/chromium-browser"

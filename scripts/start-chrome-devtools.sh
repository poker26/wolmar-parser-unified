#!/bin/bash

echo "🌐 Starting Chrome with DevTools Protocol..."

# Проверяем, запущен ли Chrome
if pgrep -f "google-chrome" > /dev/null; then
    echo "⚠️  Chrome is already running"
    echo "💡 Killing existing Chrome processes..."
    pkill -f "google-chrome"
    sleep 2
fi

# Запускаем Chrome с DevTools
echo "🚀 Starting Chrome with DevTools on port 9222..."
export DISPLAY=:10
Xvfb :10 -ac -screen 0 1366x768x24 &
sleep 2

google-chrome-stable \
  --remote-debugging-port=9222 \
  --no-sandbox \
  --disable-setuid-sandbox \
  --disable-dev-shm-usage \
  --disable-gpu \
  --headless \
  --load-extension=/usr/local/browser-proxy-extension/chrome/ \
  --user-agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" \
  --window-size=1366,768 &

echo "✅ Chrome started with DevTools Protocol"
echo "💡 DevTools available at: http://localhost:9222"
echo "💡 Extension loaded automatically"

#!/bin/bash

# Wolmar Parser Production Stop Script
# Автор: Wolmar Team
# Версия: 2.0.0

set -e

echo "🛑 Остановка Wolmar Parser..."

# Останавливаем все процессы PM2
pm2 stop ecosystem.config.js 2>/dev/null || true
pm2 delete ecosystem.config.js 2>/dev/null || true

# Останавливаем все процессы Node.js (если остались)
pkill -f "node.*server.js" 2>/dev/null || true
pkill -f "node.*catalog-server.js" 2>/dev/null || true

echo "✅ Все процессы остановлены!"

# Показываем статус
echo "📊 Текущий статус PM2:"
pm2 status

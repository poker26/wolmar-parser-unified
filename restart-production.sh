#!/bin/bash

# Wolmar Parser Production Restart Script
# Автор: Wolmar Team
# Версия: 2.0.0

set -e

echo "🔄 Перезапуск Wolmar Parser..."

# Перезапускаем все процессы
pm2 restart ecosystem.config.js

# Показываем статус
echo "📊 Статус приложений:"
pm2 status

# Показываем последние логи
echo "📋 Последние логи:"
pm2 logs --lines 20

echo "✅ Wolmar Parser успешно перезапущен!"

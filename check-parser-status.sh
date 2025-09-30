#!/bin/bash

# Скрипт для проверки статуса парсеров
# Показывает все запущенные парсеры и их логи

echo "📊 Проверка статуса парсеров..."
echo "==============================="

echo "🔍 Статус PM2:"
pm2 status

echo ""
echo "🔍 Запущенные процессы парсера:"
ps aux | grep -E "(wolmar-parser5|update-current-auction|generate-predictions)" | grep -v grep

echo ""
echo "📋 Логи всех парсеров (последние 20 строк):"
pm2 logs --lines 20 --nostream

echo ""
echo "📊 Детальная информация о процессах:"
for process in $(pm2 jlist | jq -r '.[].name' 2>/dev/null | grep -E "(parser-|update-|predictions-)"); do
    echo "🔍 Процесс: $process"
    pm2 logs $process --lines 5 --nostream
    echo ""
done

echo "✅ Проверка завершена"

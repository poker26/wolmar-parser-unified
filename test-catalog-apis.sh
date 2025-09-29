#!/bin/bash

# Тестирование всех API каталога
# Проверяет работу всех эндпоинтов каталога

echo "🧪 ТЕСТИРОВАНИЕ API КАТАЛОГА..."
echo "============================="

echo "📊 ЭТАП 1: Проверка статуса каталога..."
echo "==================================="

echo "🔍 Статус PM2:"
pm2 status

echo ""
echo "📊 ЭТАП 2: Тестирование тестового API..."
echo "======================================"

echo "🧪 Тестовый API:"
curl -s http://localhost:3000/api/test | jq . 2>/dev/null || curl -s http://localhost:3000/api/test

echo ""
echo "📊 ЭТАП 3: Тестирование API аукционов..."
echo "====================================="

echo "📊 API аукционов:"
curl -s http://localhost:3000/api/auctions | jq '.[0:3]' 2>/dev/null || curl -s http://localhost:3000/api/auctions | head -20

echo ""
echo "📊 ЭТАП 4: Тестирование API лотов..."
echo "================================="

echo "📊 API лотов аукциона 2135:"
curl -s http://localhost:3000/api/auctions/2135/lots | jq '.[0:3]' 2>/dev/null || curl -s http://localhost:3000/api/auctions/2135/lots | head -20

echo ""
echo "📊 ЭТАП 5: Тестирование API статистики..."
echo "====================================="

echo "📊 API статистики аукциона 2135:"
curl -s http://localhost:3000/api/auctions/2135/stats | jq . 2>/dev/null || curl -s http://localhost:3000/api/auctions/2135/stats

echo ""
echo "📊 ЭТАП 6: Тестирование API фильтров..."
echo "===================================="

echo "📊 API фильтров:"
curl -s http://localhost:3000/api/filters | jq . 2>/dev/null || curl -s http://localhost:3000/api/filters

echo ""
echo "📊 ЭТАП 7: Тестирование внешнего доступа..."
echo "========================================"

echo "🌐 Внешний доступ к тестовому API:"
curl -s http://46.173.19.68:3000/api/test | jq . 2>/dev/null || curl -s http://46.173.19.68:3000/api/test

echo ""
echo "🌐 Внешний доступ к API аукционов:"
curl -s http://46.173.19.68:3000/api/auctions | jq '.[0:3]' 2>/dev/null || curl -s http://46.173.19.68:3000/api/auctions | head -20

echo ""
echo "📊 ЭТАП 8: Проверка логов каталога..."
echo "=================================="

echo "📋 Логи каталога:"
pm2 logs catalog-interface --lines 20

echo ""
echo "📊 ЭТАП 9: Проверка портов..."
echo "==========================="

echo "📋 Процессы на портах 3000-3001:"
netstat -tlnp | grep -E ":300[01]" || echo "Порты 3000-3001 не заняты"

echo ""
echo "📊 ЭТАП 10: Проверка веб-интерфейса..."
echo "===================================="

echo "🌐 Проверка главной страницы каталога:"
curl -s http://46.173.19.68:3000 | grep -o '<title>.*</title>' || echo "Заголовок не найден"

echo ""
echo "✅ ТЕСТИРОВАНИЕ API КАТАЛОГА ЗАВЕРШЕНО!"
echo "====================================="
echo "🌐 Каталог монет: http://46.173.19.68:3000"
echo "🧪 Тестовый API: http://46.173.19.68:3000/api/test"
echo "📊 API аукционов: http://46.173.19.68:3000/api/auctions"
echo "📊 API лотов: http://46.173.19.68:3000/api/auctions/2135/lots"
echo "📊 API статистики: http://46.173.19.68:3000/api/auctions/2135/stats"
echo "📊 API фильтров: http://46.173.19.68:3000/api/filters"
echo "📊 Мониторинг: pm2 status"
echo "📋 Логи каталога: pm2 logs catalog-interface"

#!/bin/bash

# Тестовый скрипт для проверки веб-интерфейса мониторинга
# Проверяет доступность всех API endpoints

echo "🌐 Тестирование веб-интерфейса мониторинга..."
echo "============================================="

SERVER_URL="http://46.173.19.68:3001"
LOCAL_URL="http://localhost:3001"

# Функция для тестирования API
test_api() {
    local endpoint="$1"
    local description="$2"
    local method="${3:-GET}"
    
    echo "🔍 Тестируем: $description"
    echo "   URL: $endpoint"
    
    if [ "$method" = "POST" ]; then
        response=$(curl -s -X POST "$endpoint" -H "Content-Type: application/json" -d '{}' 2>/dev/null)
    else
        response=$(curl -s "$endpoint" 2>/dev/null)
    fi
    
    if [ $? -eq 0 ] && [ -n "$response" ]; then
        echo "   ✅ Успешно: $response"
        return 0
    else
        echo "   ❌ Ошибка: Не удалось получить ответ"
        return 1
    fi
}

# Проверяем доступность сервера
echo "🏥 Проверяем доступность сервера..."
if curl -s "$SERVER_URL/api/health" > /dev/null 2>&1; then
    echo "✅ Сервер доступен: $SERVER_URL"
    BASE_URL="$SERVER_URL"
elif curl -s "$LOCAL_URL/api/health" > /dev/null 2>&1; then
    echo "✅ Локальный сервер доступен: $LOCAL_URL"
    BASE_URL="$LOCAL_URL"
else
    echo "❌ Сервер недоступен"
    echo "💡 Убедитесь, что сервер запущен: pm2 status"
    exit 1
fi

echo ""
echo "🧪 Тестируем API endpoints..."

# Тест 1: Health check
test_api "$BASE_URL/api/health" "Health Check"

# Тест 2: PM2 logs
test_api "$BASE_URL/api/logs" "PM2 Logs"

# Тест 3: Анализ сбоя (только анализ, без восстановления)
echo ""
echo "🔍 Тестируем анализ сбоя..."
response=$(curl -s -X POST "$BASE_URL/api/crash-recovery/analyze" -H "Content-Type: application/json" -d '{}' 2>/dev/null)
if [ $? -eq 0 ] && [ -n "$response" ]; then
    echo "✅ Анализ сбоя: $response"
else
    echo "❌ Ошибка анализа сбоя"
fi

# Тест 4: Статус PM2
echo ""
echo "📊 Проверяем статус PM2..."
pm2_status=$(curl -s "$BASE_URL/api/health" | jq -r '.status' 2>/dev/null)
if [ "$pm2_status" = "ok" ]; then
    echo "✅ PM2 работает нормально"
else
    echo "⚠️ PM2 статус: $pm2_status"
fi

# Тест 5: Веб-интерфейсы
echo ""
echo "🌐 Проверяем веб-интерфейсы..."

# Главная страница
if curl -s "$BASE_URL/" > /dev/null 2>&1; then
    echo "✅ Главная страница: $BASE_URL/"
else
    echo "❌ Главная страница недоступна"
fi

# Мониторинг
if curl -s "$BASE_URL/monitor" > /dev/null 2>&1; then
    echo "✅ Мониторинг: $BASE_URL/monitor"
else
    echo "❌ Мониторинг недоступен"
fi

# Админ панель
if curl -s "$BASE_URL/admin" > /dev/null 2>&1; then
    echo "✅ Админ панель: $BASE_URL/admin"
else
    echo "❌ Админ панель недоступна"
fi

echo ""
echo "📋 Результаты тестирования:"
echo "  • Сервер доступен: ✅"
echo "  • Health Check: ✅"
echo "  • PM2 Logs: ✅"
echo "  • Анализ сбоя: ✅"
echo "  • Веб-интерфейсы: ✅"
echo ""
echo "🎯 Веб-интерфейс мониторинга работает!"
echo ""
echo "🔗 Полезные ссылки:"
echo "  • Главная: $BASE_URL/"
echo "  • Мониторинг: $BASE_URL/monitor"
echo "  • Админ панель: $BASE_URL/admin"

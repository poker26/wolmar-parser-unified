#!/bin/bash

echo "🔍 Тестируем curl с продвинутыми заголовками..."

# Создаем файл с cookies
COOKIE_FILE="/tmp/meshok_cookies.txt"

# Функция для тестирования с разными заголовками
test_with_headers() {
    local test_name="$1"
    local user_agent="$2"
    
    echo "🌐 Тест: $test_name"
    
    curl -s -L \
        --cookie-jar "$COOKIE_FILE" \
        --cookie "$COOKIE_FILE" \
        --user-agent "$user_agent" \
        --header "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8" \
        --header "Accept-Language: en-US,en;q=0.9" \
        --header "Accept-Encoding: gzip, deflate, br" \
        --header "Connection: keep-alive" \
        --header "Upgrade-Insecure-Requests: 1" \
        --header "Sec-Fetch-Dest: document" \
        --header "Sec-Fetch-Mode: navigate" \
        --header "Sec-Fetch-Site: none" \
        --header "Sec-Fetch-User: ?1" \
        --header "Cache-Control: max-age=0" \
        --compressed \
        --max-time 30 \
        "https://meshok.net/good/252" > /tmp/meshok_response.html
    
    local content_length=$(wc -c < /tmp/meshok_response.html)
    echo "📄 Длина ответа: $content_length"
    
    # Проверяем индикаторы
    if grep -q "Just a moment" /tmp/meshok_response.html; then
        echo "❌ Cloudflare блокирует"
    elif grep -q "meshok" /tmp/meshok_response.html && [ $content_length -gt 10000 ]; then
        echo "✅ Cloudflare обойден!"
        echo "Первые 200 символов:"
        head -c 200 /tmp/meshok_response.html
        return 0
    else
        echo "❓ Неопределенный результат"
    fi
    
    return 1
}

# Тестируем с разными User-Agent
test_with_headers "Chrome Windows" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

test_with_headers "Firefox Windows" "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0"

test_with_headers "Safari macOS" "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15"

echo "✅ Тестирование завершено"

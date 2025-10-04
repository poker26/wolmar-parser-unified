#!/bin/bash

echo "🌐 Using advanced curl approach for Cloudflare bypass..."

CATEGORY_ID=${1:-252}
FINISHED=${2:-true}
OPT=${FINISHED:-true}

if [ "$OPT" = "true" ]; then
    OPT="2"
else
    OPT="1"
fi

URL="https://meshok.net/good/${CATEGORY_ID}?opt=${OPT}"
echo "📄 Fetching: ${URL}"

# Создаем папку для данных
mkdir -p data

# Создаем файл cookies
COOKIE_FILE="data/cookies.txt"

# Функция для получения случайного User-Agent
get_random_user_agent() {
    local user_agents=(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36"
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0"
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:109.0) Gecko/20100101 Firefox/121.0"
        "Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/121.0"
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15"
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0"
    )
    
    local index=$((RANDOM % ${#user_agents[@]}))
    echo "${user_agents[$index]}"
}

# Функция для получения случайного IP
get_random_ip() {
    local ips=(
        "192.168.1.100"
        "192.168.1.101"
        "192.168.1.102"
        "10.0.0.100"
        "10.0.0.101"
        "172.16.0.100"
        "172.16.0.101"
    )
    
    local index=$((RANDOM % ${#ips[@]}))
    echo "${ips[$index]}"
}

# Получаем случайные значения
USER_AGENT=$(get_random_user_agent)
CLIENT_IP=$(get_random_ip)

echo "🔍 Using User-Agent: ${USER_AGENT:0:50}..."
echo "🔍 Using Client-IP: ${CLIENT_IP}"

# Сначала получаем главную страницу для cookies
echo "⏳ Getting main page for session..."
curl -s -c "${COOKIE_FILE}" -b "${COOKIE_FILE}" \
  -H "User-Agent: ${USER_AGENT}" \
  -H "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8" \
  -H "Accept-Language: en-US,en;q=0.9,ru;q=0.8" \
  -H "Accept-Encoding: gzip, deflate, br" \
  -H "Cache-Control: no-cache" \
  -H "Pragma: no-cache" \
  -H "Sec-Fetch-Dest: document" \
  -H "Sec-Fetch-Mode: navigate" \
  -H "Sec-Fetch-Site: none" \
  -H "Sec-Fetch-User: ?1" \
  -H "Upgrade-Insecure-Requests: 1" \
  -H "DNT: 1" \
  -H "Client-IP: ${CLIENT_IP}" \
  -H "X-Forwarded-For: ${CLIENT_IP}" \
  -H "X-Real-IP: ${CLIENT_IP}" \
  --connect-timeout 30 \
  --max-time 60 \
  "https://meshok.net/" > /dev/null

echo "✅ Main page loaded, cookies saved"

# Ждем случайное время между запросами (имитация человеческого поведения)
WAIT_TIME=$((RANDOM % 3 + 1))
echo "⏳ Waiting ${WAIT_TIME} seconds (human behavior simulation)..."
sleep $WAIT_TIME

# Теперь делаем запрос к целевой странице с cookies
echo "⏳ Making request to target page with session..."

TIMESTAMP=$(date +"%Y-%m-%dT%H-%M-%S-%3N")
FILENAME="curl_advanced_good${CATEGORY_ID}_opt${OPT}_${TIMESTAMP}.html"
FILEPATH="data/${FILENAME}"

# Дополнительные заголовки для обхода защиты
curl -s -c "${COOKIE_FILE}" -b "${COOKIE_FILE}" \
  -H "User-Agent: ${USER_AGENT}" \
  -H "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8" \
  -H "Accept-Language: en-US,en;q=0.9,ru;q=0.8" \
  -H "Accept-Encoding: gzip, deflate, br" \
  -H "Cache-Control: no-cache" \
  -H "Pragma: no-cache" \
  -H "Sec-Fetch-Dest: document" \
  -H "Sec-Fetch-Mode: navigate" \
  -H "Sec-Fetch-Site: same-origin" \
  -H "Sec-Fetch-User: ?1" \
  -H "Upgrade-Insecure-Requests: 1" \
  -H "DNT: 1" \
  -H "Referer: https://meshok.net/" \
  -H "Client-IP: ${CLIENT_IP}" \
  -H "X-Forwarded-For: ${CLIENT_IP}" \
  -H "X-Real-IP: ${CLIENT_IP}" \
  -H "X-Forwarded-Proto: https" \
  -H "X-Forwarded-Host: meshok.net" \
  -H "X-Forwarded-Port: 443" \
  -H "X-Forwarded-Ssl: on" \
  -H "X-Forwarded-For: ${CLIENT_IP}" \
  -H "X-Real-IP: ${CLIENT_IP}" \
  -H "X-Forwarded-For: ${CLIENT_IP}" \
  -H "X-Forwarded-Proto: https" \
  -H "X-Forwarded-Host: meshok.net" \
  -H "X-Forwarded-Port: 443" \
  -H "X-Forwarded-Ssl: on" \
  --connect-timeout 30 \
  --max-time 60 \
  --retry 3 \
  --retry-delay 2 \
  --retry-max-time 30 \
  --compressed \
  "${URL}" > "${FILEPATH}"

# Проверяем результат
if [ -f "${FILEPATH}" ]; then
    SIZE=$(wc -c < "${FILEPATH}")
    SIZE_KB=$((SIZE / 1024))
    echo "✅ Saved to: ${FILENAME}"
    echo "📊 Size: ${SIZE_KB} KB"
    
    # Проверяем на Cloudflare
    if grep -q "Just a moment\|Один момент\|Cloudflare\|challenge" "${FILEPATH}"; then
        echo "⚠️  Cloudflare challenge detected"
        
        # Пытаемся обойти с помощью дополнительных заголовков
        echo "🔄 Attempting to bypass Cloudflare..."
        
        # Ждем еще немного
        sleep 5
        
        # Повторный запрос с другими заголовками
        curl -s -c "${COOKIE_FILE}" -b "${COOKIE_FILE}" \
          -H "User-Agent: ${USER_AGENT}" \
          -H "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8" \
          -H "Accept-Language: en-US,en;q=0.9,ru;q=0.8" \
          -H "Accept-Encoding: gzip, deflate, br" \
          -H "Cache-Control: no-cache" \
          -H "Pragma: no-cache" \
          -H "Sec-Fetch-Dest: document" \
          -H "Sec-Fetch-Mode: navigate" \
          -H "Sec-Fetch-Site: same-origin" \
          -H "Sec-Fetch-User: ?1" \
          -H "Upgrade-Insecure-Requests: 1" \
          -H "DNT: 1" \
          -H "Referer: https://meshok.net/" \
          -H "Client-IP: ${CLIENT_IP}" \
          -H "X-Forwarded-For: ${CLIENT_IP}" \
          -H "X-Real-IP: ${CLIENT_IP}" \
          -H "X-Forwarded-Proto: https" \
          -H "X-Forwarded-Host: meshok.net" \
          -H "X-Forwarded-Port: 443" \
          -H "X-Forwarded-Ssl: on" \
          --connect-timeout 30 \
          --max-time 60 \
          --retry 3 \
          --retry-delay 2 \
          --retry-max-time 30 \
          --compressed \
          "${URL}" > "${FILEPATH}"
        
        # Проверяем результат повторного запроса
        if grep -q "Just a moment\|Один момент\|Cloudflare\|challenge" "${FILEPATH}"; then
            echo "❌ Cloudflare challenge still present"
        else
            echo "✅ Cloudflare challenge bypassed!"
        fi
    else
        echo "✅ No Cloudflare challenge detected"
    fi
    
    # Поиск заголовка
    TITLE=$(grep -o '<title>[^<]*</title>' "${FILEPATH}" | sed 's/<[^>]*>//g')
    if [ -n "$TITLE" ]; then
        echo "📋 Page title: ${TITLE}"
    fi
    
    # Поиск ссылок на лоты
    ITEM_LINKS=$(grep -o 'href="/item/[^"]*"' "${FILEPATH}" | wc -l)
    echo "🔗 Item links found: ${ITEM_LINKS}"
    
    if [ "$ITEM_LINKS" -gt 0 ]; then
        echo "🎉 Successfully obtained auction data with advanced curl!"
        echo "📋 First 5 item links:"
        grep -o 'href="/item/[^"]*"' "${FILEPATH}" | head -5 | nl -nln
    else
        echo "⚠️  No auction links found"
    fi
    
    # Поиск цен
    PRICE_COUNT=$(grep -o '[0-9,]*[ ]*₽\|[0-9,]*[ ]*руб' "${FILEPATH}" | wc -l)
    if [ "$PRICE_COUNT" -gt 0 ]; then
        echo "💰 Prices found: ${PRICE_COUNT}"
        echo "📋 Sample prices:"
        grep -o '[0-9,]*[ ]*₽\|[0-9,]*[ ]*руб' "${FILEPATH}" | head -3 | nl -nln
    fi
    
    # Поиск таблиц
    TABLE_COUNT=$(grep -o '<table' "${FILEPATH}" | wc -l)
    echo "📊 Tables found: ${TABLE_COUNT}"
    
    # Поиск форм
    FORM_COUNT=$(grep -o '<form' "${FILEPATH}" | wc -l)
    echo "📝 Forms found: ${FORM_COUNT}"
    
    # Поиск JSON данных
    JSON_COUNT=$(grep -o '{[^{}]*"[^"]*"[^{}]*}' "${FILEPATH}" | wc -l)
    if [ "$JSON_COUNT" -gt 0 ]; then
        echo "📜 JSON data found: ${JSON_COUNT} matches"
        echo "📋 Sample JSON:"
        grep -o '{[^{}]*"[^"]*"[^{}]*}' "${FILEPATH}" | head -2 | nl -nln
    else
        echo "📜 No JSON data found"
    fi
    
else
    echo "❌ Failed to save file"
fi

# Очищаем cookies
rm -f "${COOKIE_FILE}"

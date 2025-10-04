#!/bin/bash

echo "🍪 Using curl with session cookies..."

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

# Сначала получаем главную страницу для cookies
echo "⏳ Getting main page for session..."
curl -s -c data/cookies.txt -b data/cookies.txt \
  -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" \
  -H "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8" \
  -H "Accept-Language: en-US,en;q=0.9" \
  -H "Accept-Encoding: gzip, deflate, br" \
  -H "Cache-Control: no-cache" \
  -H "Pragma: no-cache" \
  -H "Sec-Fetch-Dest: document" \
  -H "Sec-Fetch-Mode: navigate" \
  -H "Sec-Fetch-Site: none" \
  -H "Sec-Fetch-User: ?1" \
  -H "Upgrade-Insecure-Requests: 1" \
  -H "DNT: 1" \
  "https://meshok.net/" > /dev/null

echo "✅ Main page loaded, cookies saved"

# Ждем немного между запросами
sleep 2

# Теперь делаем запрос к целевой странице с cookies
echo "⏳ Making request to target page with session..."

TIMESTAMP=$(date +"%Y-%m-%dT%H-%M-%S-%3N")
FILENAME="curl_session_good${CATEGORY_ID}_opt${OPT}_${TIMESTAMP}.html"
FILEPATH="data/${FILENAME}"

curl -s -c data/cookies.txt -b data/cookies.txt \
  -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" \
  -H "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8" \
  -H "Accept-Language: en-US,en;q=0.9" \
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
  "${URL}" > "${FILEPATH}"

# Проверяем результат
if [ -f "${FILEPATH}" ]; then
    SIZE=$(wc -c < "${FILEPATH}")
    SIZE_KB=$((SIZE / 1024))
    echo "✅ Saved to: ${FILENAME}"
    echo "📊 Size: ${SIZE_KB} KB"
    
    # Проверяем на Cloudflare
    if grep -q "Just a moment\|Один момент" "${FILEPATH}"; then
        echo "⚠️  Cloudflare challenge detected"
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
        echo "🎉 Successfully obtained auction data with curl session!"
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
rm -f data/cookies.txt

#!/bin/bash

# Скрипт для проверки статуса HTTPS
# Запускать на сервере: bash check-https-status.sh

DOMAIN="coins.begemot26.ru"

echo "🔍 Проверка статуса HTTPS для домена: $DOMAIN"
echo ""

# 1. Проверяем статус Nginx
echo "📊 Статус Nginx:"
systemctl status nginx --no-pager -l

echo ""
echo "🔧 Конфигурация Nginx:"
nginx -t

echo ""
echo "🔒 Сертификаты Let's Encrypt:"
certbot certificates

echo ""
echo "🌐 Проверка доступности:"
echo "HTTP:"
curl -I http://$DOMAIN 2>/dev/null | head -1 || echo "❌ HTTP недоступен"

echo "HTTPS:"
curl -I https://$DOMAIN 2>/dev/null | head -1 || echo "❌ HTTPS недоступен"

echo ""
echo "🔍 Проверка SSL сертификата:"
echo | openssl s_client -servername $DOMAIN -connect $DOMAIN:443 2>/dev/null | openssl x509 -noout -dates 2>/dev/null || echo "❌ SSL сертификат недоступен"

echo ""
echo "📋 Активные сайты Nginx:"
ls -la /etc/nginx/sites-enabled/

echo ""
echo "🔗 Конфигурация домена:"
if [ -f "/etc/nginx/sites-available/$DOMAIN" ]; then
    cat /etc/nginx/sites-available/$DOMAIN
else
    echo "❌ Конфигурация для $DOMAIN не найдена"
fi

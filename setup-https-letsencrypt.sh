#!/bin/bash

# Скрипт для настройки HTTPS с Let's Encrypt
# Запускать на сервере: bash setup-https-letsencrypt.sh

set -e

DOMAIN="coins.begemot26.ru"
EMAIL="hippo26@yandex.ru"
NGINX_CONFIG="/etc/nginx/sites-available/$DOMAIN"

echo "🔧 Настройка HTTPS для домена: $DOMAIN"

# 1. Обновляем систему
echo "📦 Обновляем систему..."
apt update && apt upgrade -y

# 2. Устанавливаем Certbot
echo "🔐 Устанавливаем Certbot..."
apt install -y certbot python3-certbot-nginx

# 3. Проверяем, что Nginx установлен
if ! command -v nginx &> /dev/null; then
    echo "📦 Устанавливаем Nginx..."
    apt install -y nginx
fi

# 4. Создаем конфигурацию Nginx для домена
echo "⚙️ Создаем конфигурацию Nginx..."
cat > $NGINX_CONFIG << EOF
server {
    listen 80;
    server_name $DOMAIN;
    
    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF

# 5. Активируем конфигурацию
echo "🔗 Активируем конфигурацию Nginx..."
ln -sf $NGINX_CONFIG /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# 6. Получаем SSL сертификат
echo "🔒 Получаем SSL сертификат от Let's Encrypt..."
certbot --nginx -d $DOMAIN --email $EMAIL --agree-tos --non-interactive --redirect

# 7. Настраиваем автоматическое обновление
echo "🔄 Настраиваем автоматическое обновление сертификатов..."
(crontab -l 2>/dev/null; echo "0 12 * * * /usr/bin/certbot renew --quiet") | crontab -

# 8. Проверяем статус
echo "✅ Проверяем статус сертификата..."
certbot certificates

echo ""
echo "🎉 HTTPS настроен успешно!"
echo "🌐 Ваш сайт теперь доступен по адресу: https://$DOMAIN"
echo "🔒 Сертификат будет автоматически обновляться"
echo ""
echo "📋 Полезные команды:"
echo "  certbot certificates          - показать все сертификаты"
echo "  certbot renew --dry-run       - тест обновления"
echo "  certbot renew                 - обновить сертификаты"
echo "  systemctl status nginx        - статус Nginx"
echo "  nginx -t                      - проверить конфигурацию"

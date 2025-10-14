#!/bin/bash

# Скрипт для настройки HTTPS с самоподписанным сертификатом
# Запускать на сервере: bash setup-https-selfsigned.sh

set -e

DOMAIN="coins.begemot26.ru"
NGINX_CONFIG="/etc/nginx/sites-available/$DOMAIN"
SSL_DIR="/etc/ssl/certs"
KEY_DIR="/etc/ssl/private"

echo "🔧 Настройка HTTPS с самоподписанным сертификатом для домена: $DOMAIN"

# 1. Создаем директории для SSL
echo "📁 Создаем директории для SSL..."
mkdir -p $SSL_DIR $KEY_DIR

# 2. Генерируем приватный ключ
echo "🔑 Генерируем приватный ключ..."
openssl genrsa -out $KEY_DIR/$DOMAIN.key 2048

# 3. Создаем запрос на сертификат
echo "📝 Создаем запрос на сертификат..."
openssl req -new -key $KEY_DIR/$DOMAIN.key -out $SSL_DIR/$DOMAIN.csr -subj "/C=RU/ST=Moscow/L=Moscow/O=WolmarParser/CN=$DOMAIN"

# 4. Генерируем самоподписанный сертификат
echo "🔒 Генерируем самоподписанный сертификат..."
openssl x509 -req -days 365 -in $SSL_DIR/$DOMAIN.csr -signkey $KEY_DIR/$DOMAIN.key -out $SSL_DIR/$DOMAIN.crt

# 5. Устанавливаем правильные права доступа
echo "🔐 Устанавливаем права доступа..."
chmod 600 $KEY_DIR/$DOMAIN.key
chmod 644 $SSL_DIR/$DOMAIN.crt

# 6. Создаем конфигурацию Nginx
echo "⚙️ Создаем конфигурацию Nginx..."
cat > $NGINX_CONFIG << EOF
# HTTP - редирект на HTTPS
server {
    listen 80;
    server_name $DOMAIN;
    return 301 https://\$server_name\$request_uri;
}

# HTTPS
server {
    listen 443 ssl http2;
    server_name $DOMAIN;

    # SSL конфигурация
    ssl_certificate $SSL_DIR/$DOMAIN.crt;
    ssl_certificate_key $KEY_DIR/$DOMAIN.key;
    
    # SSL настройки безопасности
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512:ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;
    
    # HSTS заголовки
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";

    # Проксирование на ваше приложение
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
        
        # Таймауты
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
}
EOF

# 7. Активируем конфигурацию
echo "🔗 Активируем конфигурацию Nginx..."
ln -sf $NGINX_CONFIG /etc/nginx/sites-enabled/

# 8. Проверяем конфигурацию
echo "🔍 Проверяем конфигурацию Nginx..."
nginx -t

# 9. Перезагружаем Nginx
echo "🔄 Перезагружаем Nginx..."
systemctl reload nginx

# 10. Проверяем статус
echo "📊 Проверяем статус..."
systemctl status nginx --no-pager

echo ""
echo "🎉 HTTPS настроен с самоподписанным сертификатом!"
echo "🌐 Ваш сайт доступен по адресу: https://$DOMAIN"
echo ""
echo "⚠️  ВАЖНО: Браузер будет показывать предупреждение о безопасности"
echo "   Это нормально для самоподписанных сертификатов"
echo "   Нажмите 'Дополнительно' → 'Перейти на сайт'"
echo ""
echo "📋 Полезные команды:"
echo "  nginx -t                    - проверить конфигурацию"
echo "  systemctl status nginx      - статус Nginx"
echo "  systemctl reload nginx      - перезагрузить Nginx"
echo "  openssl x509 -in $SSL_DIR/$DOMAIN.crt -text -noout  - посмотреть сертификат"

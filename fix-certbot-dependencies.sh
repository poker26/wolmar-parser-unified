#!/bin/bash

# Скрипт для исправления зависимостей Certbot
# Запускать на сервере: bash fix-certbot-dependencies.sh

echo "🔧 Исправляем зависимости Certbot..."

# 1. Обновляем pip
echo "📦 Обновляем pip..."
python3 -m pip install --upgrade pip

# 2. Переустанавливаем проблемные пакеты
echo "🔄 Переустанавливаем urllib3 и requests..."
pip3 uninstall -y urllib3 requests
pip3 install urllib3==1.26.18 requests==2.31.0

# 3. Переустанавливаем certbot
echo "🔐 Переустанавливаем certbot..."
apt remove -y certbot python3-certbot-nginx
apt autoremove -y
apt install -y certbot python3-certbot-nginx

# 4. Альтернативный способ - используем snap
echo "🚀 Устанавливаем certbot через snap (более стабильно)..."
snap install core; snap refresh core
snap install --classic certbot
ln -sf /snap/bin/certbot /usr/bin/certbot

# 5. Проверяем установку
echo "✅ Проверяем установку..."
certbot --version

echo ""
echo "🎉 Certbot исправлен!"
echo "Теперь можете запустить:"
echo "certbot --nginx -d coins.begemot26.ru --agree-tos --non-interactive --email hippo26@yandex.ru"

#!/bin/bash

echo "🔧 Устанавливаем cloudscraper..."

# Устанавливаем Python зависимости
pip3 install cloudscraper requests

# Проверяем установку
python3 -c "import cloudscraper; print('✅ cloudscraper установлен')"

echo "✅ Установка завершена"

#!/bin/bash

# Wolmar Parser Production Start Script
# Автор: Wolmar Team
# Версия: 2.0.0

set -e

echo "🚀 Запуск Wolmar Parser в production режиме..."

# Проверяем наличие Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js не найден. Установите Node.js 18+ и попробуйте снова."
    exit 1
fi

# Проверяем версию Node.js
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Требуется Node.js версии 18 или выше. Текущая версия: $(node -v)"
    exit 1
fi

# Проверяем наличие PM2
if ! command -v pm2 &> /dev/null; then
    echo "📦 Установка PM2..."
    npm install -g pm2
fi

# Создаем директории для логов
mkdir -p logs
mkdir -p catalog-images
mkdir -p catalog-public

# Устанавливаем зависимости
echo "📦 Установка зависимостей..."
npm install --production

# Останавливаем существующие процессы
echo "🛑 Остановка существующих процессов..."
pm2 stop ecosystem.config.js 2>/dev/null || true
pm2 delete ecosystem.config.js 2>/dev/null || true

# Запускаем приложения
echo "🚀 Запуск приложений..."
pm2 start ecosystem.config.js

# Показываем статус
echo "📊 Статус приложений:"
pm2 status

# Показываем логи
echo "📋 Логи приложений:"
pm2 logs --lines 10

echo "✅ Wolmar Parser успешно запущен!"
echo "🌐 Основной сервер: http://localhost:3001"
echo "📚 Каталог: http://localhost:3000"
echo ""
echo "📋 Полезные команды:"
echo "  pm2 status          - статус приложений"
echo "  pm2 logs            - просмотр логов"
echo "  pm2 restart all     - перезапуск всех приложений"
echo "  pm2 stop all        - остановка всех приложений"
echo "  pm2 monit           - мониторинг в реальном времени"

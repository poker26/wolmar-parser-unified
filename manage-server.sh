#!/bin/bash

# Скрипт для управления сервером через PM2
# Использование: ./manage-server.sh [start|stop|restart|status|logs|monit]

case "$1" in
    start)
        echo "🚀 Запуск сервера..."
        pm2 start ecosystem.config.js
        ;;
    stop)
        echo "🛑 Остановка сервера..."
        pm2 stop wolmar-parser
        ;;
    restart)
        echo "🔄 Перезапуск сервера..."
        pm2 restart wolmar-parser
        ;;
    reload)
        echo "🔄 Graceful reload сервера..."
        pm2 reload wolmar-parser
        ;;
    status)
        echo "📊 Статус сервера..."
        pm2 status
        ;;
    logs)
        echo "📋 Логи сервера..."
        pm2 logs wolmar-parser --lines 50
        ;;
    monit)
        echo "📊 Мониторинг сервера..."
        pm2 monit
        ;;
    health)
        echo "🏥 Проверка здоровья сервера..."
        curl -s http://localhost:3001/api/health || echo "❌ Сервер недоступен"
        ;;
    update)
        echo "🔄 Обновление сервера..."
        git pull origin catalog-parser
        pm2 restart wolmar-parser
        ;;
    backup-logs)
        echo "💾 Резервное копирование логов..."
        tar -czf "logs-backup-$(date +%Y%m%d-%H%M%S).tar.gz" logs/
        ;;
    clean-logs)
        echo "🧹 Очистка старых логов..."
        find logs/ -name "*.log" -mtime +7 -delete
        ;;
    *)
        echo "❌ Неизвестная команда: $1"
        echo ""
        echo "📋 Доступные команды:"
        echo "  start       - запуск сервера"
        echo "  stop        - остановка сервера"
        echo "  restart     - перезапуск сервера"
        echo "  reload      - graceful reload"
        echo "  status      - статус сервера"
        echo "  logs        - просмотр логов"
        echo "  monit       - мониторинг"
        echo "  health      - проверка здоровья"
        echo "  update      - обновление с git"
        echo "  backup-logs - резервное копирование логов"
        echo "  clean-logs  - очистка старых логов"
        ;;
esac

#!/bin/bash

# Скрипт для мониторинга состояния сервера
# Использование: ./monitor-server.sh [status|health|logs|full]

case "$1" in
    status)
        echo "📊 Статус сервера:"
        pm2 status
        ;;
    health)
        echo "🏥 Health check:"
        curl -s http://localhost:3001/api/health | jq '.' || echo "❌ Сервер недоступен"
        ;;
    logs)
        echo "📋 Последние логи:"
        pm2 logs wolmar-parser --lines 20
        ;;
    full)
        echo "🔍 Полный мониторинг сервера:"
        echo ""
        echo "📊 Статус PM2:"
        pm2 status
        echo ""
        echo "🏥 Health check:"
        curl -s http://localhost:3001/api/health | jq '.' || echo "❌ Сервер недоступен"
        echo ""
        echo "📋 Последние логи:"
        pm2 logs wolmar-parser --lines 10
        echo ""
        echo "💾 Использование памяти:"
        pm2 jlist | jq '.[0].monit.memory'
        echo ""
        echo "⚡ Использование CPU:"
        pm2 jlist | jq '.[0].monit.cpu'
        ;;
    watch)
        echo "👀 Мониторинг в реальном времени (Ctrl+C для выхода):"
        pm2 monit
        ;;
    *)
        echo "❌ Неизвестная команда: $1"
        echo ""
        echo "📋 Доступные команды:"
        echo "  status  - статус сервера"
        echo "  health  - health check"
        echo "  logs    - последние логи"
        echo "  full    - полный мониторинг"
        echo "  watch   - мониторинг в реальном времени"
        ;;
esac

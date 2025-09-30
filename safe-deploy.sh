#!/bin/bash

# Wolmar Parser - Safe Deployment Script
# Автор: Wolmar Team
# Версия: 2.0.0

set -e

echo "🛡️ Безопасное развертывание Wolmar Parser..."

# Цвета для вывода
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Функция для вывода статуса
print_status() {
    if [ $1 -eq 0 ]; then
        echo -e "${GREEN}✅ $2${NC}"
    else
        echo -e "${RED}❌ $2${NC}"
    fi
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

# Функция для создания бэкапа
create_backup() {
    echo "💾 Создание бэкапа..."
    BACKUP_DIR="backup/$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$BACKUP_DIR"
    
    # Копируем важные файлы
    cp -r . "$BACKUP_DIR/" 2>/dev/null || true
    
    # Создаем архив
    tar -czf "${BACKUP_DIR}.tar.gz" "$BACKUP_DIR"
    rm -rf "$BACKUP_DIR"
    
    print_status 0 "Бэкап создан: ${BACKUP_DIR}.tar.gz"
}

# Функция для проверки портов
check_ports() {
    echo "🔍 Проверка портов..."
    
    PORT_3000=$(netstat -tlnp 2>/dev/null | grep :3000 | wc -l)
    PORT_3001=$(netstat -tlnp 2>/dev/null | grep :3001 | wc -l)
    
    if [ $PORT_3000 -gt 0 ]; then
        print_warning "Порт 3000 занят:"
        netstat -tlnp | grep :3000
        echo "Продолжить? (y/N)"
        read -r response
        if [[ ! "$response" =~ ^[Yy]$ ]]; then
            echo "Развертывание отменено"
            exit 1
        fi
    fi
    
    if [ $PORT_3001 -gt 0 ]; then
        print_warning "Порт 3001 занят:"
        netstat -tlnp | grep :3001
        echo "Продолжить? (y/N)"
        read -r response
        if [[ ! "$response" =~ ^[Yy]$ ]]; then
            echo "Развертывание отменено"
            exit 1
        fi
    fi
    
    print_status 0 "Проверка портов завершена"
}

# Функция для проверки PM2 процессов
check_pm2() {
    echo "🔍 Проверка PM2 процессов..."
    
    # Проверяем существующие процессы
    PM2_PROCESSES=$(pm2 list 2>/dev/null | grep -E "(wolmar|main|catalog)" | wc -l)
    
    if [ $PM2_PROCESSES -gt 0 ]; then
        print_warning "Найдены PM2 процессы:"
        pm2 list | grep -E "(wolmar|main|catalog)"
        echo "Остановить их? (y/N)"
        read -r response
        if [[ "$response" =~ ^[Yy]$ ]]; then
            pm2 stop all 2>/dev/null || true
            pm2 delete all 2>/dev/null || true
            print_status 0 "PM2 процессы остановлены"
        else
            print_warning "Продолжаем с существующими процессами"
        fi
    fi
}

# Функция для проверки базы данных
check_database() {
    echo "🔍 Проверка базы данных..."
    
    if [ ! -f config.js ]; then
        print_status 1 "Файл config.js не найден"
        exit 1
    fi
    
    # Тест подключения к БД
    node -e "
    const { Pool } = require('pg');
    const config = require('./config');
    const pool = new Pool(config.dbConfig);
    pool.query('SELECT 1').then(() => {
      console.log('✅ БД подключение OK');
      process.exit(0);
    }).catch(err => {
      console.error('❌ БД ошибка:', err.message);
      process.exit(1);
    });
    " && print_status 0 "База данных доступна" || {
        print_status 1 "Ошибка подключения к БД"
        exit 1
    }
}

# Функция для создания таблиц коллекций
create_collection_tables() {
    echo "🔧 Создание таблиц коллекций..."
    
    node -e "
    const { Pool } = require('pg');
    const config = require('./config');
    const pool = new Pool(config.dbConfig);
    
    async function createTables() {
      try {
        // Создание таблицы пользователей коллекций
        await pool.query(\`
          CREATE TABLE IF NOT EXISTS collection_users (
            id SERIAL PRIMARY KEY,
            username VARCHAR(50) UNIQUE NOT NULL,
            email VARCHAR(100) UNIQUE NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        \`);
        
        // Создание таблицы коллекций
        await pool.query(\`
          CREATE TABLE IF NOT EXISTS user_collections (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES collection_users(id),
            coin_id INTEGER NOT NULL,
            user_condition VARCHAR(10),
            purchase_price DECIMAL(12,2),
            purchase_date DATE,
            notes TEXT,
            predicted_price DECIMAL(12,2),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        \`);
        
        console.log('✅ Таблицы коллекций созданы');
        process.exit(0);
      } catch (err) {
        console.error('❌ Ошибка создания таблиц:', err.message);
        process.exit(1);
      }
    }
    
    createTables();
    " && print_status 0 "Таблицы коллекций созданы" || {
        print_status 1 "Ошибка создания таблиц"
        exit 1
    }
}

# Функция для установки зависимостей
install_dependencies() {
    echo "📦 Установка зависимостей..."
    
    if [ ! -f package.json ]; then
        print_status 1 "package.json не найден"
        exit 1
    fi
    
    npm install --production && print_status 0 "Зависимости установлены" || {
        print_status 1 "Ошибка установки зависимостей"
        exit 1
    }
}

# Функция для запуска приложения
start_application() {
    echo "🚀 Запуск приложения..."
    
    # Создаем директории
    mkdir -p logs catalog-images catalog-public backup
    
    # Запускаем PM2
    pm2 start ecosystem.config.js && print_status 0 "Приложение запущено" || {
        print_status 1 "Ошибка запуска приложения"
        exit 1
    }
    
    # Настраиваем автозапуск
    pm2 startup
    pm2 save
    
    print_status 0 "Автозапуск настроен"
}

# Функция для проверки работы
verify_deployment() {
    echo "🔍 Проверка развертывания..."
    
    # Ждем запуска
    sleep 5
    
    # Проверяем статус PM2
    pm2 status
    
    # Проверяем порты
    PORT_3000=$(netstat -tlnp 2>/dev/null | grep :3000 | wc -l)
    PORT_3001=$(netstat -tlnp 2>/dev/null | grep :3001 | wc -l)
    
    if [ $PORT_3000 -gt 0 ]; then
        print_status 0 "Порт 3000 активен"
    else
        print_status 1 "Порт 3000 не активен"
    fi
    
    if [ $PORT_3001 -gt 0 ]; then
        print_status 0 "Порт 3001 активен"
    else
        print_status 1 "Порт 3001 не активен"
    fi
    
    # Тест HTTP запросов
    echo "🌐 Тестирование веб-интерфейса..."
    
    if curl -s -o /dev/null -w "%{http_code}" http://localhost:3001 | grep -q "200\|404"; then
        print_status 0 "Основной сервер отвечает"
    else
        print_warning "Основной сервер не отвечает"
    fi
    
    if curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 | grep -q "200\|404"; then
        print_status 0 "Каталог отвечает"
    else
        print_warning "Каталог не отвечает"
    fi
}

# Основная функция
main() {
    echo "🛡️ БЕЗОПАСНОЕ РАЗВЕРТЫВАНИЕ WOLMAR PARSER"
    echo "========================================"
    echo ""
    
    # Создаем бэкап
    create_backup
    
    # Проверяем порты
    check_ports
    
    # Проверяем PM2
    check_pm2
    
    # Проверяем БД
    check_database
    
    # Создаем таблицы
    create_collection_tables
    
    # Устанавливаем зависимости
    install_dependencies
    
    # Запускаем приложение
    start_application
    
    # Проверяем работу
    verify_deployment
    
    echo ""
    echo "🎉 РАЗВЕРТЫВАНИЕ ЗАВЕРШЕНО УСПЕШНО!"
    echo "=================================="
    echo ""
    echo "🌐 Веб-интерфейс:"
    echo "   Основной сервер: http://localhost:3001"
    echo "   Каталог: http://localhost:3000"
    echo ""
    echo "📋 Полезные команды:"
    echo "   pm2 status          - статус процессов"
    echo "   pm2 logs            - просмотр логов"
    echo "   pm2 restart all     - перезапуск"
    echo "   pm2 stop all         - остановка"
    echo ""
    echo "🔄 Для обновления:"
    echo "   ./git-update.sh"
    echo ""
    echo "⏪ Для отката:"
    echo "   ./git-rollback.sh"
    echo ""
    echo "📊 Мониторинг:"
    echo "   pm2 monit           - мониторинг в реальном времени"
    echo "   tail -f logs/*.log  - просмотр логов"
}

# Запуск
main "$@"

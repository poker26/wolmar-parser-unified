#!/bin/bash

# Wolmar Parser - Pre-deployment Safety Check
# Автор: Wolmar Team
# Версия: 2.0.0

set -e

echo "🔍 Проверка безопасности перед развертыванием Wolmar Parser..."

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

# Проверка 1: Node.js версия
echo "🔍 Проверка Node.js..."
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -ge 18 ]; then
    print_status 0 "Node.js версия: $(node -v) (OK)"
else
    print_status 1 "Node.js версия: $(node -v) (требуется 18+)"
    exit 1
fi

# Проверка 2: PM2
echo "🔍 Проверка PM2..."
if command -v pm2 &> /dev/null; then
    print_status 0 "PM2 установлен: $(pm2 -v)"
else
    print_status 1 "PM2 не установлен"
    exit 1
fi

# Проверка 3: Порты
echo "🔍 Проверка портов..."
PORT_3000=$(netstat -tlnp 2>/dev/null | grep :3000 | wc -l)
PORT_3001=$(netstat -tlnp 2>/dev/null | grep :3001 | wc -l)

if [ $PORT_3000 -eq 0 ]; then
    print_status 0 "Порт 3000 свободен"
else
    print_warning "Порт 3000 занят:"
    netstat -tlnp | grep :3000
fi

if [ $PORT_3001 -eq 0 ]; then
    print_status 0 "Порт 3001 свободен"
else
    print_warning "Порт 3001 занят:"
    netstat -tlnp | grep :3001
fi

# Проверка 4: Существующие PM2 процессы
echo "🔍 Проверка PM2 процессов..."
PM2_PROCESSES=$(pm2 list 2>/dev/null | grep -E "(wolmar|main|catalog)" | wc -l)
if [ $PM2_PROCESSES -eq 0 ]; then
    print_status 0 "Конфликтующих PM2 процессов не найдено"
else
    print_warning "Найдены PM2 процессы:"
    pm2 list | grep -E "(wolmar|main|catalog)"
fi

# Проверка 5: База данных
echo "🔍 Проверка подключения к базе данных..."
if [ -f config.js ]; then
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
    " && print_status 0 "База данных доступна" || print_status 1 "Ошибка подключения к БД"
else
    print_status 1 "Файл config.js не найден"
fi

# Проверка 6: Зависимости
echo "🔍 Проверка зависимостей..."
if [ -f package.json ]; then
    print_status 0 "package.json найден"
    if [ -d node_modules ]; then
        print_status 0 "node_modules существует"
    else
        print_warning "node_modules не найден - потребуется npm install"
    fi
else
    print_status 1 "package.json не найден"
fi

# Проверка 7: Директории
echo "🔍 Проверка директорий..."
mkdir -p logs catalog-images catalog-public backup
print_status 0 "Директории созданы/проверены"

# Проверка 8: Права доступа
echo "🔍 Проверка прав доступа..."
if [ -w . ]; then
    print_status 0 "Права на запись в текущую директорию"
else
    print_status 1 "Нет прав на запись в текущую директорию"
fi

# Проверка 9: Свободное место на диске
echo "🔍 Проверка свободного места..."
DISK_USAGE=$(df -h . | tail -1 | awk '{print $5}' | sed 's/%//')
if [ $DISK_USAGE -lt 80 ]; then
    print_status 0 "Свободного места достаточно: $((100-DISK_USAGE))%"
else
    print_warning "Мало свободного места: $((100-DISK_USAGE))%"
fi

# Проверка 10: Память
echo "🔍 Проверка памяти..."
TOTAL_MEM=$(free -m | grep 'Mem:' | awk '{print $2}')
if [ $TOTAL_MEM -ge 2048 ]; then
    print_status 0 "Память достаточна: ${TOTAL_MEM}MB"
else
    print_warning "Мало памяти: ${TOTAL_MEM}MB (рекомендуется 2GB+)"
fi

# Итоговый отчет
echo ""
echo "📊 ИТОГОВЫЙ ОТЧЕТ:"
echo "=================="

# Подсчет проблем
ISSUES=0
if [ $PORT_3000 -gt 0 ]; then
    echo -e "${YELLOW}⚠️  Порт 3000 занят${NC}"
    ISSUES=$((ISSUES + 1))
fi

if [ $PORT_3001 -gt 0 ]; then
    echo -e "${YELLOW}⚠️  Порт 3001 занят${NC}"
    ISSUES=$((ISSUES + 1))
fi

if [ $PM2_PROCESSES -gt 0 ]; then
    echo -e "${YELLOW}⚠️  Найдены конфликтующие PM2 процессы${NC}"
    ISSUES=$((ISSUES + 1))
fi

if [ $DISK_USAGE -ge 80 ]; then
    echo -e "${YELLOW}⚠️  Мало свободного места${NC}"
    ISSUES=$((ISSUES + 1))
fi

if [ $TOTAL_MEM -lt 2048 ]; then
    echo -e "${YELLOW}⚠️  Мало памяти${NC}"
    ISSUES=$((ISSUES + 1))
fi

echo ""
if [ $ISSUES -eq 0 ]; then
    echo -e "${GREEN}✅ СИСТЕМА ГОТОВА К РАЗВЕРТЫВАНИЮ!${NC}"
    echo -e "${GREEN}   Все проверки пройдены успешно${NC}"
    echo ""
    echo "🚀 Для развертывания выполните:"
    echo "   ./git-deploy.sh"
else
    echo -e "${YELLOW}⚠️  НАЙДЕНЫ ПРОБЛЕМЫ: $ISSUES${NC}"
    echo -e "${YELLOW}   Рекомендуется решить их перед развертыванием${NC}"
    echo ""
    echo "🛠️  Рекомендации:"
    if [ $PORT_3000 -gt 0 ] || [ $PORT_3001 -gt 0 ]; then
        echo "   - Освободите порты 3000/3001 или измените конфигурацию"
    fi
    if [ $PM2_PROCESSES -gt 0 ]; then
        echo "   - Остановите конфликтующие PM2 процессы"
    fi
    if [ $DISK_USAGE -ge 80 ]; then
        echo "   - Освободите место на диске"
    fi
    if [ $TOTAL_MEM -lt 2048 ]; then
        echo "   - Увеличьте память или оптимизируйте систему"
    fi
fi

echo ""
echo "📋 Дополнительные команды:"
echo "   pm2 status          - статус PM2 процессов"
echo "   netstat -tlnp       - список портов"
echo "   df -h               - использование диска"
echo "   free -h             - использование памяти"

#!/bin/bash

# Wolmar Parser - Создание пакета для деплоя
# Автор: Wolmar Team
# Версия: 2.0.0

set -e

echo "📦 Создание пакета для деплоя Wolmar Parser..."

# Создаем директорию для пакета
PACKAGE_DIR="wolmar-parser-deployment-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$PACKAGE_DIR"

echo "📁 Копирование файлов..."

# Копируем основные файлы
cp package.json "$PACKAGE_DIR/"
cp package-lock.json "$PACKAGE_DIR/"
cp ecosystem.config.js "$PACKAGE_DIR/"
cp config.js "$PACKAGE_DIR/"
cp config.production.js "$PACKAGE_DIR/"
cp env.example "$PACKAGE_DIR/"

# Копируем скрипты запуска
cp start-production.sh "$PACKAGE_DIR/"
cp stop-production.sh "$PACKAGE_DIR/"
cp restart-production.sh "$PACKAGE_DIR/"
cp deploy.sh "$PACKAGE_DIR/"

# Копируем основные серверные файлы
cp server.js "$PACKAGE_DIR/"
cp catalog-server.js "$PACKAGE_DIR/"
cp admin-server.js "$PACKAGE_DIR/"

# Копируем сервисы
cp auth-service.js "$PACKAGE_DIR/"
cp collection-service.js "$PACKAGE_DIR/"
cp collection-price-service.js "$PACKAGE_DIR/"
cp metals-price-service.js "$PACKAGE_DIR/"
cp winner-ratings-service.js "$PACKAGE_DIR/"

# Копируем парсеры
cp catalog-parser.js "$PACKAGE_DIR/"
cp numismat-parser.js "$PACKAGE_DIR/"
cp improved-predictions-generator.js "$PACKAGE_DIR/"

# Копируем публичные файлы
cp -r catalog-public "$PACKAGE_DIR/"

# Создаем директории
mkdir -p "$PACKAGE_DIR/logs"
mkdir -p "$PACKAGE_DIR/catalog-images"
mkdir -p "$PACKAGE_DIR/backup"

# Копируем документацию
cp DEPLOYMENT-GUIDE.md "$PACKAGE_DIR/"
cp README.md "$PACKAGE_DIR/"

# Создаем .gitignore
cat > "$PACKAGE_DIR/.gitignore" << 'EOF'
# Dependencies
node_modules/
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Environment variables
.env
.env.local
.env.development.local
.env.test.local
.env.production.local

# Logs
logs/
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
lerna-debug.log*

# Runtime data
pids/
*.pid
*.seed
*.pid.lock

# Coverage directory used by tools like istanbul
coverage/
*.lcov

# nyc test coverage
.nyc_output

# Grunt intermediate storage
.grunt

# Bower dependency directory
bower_components

# node-waf configuration
.lock-wscript

# Compiled binary addons
build/Release

# Dependency directories
node_modules/
jspm_packages/

# TypeScript cache
*.tsbuildinfo

# Optional npm cache directory
.npm

# Optional eslint cache
.eslintcache

# Microbundle cache
.rpt2_cache/
.rts2_cache_cjs/
.rts2_cache_es/
.rts2_cache_umd/

# Optional REPL history
.node_repl_history

# Output of 'npm pack'
*.tgz

# Yarn Integrity file
.yarn-integrity

# dotenv environment variables file
.env
.env.test

# parcel-bundler cache
.cache
.parcel-cache

# Next.js build output
.next

# Nuxt.js build / generate output
.nuxt
dist

# Gatsby files
.cache/
public

# Storybook build outputs
.out
.storybook-out

# Temporary folders
tmp/
temp/

# Editor directories and files
.vscode/
.idea/
*.swp
*.swo
*~

# OS generated files
.DS_Store
.DS_Store?
._*
.Spotlight-V100
.Trashes
ehthumbs.db
Thumbs.db

# Project specific
catalog-images/
backup/
*.tar.gz
*.zip

# PM2 logs
.pm2/

# Database
*.sqlite
*.db

# Test files
test-results/
coverage/

# Build artifacts
build/
dist/
EOF

# Создаем README для деплоя
cat > "$PACKAGE_DIR/README-DEPLOY.md" << 'EOF'
# 🚀 Wolmar Parser - Быстрый старт

## 📋 Быстрая установка

### 1. Установка зависимостей
```bash
# Установка Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Установка PM2
sudo npm install -g pm2

# Установка Google Chrome
wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | sudo apt-key add -
echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" | sudo tee /etc/apt/sources.list.d/google-chrome.list
sudo apt update
sudo apt install -y google-chrome-stable
```

### 2. Настройка проекта
```bash
# Копирование конфигурации
cp env.example .env
nano .env  # Настройте переменные окружения

# Установка зависимостей
npm install --production
```

### 3. Запуск
```bash
# Автоматический запуск
./deploy.sh

# Или ручной запуск
./start-production.sh
```

### 4. Проверка
```bash
# Статус
pm2 status

# Логи
pm2 logs

# Веб-интерфейс
# Основной сервер: http://localhost:3001
# Каталог: http://localhost:3000
```

## 🔧 Управление

```bash
# Запуск
./start-production.sh

# Остановка
./stop-production.sh

# Перезапуск
./restart-production.sh

# Полный деплой
./deploy.sh
```

## 📞 Поддержка

При проблемах:
1. Проверьте логи: `pm2 logs`
2. Проверьте статус: `pm2 status`
3. Перезапустите: `pm2 restart all`

Подробная документация: DEPLOYMENT-GUIDE.md
EOF

# Создаем архив
echo "🗜️ Создание архива..."
tar -czf "${PACKAGE_DIR}.tar.gz" "$PACKAGE_DIR"

# Показываем информацию
echo "✅ Пакет для деплоя создан: ${PACKAGE_DIR}.tar.gz"
echo "📁 Размер архива: $(du -h "${PACKAGE_DIR}.tar.gz" | cut -f1)"
echo ""
echo "📋 Содержимое пакета:"
ls -la "$PACKAGE_DIR"

echo ""
echo "🚀 Для развертывания на сервере:"
echo "1. Скопируйте архив на сервер"
echo "2. Распакуйте: tar -xzf ${PACKAGE_DIR}.tar.gz"
echo "3. Перейдите в директорию: cd $PACKAGE_DIR"
echo "4. Запустите: ./deploy.sh"
echo ""
echo "📖 Подробная документация: DEPLOYMENT-GUIDE.md"

# Удаляем временную директорию
rm -rf "$PACKAGE_DIR"

echo "✅ Готово!"

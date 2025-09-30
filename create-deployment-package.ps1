# Wolmar Parser - Создание пакета для деплоя
# Автор: Wolmar Team
# Версия: 2.0.0

Write-Host "📦 Создание пакета для деплоя Wolmar Parser..." -ForegroundColor Green

# Создаем директорию для пакета
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$packageDir = "wolmar-parser-deployment-$timestamp"
New-Item -ItemType Directory -Path $packageDir -Force | Out-Null

Write-Host "📁 Копирование файлов..." -ForegroundColor Yellow

# Копируем основные файлы
$filesToCopy = @(
    "package.json",
    "package-lock.json", 
    "ecosystem.config.js",
    "config.js",
    "config.production.js",
    "env.example"
)

foreach ($file in $filesToCopy) {
    if (Test-Path $file) {
        Copy-Item $file $packageDir
        Write-Host "  ✓ $file" -ForegroundColor Green
    } else {
        Write-Host "  ⚠ $file не найден" -ForegroundColor Yellow
    }
}

# Копируем скрипты запуска
$scriptsToCopy = @(
    "start-production.sh",
    "stop-production.sh", 
    "restart-production.sh",
    "deploy.sh"
)

foreach ($script in $scriptsToCopy) {
    if (Test-Path $script) {
        Copy-Item $script $packageDir
        Write-Host "  ✓ $script" -ForegroundColor Green
    } else {
        Write-Host "  ⚠ $script не найден" -ForegroundColor Yellow
    }
}

# Копируем основные серверные файлы
$serverFiles = @(
    "server.js",
    "catalog-server.js",
    "admin-server.js"
)

foreach ($file in $serverFiles) {
    if (Test-Path $file) {
        Copy-Item $file $packageDir
        Write-Host "  ✓ $file" -ForegroundColor Green
    } else {
        Write-Host "  ⚠ $file не найден" -ForegroundColor Yellow
    }
}

# Копируем сервисы
$services = @(
    "auth-service.js",
    "collection-service.js",
    "collection-price-service.js",
    "metals-price-service.js",
    "winner-ratings-service.js"
)

foreach ($service in $services) {
    if (Test-Path $service) {
        Copy-Item $service $packageDir
        Write-Host "  ✓ $service" -ForegroundColor Green
    } else {
        Write-Host "  ⚠ $service не найден" -ForegroundColor Yellow
    }
}

# Копируем парсеры
$parsers = @(
    "catalog-parser.js",
    "numismat-parser.js",
    "improved-predictions-generator.js"
)

foreach ($parser in $parsers) {
    if (Test-Path $parser) {
        Copy-Item $parser $packageDir
        Write-Host "  ✓ $parser" -ForegroundColor Green
    } else {
        Write-Host "  ⚠ $parser не найден" -ForegroundColor Yellow
    }
}

# Копируем публичные файлы
if (Test-Path "catalog-public") {
    Copy-Item -Recurse "catalog-public" "$packageDir/catalog-public"
    Write-Host "  ✓ catalog-public/" -ForegroundColor Green
} else {
    Write-Host "  ⚠ catalog-public/ не найден" -ForegroundColor Yellow
}

# Создаем директории
New-Item -ItemType Directory -Path "$packageDir/logs" -Force | Out-Null
New-Item -ItemType Directory -Path "$packageDir/catalog-images" -Force | Out-Null
New-Item -ItemType Directory -Path "$packageDir/backup" -Force | Out-Null

# Копируем документацию
$docs = @(
    "DEPLOYMENT-GUIDE.md",
    "README.md",
    "README-PRODUCTION.md"
)

foreach ($doc in $docs) {
    if (Test-Path $doc) {
        Copy-Item $doc $packageDir
        Write-Host "  ✓ $doc" -ForegroundColor Green
    } else {
        Write-Host "  ⚠ $doc не найден" -ForegroundColor Yellow
    }
}

# Создаем .gitignore
$gitignoreContent = @"
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
"@

Set-Content -Path "$packageDir/.gitignore" -Value $gitignoreContent

# Создаем README для деплоя
$readmeContent = @"
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
"@

Set-Content -Path "$packageDir/README-DEPLOY.md" -Value $readmeContent

# Создаем архив
Write-Host "🗜️ Создание архива..." -ForegroundColor Yellow
$archiveName = "$packageDir.zip"
Compress-Archive -Path $packageDir -DestinationPath $archiveName -Force

# Показываем информацию
$archiveSize = (Get-Item $archiveName).Length
$archiveSizeMB = [math]::Round($archiveSize / 1MB, 2)

Write-Host "✅ Пакет для деплоя создан: $archiveName" -ForegroundColor Green
Write-Host "📁 Размер архива: $archiveSizeMB MB" -ForegroundColor Cyan
Write-Host ""
Write-Host "📋 Содержимое пакета:" -ForegroundColor Yellow
Get-ChildItem $packageDir | Format-Table Name, Length -AutoSize

Write-Host ""
Write-Host "🚀 Для развертывания на сервере:" -ForegroundColor Green
Write-Host "1. Скопируйте архив на сервер" -ForegroundColor White
Write-Host "2. Распакуйте: unzip $archiveName" -ForegroundColor White
Write-Host "3. Перейдите в директорию: cd $packageDir" -ForegroundColor White
Write-Host "4. Запустите: ./deploy.sh" -ForegroundColor White
Write-Host ""
Write-Host "📖 Подробная документация: DEPLOYMENT-GUIDE.md" -ForegroundColor Cyan

# Удаляем временную директорию
Remove-Item -Recurse -Force $packageDir

Write-Host "✅ Готово!" -ForegroundColor Green

Write-Host "📦 Создание ручного развертывания для сервера..." -ForegroundColor Green

# Создаем директорию для ручного развертывания
New-Item -ItemType Directory -Path "manual-deployment" -Force | Out-Null

# Копируем скрипты решения конфликтов
Write-Host "📋 Копирование скриптов решения конфликтов..." -ForegroundColor Yellow
Copy-Item "fix-server-git-conflict.sh" "manual-deployment/"
Copy-Item "force-update-catalog.sh" "manual-deployment/"

# Копируем основные файлы каталога
Write-Host "📁 Копирование файлов каталога..." -ForegroundColor Yellow
Copy-Item "catalog-parser.js" "manual-deployment/"
Copy-Item "catalog-server.js" "manual-deployment/"
Copy-Item "catalog-monitor.js" "manual-deployment/"
Copy-Item "catalog-public" "manual-deployment/" -Recurse

# Копируем конфигурацию
Copy-Item "config.js" "manual-deployment/"
Copy-Item "package.json" "manual-deployment/"

# Создаем инструкцию для ручного развертывания
$manualDeploymentContent = @"
# Ручное развертывание каталога на сервере

## Шаги развертывания:

1. **Остановите существующие процессы:**
   ```bash
   pm2 stop catalog-parser 2>/dev/null || true
   pm2 stop catalog-server 2>/dev/null || true
   ```

2. **Скопируйте файлы в рабочую директорию:**
   ```bash
   cp catalog-parser.js /var/www/wolmar-parser/
   cp catalog-server.js /var/www/wolmar-parser/
   cp catalog-monitor.js /var/www/wolmar-parser/
   cp -r catalog-public/ /var/www/wolmar-parser/
   ```

3. **Установите зависимости:**
   ```bash
   cd /var/www/wolmar-parser
   npm install
   ```

4. **Запустите каталог:**
   ```bash
   pm2 start catalog-parser.js --name catalog-parser
   pm2 start catalog-server.js --name catalog-server
   pm2 save
   ```

5. **Проверьте статус:**
   ```bash
   pm2 status
   curl http://localhost:3000
   ```

## Альтернативно - используйте скрипты:

### Мягкое решение конфликта:
```bash
chmod +x fix-server-git-conflict.sh
./fix-server-git-conflict.sh
```

### Принудительное обновление:
```bash
chmod +x force-update-catalog.sh
./force-update-catalog.sh
```
"@

$manualDeploymentContent | Out-File -FilePath "manual-deployment/MANUAL-DEPLOYMENT.md" -Encoding UTF8

# Создаем архив
Write-Host "📦 Создание архива..." -ForegroundColor Yellow
Compress-Archive -Path "manual-deployment/*" -DestinationPath "manual-deployment.zip" -Force

Write-Host "✅ Ручное развертывание готово!" -ForegroundColor Green
$archiveSize = (Get-Item "manual-deployment.zip").Length
Write-Host "📁 Архив: manual-deployment.zip" -ForegroundColor Cyan
Write-Host "📋 Размер: $([math]::Round($archiveSize/1MB, 2)) MB" -ForegroundColor Cyan

Write-Host ""
Write-Host "📤 Для загрузки на сервер:" -ForegroundColor Yellow
Write-Host "1. Скопируйте manual-deployment.zip на сервер" -ForegroundColor White
Write-Host "2. Распакуйте: unzip manual-deployment.zip" -ForegroundColor White
Write-Host "3. Следуйте инструкциям в MANUAL-DEPLOYMENT.md" -ForegroundColor White

Write-Host ""
Write-Host "📋 Содержимое архива:" -ForegroundColor Yellow
Get-ChildItem "manual-deployment" -Recurse | Select-Object Name, Length

#!/bin/bash

echo "📦 Создание ручного развертывания для сервера..."

# Создаем директорию для ручного развертывания
mkdir -p manual-deployment

# Копируем скрипты решения конфликтов
echo "📋 Копирование скриптов решения конфликтов..."
cp fix-server-git-conflict.sh manual-deployment/
cp force-update-catalog.sh manual-deployment/

# Копируем основные файлы каталога
echo "📁 Копирование файлов каталога..."
cp catalog-parser.js manual-deployment/
cp catalog-server.js manual-deployment/
cp catalog-monitor.js manual-deployment/
cp catalog-public/ manual-deployment/ -r

# Копируем конфигурацию
cp config.js manual-deployment/
cp package.json manual-deployment/

# Создаем инструкцию для ручного развертывания
cat > manual-deployment/MANUAL-DEPLOYMENT.md << 'EOF'
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
EOF

# Создаем архив
echo "📦 Создание архива..."
tar -czf manual-deployment.tar.gz manual-deployment/

echo "✅ Ручное развертывание готово!"
echo "📁 Архив: manual-deployment.tar.gz"
echo "📋 Размер: $(du -h manual-deployment.tar.gz | cut -f1)"
echo ""
echo "📤 Для загрузки на сервер:"
echo "1. Скопируйте manual-deployment.tar.gz на сервер"
echo "2. Распакуйте: tar -xzf manual-deployment.tar.gz"
echo "3. Следуйте инструкциям в MANUAL-DEPLOYMENT.md"

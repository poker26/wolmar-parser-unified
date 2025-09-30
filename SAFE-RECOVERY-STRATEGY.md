# 🛡️ БЕЗОПАСНАЯ СТРАТЕГИЯ ВОССТАНОВЛЕНИЯ

## Проблема
- Ветка `main` НЕ содержит важные файлы (admin-server.js, public/admin.html и др.)
- Все важные файлы находятся в ветке `catalog-parser`
- Нужно восстановить основной сайт БЕЗ потери данных

## Безопасная стратегия:

### 1. Сначала создадим резервную копию текущего состояния:
```bash
# На сервере
cp -r /var/www/wolmar-parser /var/www/wolmar-parser-backup
```

### 2. Переключимся на ветку catalog-parser (где есть все файлы):
```bash
git checkout catalog-parser
git pull origin catalog-parser
```

### 3. Остановим все процессы:
```bash
pm2 stop all
pm2 delete all
```

### 4. Запустим ТОЛЬКО основной сайт (без каталога):
```bash
pm2 start server.js --name wolmar-parser
pm2 start admin-server.js --name admin-server
pm2 save
```

### 5. Проверим работу основного сайта:
```bash
curl http://localhost:3001
curl http://localhost:3001/admin
```

## После восстановления основного сайта:
1. Каталог будет доступен в отдельной ветке
2. Основной сайт будет работать из ветки catalog-parser
3. Никакие данные не будут потеряны

## Команды для сервера:
```bash
ssh root@46.173.19.68
cd /var/www/wolmar-parser
cp -r /var/www/wolmar-parser /var/www/wolmar-parser-backup
git checkout catalog-parser
git pull origin catalog-parser
pm2 stop all
pm2 delete all
pm2 start server.js --name wolmar-parser
pm2 start admin-server.js --name admin-server
pm2 save
```

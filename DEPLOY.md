# 🚀 Деплой Wolmar Parser на хостинг

## Подготовка к деплою

### 1. Требования к хостингу
- **Node.js** версии 16.0.0 или выше
- **npm** версии 8.0.0 или выше
- **PM2** для управления процессами
- **SSH** доступ к серверу
- **Порт 3000** доступен для приложения

### 2. Подготовка файлов
Убедитесь, что все файлы проекта загружены на сервер:
- `server.js` - основной файл сервера
- `package.json` - зависимости проекта
- `ecosystem.config.js` - конфигурация PM2
- `config.production.js` - конфигурация для продакшена
- `public/` - статические файлы фронтенда
- Все парсеры и утилиты

### 3. Настройка переменных окружения
Создайте файл `.env` на основе `env.example`:
```bash
cp env.example .env
nano .env
```

Заполните переменные:
- `DB_PASSWORD` - пароль от Supabase
- `JWT_SECRET` - секретный ключ для JWT
- Другие параметры по необходимости

## Установка и запуск

### 1. Установка зависимостей
```bash
npm install --production
```

### 2. Установка PM2 (если не установлен)
```bash
npm install -g pm2
```

### 3. Запуск приложения
```bash
# Сделать скрипт исполняемым
chmod +x deploy.sh

# Запустить деплой
./deploy.sh
```

### 4. Ручной запуск (альтернатива)
```bash
# Запуск с PM2
pm2 start ecosystem.config.js --env production

# Сохранение конфигурации PM2
pm2 save

# Настройка автозапуска (опционально)
pm2 startup
```

## Управление приложением

### Команды PM2
```bash
# Статус приложения
pm2 status

# Логи приложения
pm2 logs wolmar-parser

# Перезапуск приложения
pm2 restart wolmar-parser

# Остановка приложения
pm2 stop wolmar-parser

# Удаление приложения
pm2 delete wolmar-parser
```

### Мониторинг
```bash
# Мониторинг в реальном времени
pm2 monit

# Информация о процессе
pm2 show wolmar-parser
```

## Настройка веб-сервера

### Nginx (рекомендуется)
Создайте конфигурацию для Nginx:
```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### Apache
Если используете Apache, настройте проксирование:
```apache
<VirtualHost *:80>
    ServerName your-domain.com
    ProxyPreserveHost On
    ProxyPass / http://localhost:3000/
    ProxyPassReverse / http://localhost:3000/
</VirtualHost>
```

## SSL сертификат

### Let's Encrypt (бесплатно)
```bash
# Установка Certbot
sudo apt install certbot python3-certbot-nginx

# Получение сертификата
sudo certbot --nginx -d your-domain.com

# Автообновление
sudo crontab -e
# Добавить: 0 12 * * * /usr/bin/certbot renew --quiet
```

## Резервное копирование

### Автоматическое резервное копирование
Создайте скрипт `backup.sh`:
```bash
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
tar -czf "backup_$DATE.tar.gz" \
    --exclude=node_modules \
    --exclude=logs \
    --exclude=.git \
    .
```

### Настройка cron для резервного копирования
```bash
# Редактировать crontab
crontab -e

# Добавить задачу (ежедневно в 2:00)
0 2 * * * /path/to/backup.sh
```

## Мониторинг и логи

### Логи приложения
- **PM2 логи**: `pm2 logs wolmar-parser`
- **Файлы логов**: `./logs/`
- **Системные логи**: `/var/log/`

### Мониторинг ресурсов
```bash
# Использование CPU и памяти
htop

# Использование диска
df -h

# Сетевые соединения
netstat -tulpn
```

## Обновление приложения

### 1. Остановка приложения
```bash
pm2 stop wolmar-parser
```

### 2. Обновление кода
```bash
# Загрузка новых файлов
# Или git pull если используете Git
```

### 3. Установка новых зависимостей
```bash
npm install --production
```

### 4. Запуск приложения
```bash
pm2 start wolmar-parser
```

## Устранение неполадок

### Проблемы с портами
```bash
# Проверка занятых портов
sudo netstat -tulpn | grep :3000

# Освобождение порта
sudo kill -9 PID
```

### Проблемы с правами доступа
```bash
# Установка правильных прав
chmod +x deploy.sh
chmod -R 755 public/
```

### Проблемы с базой данных
- Проверьте подключение к Supabase
- Убедитесь в правильности переменных окружения
- Проверьте SSL сертификаты

## Контакты и поддержка

При возникновении проблем:
1. Проверьте логи: `pm2 logs wolmar-parser`
2. Проверьте статус: `pm2 status`
3. Проверьте системные ресурсы: `htop`, `df -h`
4. Обратитесь к документации PM2: https://pm2.keymetrics.io/docs/
























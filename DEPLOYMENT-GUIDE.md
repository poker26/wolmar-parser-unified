# 🚀 Wolmar Parser - Руководство по развертыванию

## 📋 Требования к серверу

### Минимальные требования:
- **ОС**: Ubuntu 20.04+ / CentOS 8+ / Debian 11+
- **RAM**: 4GB (рекомендуется 8GB+)
- **CPU**: 2 ядра (рекомендуется 4+)
- **Диск**: 20GB свободного места
- **Node.js**: версия 18.0.0 или выше
- **npm**: версия 8.0.0 или выше

### Дополнительные требования:
- **Google Chrome/Chromium** (для парсинга)
- **PostgreSQL** (если используется локальная БД)
- **PM2** (для управления процессами)

## 🛠 Установка зависимостей

### 1. Обновление системы
```bash
# Ubuntu/Debian
sudo apt update && sudo apt upgrade -y

# CentOS/RHEL
sudo yum update -y
```

### 2. Установка Node.js 18+
```bash
# Используя NodeSource репозиторий
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Или используя nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc
nvm install 18
nvm use 18
```

### 3. Установка Google Chrome
```bash
# Ubuntu/Debian
wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | sudo apt-key add -
echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" | sudo tee /etc/apt/sources.list.d/google-chrome.list
sudo apt update
sudo apt install -y google-chrome-stable

# CentOS/RHEL
sudo yum install -y google-chrome-stable
```

### 4. Установка PM2
```bash
sudo npm install -g pm2
```

## 📦 Развертывание приложения

### 1. Клонирование репозитория
```bash
git clone https://github.com/wolmar/wolmar-parser.git
cd wolmar-parser
```

### 2. Настройка переменных окружения
```bash
# Копируем пример конфигурации
cp env.example .env

# Редактируем конфигурацию
nano .env
```

### 3. Установка зависимостей
```bash
npm install --production
```

### 4. Создание необходимых директорий
```bash
mkdir -p logs catalog-images catalog-public backup
```

### 5. Настройка прав доступа
```bash
chmod +x *.sh
chown -R $USER:$USER .
```

## 🚀 Запуск приложения

### Автоматический запуск (рекомендуется)
```bash
./deploy.sh
```

### Ручной запуск
```bash
# Запуск всех сервисов
./start-production.sh

# Или запуск отдельных сервисов
pm2 start ecosystem.config.js
```

### Проверка статуса
```bash
pm2 status
pm2 logs
```

## 🔧 Управление приложением

### Основные команды PM2:
```bash
# Статус всех процессов
pm2 status

# Просмотр логов
pm2 logs

# Перезапуск всех процессов
pm2 restart all

# Остановка всех процессов
pm2 stop all

# Удаление всех процессов
pm2 delete all

# Мониторинг в реальном времени
pm2 monit
```

### Скрипты управления:
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

## 🌐 Настройка веб-сервера (Nginx)

### 1. Установка Nginx
```bash
sudo apt install nginx -y
```

### 2. Создание конфигурации
```bash
sudo nano /etc/nginx/sites-available/wolmar-parser
```

### 3. Конфигурация Nginx
```nginx
server {
    listen 80;
    server_name your-domain.com;

    # Основной сервер (API)
    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # Каталог
    location /catalog {
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

    # Статические файлы
    location /images/ {
        alias /path/to/wolmar-parser/catalog-images/;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

### 4. Активация конфигурации
```bash
sudo ln -s /etc/nginx/sites-available/wolmar-parser /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

## 🔒 Настройка SSL (Let's Encrypt)

### 1. Установка Certbot
```bash
sudo apt install certbot python3-certbot-nginx -y
```

### 2. Получение SSL сертификата
```bash
sudo certbot --nginx -d your-domain.com
```

### 3. Автоматическое обновление
```bash
sudo crontab -e
# Добавить строку:
0 12 * * * /usr/bin/certbot renew --quiet
```

## 📊 Мониторинг и логи

### Просмотр логов
```bash
# Все логи
pm2 logs

# Логи конкретного приложения
pm2 logs wolmar-main
pm2 logs wolmar-catalog

# Логи в реальном времени
pm2 logs --follow
```

### Мониторинг ресурсов
```bash
# Мониторинг в реальном времени
pm2 monit

# Статистика
pm2 show wolmar-main
pm2 show wolmar-catalog
```

### Настройка ротации логов
```bash
# Установка logrotate
sudo apt install logrotate -y

# Создание конфигурации
sudo nano /etc/logrotate.d/wolmar-parser
```

## 🔄 Обновление приложения

### 1. Остановка приложения
```bash
./stop-production.sh
```

### 2. Обновление кода
```bash
git pull origin main
npm install --production
```

### 3. Запуск приложения
```bash
./start-production.sh
```

## 🛠 Устранение неполадок

### Проверка портов
```bash
netstat -tlnp | grep :300
```

### Проверка процессов
```bash
ps aux | grep node
```

### Проверка логов
```bash
tail -f logs/main-error.log
tail -f logs/catalog-error.log
```

### Перезапуск при проблемах
```bash
pm2 restart all
pm2 flush  # Очистка логов
```

## 📞 Поддержка

При возникновении проблем:
1. Проверьте логи: `pm2 logs`
2. Проверьте статус: `pm2 status`
3. Перезапустите: `pm2 restart all`
4. Обратитесь к документации или создайте issue в репозитории

## 🔧 Дополнительные настройки

### Настройка автозапуска
```bash
pm2 startup
pm2 save
```

### Настройка cron для автоматических задач
```bash
crontab -e
# Добавить задачи по необходимости
```

### Настройка бэкапов
```bash
# Создание скрипта бэкапа
nano backup.sh
chmod +x backup.sh
```

---

**Версия документации**: 2.0.0  
**Дата обновления**: $(date)  
**Автор**: Wolmar Team
# 🌐 Руководство по развертыванию каталога монет

## 📋 **Обзор**

Веб-интерфейс каталога монет находится в ветке `web-interface` и предоставляет:
- **Просмотр аукционов** с статистикой
- **Детальный просмотр лотов** с изображениями
- **Фильтрация и поиск** по различным критериям
- **RESTful API** для интеграции

## 🚀 **Быстрое развертывание**

### **Вариант 1: Автоматическое развертывание**
```bash
# На сервере
cd /var/www/wolmar-parser
git pull origin catalog-parser
./setup-catalog-on-server.sh
```

### **Вариант 2: Ручное развертывание**
```bash
# 1. Переключиться на ветку web-interface
git checkout web-interface

# 2. Создать директорию для каталога
mkdir -p /var/www/catalog-interface
cd /var/www/catalog-interface

# 3. Скопировать файлы
cp -r /var/www/wolmar-parser/public/ ./
cp /var/www/wolmar-parser/server.js ./
cp /var/www/wolmar-parser/package.json ./
cp /var/www/wolmar-parser/config.example.js ./

# 4. Установить зависимости
npm install

# 5. Настроить конфигурацию
cp config.example.js config.js
# Отредактировать config.js с настройками БД

# 6. Запустить через PM2
pm2 start server.js --name "catalog-interface"
```

## 🔧 **Настройка**

### **1. Конфигурация базы данных**
Отредактируйте `/var/www/catalog-interface/config.js`:
```javascript
module.exports = {
    dbConfig: {
        user: 'postgres.xkwgspqwebfeteoblayu',
        host: 'sup.begemot26.ru',
        database: 'postgres',
        password: 'Gopapopa326+',
        port: 6543,
        ssl: {
            rejectUnauthorized: false
        }
    }
};
```

### **2. Настройка порта**
По умолчанию каталог работает на порту 3000. Для изменения порта:
```bash
# В server.js измените
const PORT = process.env.PORT || 3000;
```

### **3. Настройка PM2**
```bash
# Запуск
pm2 start server.js --name "catalog-interface"

# Автозапуск
pm2 save
pm2 startup

# Мониторинг
pm2 status
pm2 logs catalog-interface
```

## 🌐 **Доступ к каталогу**

### **URL адреса:**
- **Главная страница**: http://46.173.19.68:3000
- **API аукционов**: http://46.173.19.68:3000/api/auctions
- **API лотов**: http://46.173.19.68:3000/api/auctions/:auctionNumber/lots

### **API Endpoints:**

#### **Аукционы:**
- `GET /api/auctions` - Список всех аукционов
- `GET /api/auctions/:auctionNumber/lots` - Лоты аукциона
- `GET /api/auctions/:auctionNumber/stats` - Статистика аукциона

#### **Лоты:**
- `GET /api/lots/:id` - Детальная информация о лоте
- `GET /api/top-lots` - Топ лотов по цене

#### **Фильтры:**
- `GET /api/filters` - Доступные значения для фильтров

## 🔗 **Интеграция с основным сервером**

### **1. Добавить ссылку в основной сервер**
В `/var/www/wolmar-parser/public/admin.html` добавить:
```html
<a href="http://46.173.19.68:3000" class="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600">
    📚 Каталог монет
</a>
```

### **2. Создать единую точку входа**
Можно настроить nginx для проксирования:
```nginx
# /etc/nginx/sites-available/wolmar
server {
    listen 80;
    server_name 46.173.19.68;
    
    # Основной сервер
    location / {
        proxy_pass http://localhost:3001;
    }
    
    # Каталог монет
    location /catalog {
        proxy_pass http://localhost:3000;
    }
}
```

## 📊 **Мониторинг**

### **Проверка статуса:**
```bash
# Статус PM2
pm2 status

# Логи каталога
pm2 logs catalog-interface

# Проверка доступности
curl http://localhost:3000/api/auctions
```

### **Перезапуск:**
```bash
# Перезапуск каталога
pm2 restart catalog-interface

# Перезапуск всех сервисов
pm2 restart all
```

## 🛠 **Устранение проблем**

### **Если каталог не запускается:**
```bash
# Проверить логи
pm2 logs catalog-interface

# Проверить конфигурацию
cat /var/www/catalog-interface/config.js

# Проверить зависимости
cd /var/www/catalog-interface
npm list
```

### **Если API не отвечает:**
```bash
# Проверить подключение к БД
node -e "const config = require('./config'); console.log(config.dbConfig);"

# Проверить порт
netstat -tlnp | grep 3000
```

### **Если файлы не найдены:**
```bash
# Проверить права доступа
ls -la /var/www/catalog-interface/

# Восстановить файлы
cd /var/www/wolmar-parser
git checkout web-interface
cp -r public/ /var/www/catalog-interface/
```

## 🎯 **Результат**

После развертывания у вас будет:
- **Основной сервер**: http://46.173.19.68:3001 (парсеры, админка, мониторинг)
- **Каталог монет**: http://46.173.19.68:3000 (просмотр лотов, поиск, фильтры)
- **Единая система** для работы с данными аукционов

**Теперь пользователи смогут просматривать каталог монет через удобный веб-интерфейс!** 🎉

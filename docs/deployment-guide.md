# Руководство по развертыванию

## Настройка на локальной машине

### 1. Создание GitHub репозитория

1. Создайте новый репозиторий на GitHub: `meshok-parser`
2. Скопируйте URL репозитория

### 2. Клонирование и настройка

```bash
# Клонирование репозитория
git clone https://github.com/your-username/meshok-parser.git
cd meshok-parser

# Установка зависимостей
npm install

# Тестирование
npm run test
```

## Настройка на сервере

### 1. Клонирование с GitHub

```bash
cd ~
git clone https://github.com/your-username/meshok-parser.git
cd meshok-parser
npm install
```

### 2. Тестирование доступа

```bash
# Проверка доступности сайта
node scripts/test-fetch.js

# Получение списка завершенных лотов
npm run fetch:listing

# Получение конкретного лота
node scripts/fetch-item.js 343735645
```

## Синхронизация изменений

### С локальной машины на сервер

```bash
# На локальной машине
git add .
git commit -m "Описание изменений"
git push origin main

# На сервере
git pull origin main
```

### С сервера на локальную машину

```bash
# На сервере
git add .
git commit -m "Результаты тестирования"
git push origin main

# На локальной машине
git pull origin main
```

## Структура проекта

```
meshok-parser/
├── .gitignore
├── README.md
├── package.json
├── config/
│   └── categories.json
├── scripts/
│   ├── fetch-listing.js
│   ├── fetch-item.js
│   ├── analyze-structure.js
│   └── test-fetch.js
├── data/
│   └── .gitkeep
└── docs/
    ├── research-notes.md
    └── deployment-guide.md
```

## Команды для работы

```bash
# Тестирование
npm run test

# Получение списка лотов
npm run fetch:listing

# Получение конкретного лота
node scripts/fetch-item.js <ITEM_ID>

# Анализ структуры
node scripts/analyze-structure.js <FILENAME>
```

## Troubleshooting

### Проблема: Cloudflare challenge
**Решение:** Увеличьте время ожидания в скриптах или используйте не-headless режим для отладки

### Проблема: Puppeteer не запускается
**Решение:** Установите зависимости:
```bash
sudo apt-get update
sudo apt-get install -y gconf-service libasound2 libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgcc1 libgconf-2-4 libgdk-pixbuf2.0-0 libglib2.0-0 libgtk-3-0 libnspr4 libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 ca-certificates fonts-liberation libappindicator1 libnss3 lsb-release xdg-utils wget
```

### Проблема: Нет данных на странице
**Решение:** Проверьте URL и параметры, возможно изменилась структура сайта

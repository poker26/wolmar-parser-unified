// Пример конфигурации для Wolmar Auction Parser
// Скопируйте этот файл в config.js и настройте под ваши нужды

module.exports = {
    // Конфигурация базы данных PostgreSQL
    dbConfig: {
        user: 'your_username',                    // Имя пользователя БД
        host: 'your_host',                        // Хост базы данных
        database: 'your_database',                // Имя базы данных
        password: 'your_password',                // Пароль
        port: 5432,                              // Порт (обычно 5432)
        ssl: {
            rejectUnauthorized: false             // Для Supabase и других облачных БД
        },
        // Настройки для улучшения стабильности соединения
        connectionTimeoutMillis: 10000,           // Таймаут подключения (мс)
        idleTimeoutMillis: 30000,                 // Таймаут простоя (мс)
        max: 10,                                  // Максимальное количество соединений в пуле
        allowExitOnIdle: true
    },
    
    // Настройки браузера Puppeteer
    browserConfig: {
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', // Путь к Chrome
        headless: true,                           // Запуск в фоновом режиме
        args: [
            '--no-sandbox',                       // Отключить sandbox
            '--disable-setuid-sandbox',           // Отключить setuid sandbox
            '--disable-dev-shm-usage',            // Отключить /dev/shm
            '--disable-gpu',                      // Отключить GPU
            '--disable-images',                   // Отключить загрузку изображений (для скорости)
            '--disable-javascript'                // Отключить JavaScript (опционально)
        ]
    },
    
    // Настройки парсинга
    parserConfig: {
        delayBetweenLots: 800,                    // Задержка между лотами (мс)
        batchSize: 50,                            // Размер пакета для статистики
        maxLots: null,                            // Максимальное количество лотов (null = все)
        skipExisting: true,                       // Пропускать существующие лоты
        testMode: false,                          // Тестовый режим
        maxRetries: 3,                            // Максимальное количество попыток переподключения
        retryDelay: 5000                          // Задержка между попытками переподключения (мс)
    }
};

// Примеры конфигураций для разных провайдеров БД:

// Supabase
/*
dbConfig: {
    user: 'postgres.xxxxxxxxxxxxxxxx',
    host: 'aws-0-eu-north-1.pooler.supabase.com',
    database: 'postgres',
    password: 'your_supabase_password',
    port: 6543,
    ssl: { rejectUnauthorized: false }
}
*/

// Локальная PostgreSQL
/*
dbConfig: {
    user: 'postgres',
    host: 'localhost',
    database: 'wolmar_auctions',
    password: 'your_password',
    port: 5432,
    ssl: false
}
*/

// Heroku Postgres
/*
dbConfig: {
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
}
*/
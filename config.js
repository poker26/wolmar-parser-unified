try { require('dotenv').config(); } catch (_) {}

// Конфигурация для Wolmar Auction Parser (self-hosted Supabase)
module.exports = {
    dbConfig: {
        user: process.env.DB_USER || 'postgres',
        host: process.env.DB_HOST || 'sup.begemot26.ru',
        database: process.env.DB_NAME || 'postgres',
        password: process.env.DB_PASSWORD || process.env.POSTGRES_PASSWORD,
        port: parseInt(process.env.DB_PORT, 10) || 6543,
        ssl: {
            rejectUnauthorized: false
        },
        // Настройки для улучшения стабильности соединения
        connectionTimeoutMillis: 10000,
        idleTimeoutMillis: 30000,
        max: 10, // Максимальное количество соединений в пуле
        allowExitOnIdle: true
    },
    
    // Настройки браузера
    browserConfig: {
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-images',
            '--disable-javascript'
        ]
    },
    
    // Настройки парсинга
    parserConfig: {
        delayBetweenLots: 800,    // Задержка между лотами (мс)
        batchSize: 50,            // Размер пакета для статистики
        maxLots: null,            // Максимальное количество лотов (null = все)
        skipExisting: true,       // Пропускать существующие лоты
        testMode: false,          // Тестовый режим
        maxRetries: 3,            // Максимальное количество попыток переподключения
        retryDelay: 5000          // Задержка между попытками переподключения (мс)
    }
};

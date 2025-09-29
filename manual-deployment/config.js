// Конфигурация для Wolmar Auction Parser
module.exports = {
    dbConfig: {
        user: 'postgres.xkwgspqwebfeteoblayu',        
        host: 'aws-0-eu-north-1.pooler.supabase.com',
        database: 'postgres',   
        password: 'Gopapopa326+',    
        port: 6543,
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

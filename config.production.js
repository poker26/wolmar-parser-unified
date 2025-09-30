// Production конфигурация для Wolmar Auction Parser
module.exports = {
    dbConfig: {
        user: process.env.DB_USER || 'postgres.xkwgspqwebfeteoblayu',        
        host: process.env.DB_HOST || 'aws-0-eu-north-1.pooler.supabase.com',
        database: process.env.DB_NAME || 'postgres',   
        password: process.env.DB_PASSWORD || 'Gopapopa326+',    
        port: parseInt(process.env.DB_PORT) || 6543,
        ssl: {
            rejectUnauthorized: false
        },
        // Настройки для улучшения стабильности соединения
        connectionTimeoutMillis: 30000,
        idleTimeoutMillis: 60000,
        max: 20, // Максимальное количество соединений в пуле
        allowExitOnIdle: true,
        // Дополнительные настройки для production
        keepAlive: true,
        keepAliveInitialDelayMillis: 10000
    },
    
    // Настройки браузера для production
    browserConfig: {
        executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-images',
            '--disable-javascript',
            '--disable-extensions',
            '--disable-plugins',
            '--disable-web-security',
            '--disable-features=VizDisplayCompositor',
            '--memory-pressure-off',
            '--max_old_space_size=4096'
        ]
    },
    
    // Настройки парсинга для production
    parserConfig: {
        delayBetweenLots: 1000,    // Увеличена задержка для стабильности
        batchSize: 100,            // Увеличен размер пакета
        maxLots: null,            // Максимальное количество лотов (null = все)
        skipExisting: true,       // Пропускать существующие лоты
        testMode: false,          // Тестовый режим
        maxRetries: 5,            // Увеличено количество попыток
        retryDelay: 10000,        // Увеличена задержка между попытками
        timeout: 30000           // Таймаут для запросов
    },
    
    // Настройки сервера
    serverConfig: {
        port: parseInt(process.env.PORT) || 3001,
        host: process.env.HOST || '0.0.0.0',
        cors: {
            origin: process.env.CORS_ORIGIN || '*',
            credentials: true
        }
    },
    
    // Настройки логирования
    logging: {
        level: process.env.LOG_LEVEL || 'info',
        file: process.env.LOG_FILE || './logs/app.log',
        maxSize: '10m',
        maxFiles: 5
    },
    
    // Настройки безопасности
    security: {
        jwtSecret: process.env.JWT_SECRET || 'your-secret-key-change-in-production',
        bcryptRounds: 12,
        rateLimit: {
            windowMs: 15 * 60 * 1000, // 15 минут
            max: 100 // максимум 100 запросов на IP
        }
    },
    
    // Настройки мониторинга
    monitoring: {
        healthCheckInterval: 30000, // 30 секунд
        memoryThreshold: 1024, // MB
        cpuThreshold: 80 // %
    }
};
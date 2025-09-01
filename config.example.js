// Пример конфигурации базы данных
// Скопируйте этот файл в config.js и заполните своими данными

module.exports = {
    dbConfig: {
        user: 'your_username',
        host: 'your_host',
        database: 'your_database',
        password: 'your_password',
        port: 5432,
        ssl: {
            rejectUnauthorized: false
        }
    },
    
    // Настройки браузера
    browserConfig: {
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', // Путь к Chrome
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
        testMode: false           // Тестовый режим
    }
};

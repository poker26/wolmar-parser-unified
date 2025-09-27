// Production configuration for Wolmar Parser
module.exports = {
    // Database configuration (Supabase)
    database: {
        host: process.env.DB_HOST || 'aws-0-eu-north-1.pooler.supabase.com',
        port: process.env.DB_PORT || 6543,
        database: process.env.DB_NAME || 'postgres',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || 'your_password_here',
        ssl: {
            rejectUnauthorized: false
        },
        max: 20, // Maximum number of clients in the pool
        idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
        connectionTimeoutMillis: 2000, // Return an error after 2 seconds if connection could not be established
    },
    
    // Server configuration
    server: {
        port: process.env.PORT || 3000,
        host: process.env.HOST || '0.0.0.0',
        environment: 'production'
    },
    
    // CORS configuration
    cors: {
        origin: process.env.CORS_ORIGIN || '*',
        credentials: true
    },
    
    // Metals API configuration
    metalsApi: {
        baseUrl: 'https://api.metals.live/v1/spot',
        timeout: 10000
    },
    
    // Parsing configuration
    parsing: {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        timeout: 30000,
        retries: 3,
        delay: 1000
    },
    
    // Logging configuration
    logging: {
        level: 'info',
        file: './logs/app.log',
        maxSize: '10m',
        maxFiles: 5
    },
    
    // Security configuration
    security: {
        rateLimit: {
            windowMs: 15 * 60 * 1000, // 15 minutes
            max: 100 // Limit each IP to 100 requests per windowMs
        }
    }
};




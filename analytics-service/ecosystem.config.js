module.exports = {
  apps: [{
    name: 'analytics',
    script: 'analytics-service.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'development',
      ANALYTICS_PORT: 3002
    },
    env_production: {
      NODE_ENV: 'production',
      ANALYTICS_PORT: 3002
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
  }]
};

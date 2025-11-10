const path = require('path');

module.exports = {
  apps: [{
    name: 'analytics',
    script: 'analytics-service.js',
    cwd: path.resolve(__dirname),
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
    error_file: path.resolve(__dirname, 'logs/err.log'),
    out_file: path.resolve(__dirname, 'logs/out.log'),
    log_file: path.resolve(__dirname, 'logs/combined.log'),
    time: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true
  }]
};

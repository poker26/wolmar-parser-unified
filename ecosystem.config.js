module.exports = {
  apps: [
    {
      name: 'wolmar-server',
      script: 'server.js',
      instances: 1,
      autorestart: true,
      watch: false,
      watch_options: {
        usePolling: false,
        interval: 1000
      },
      ignore_watch: [
        'logs/**/*',
        'node_modules/**/*',
        '*.log',
        '*.json'
      ],
      max_memory_restart: '2G',
      env: {
        NODE_ENV: 'production',
        PORT: 3001
      },
      env_development: {
        NODE_ENV: 'development',
        PORT: 3001
      },
      // Логирование
      log_file: './logs/main-combined.log',
      out_file: './logs/main-out.log',
      error_file: './logs/main-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      
      // Автоматический перезапуск при ошибках
      min_uptime: '10s',
      max_restarts: 10,
      
      // Health check
      health_check_grace_period: 3000,
      
      // Дополнительные настройки
      kill_timeout: 5000,
      listen_timeout: 3000,
      
      // Настройки для production
      node_args: '--max-old-space-size=2048',
      
      // Перезапуск по расписанию (каждый день в 3:00)
      cron_restart: '0 3 * * *',
      
      // Настройки для логирования
      merge_logs: true,
      log_type: 'json',
      
      // Настройки для graceful shutdown
      kill_timeout: 5000,
      listen_timeout: 3000,
      
      // Дополнительные переменные
      source_map_support: true
    }
  ]
};
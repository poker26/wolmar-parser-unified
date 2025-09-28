module.exports = {
  apps: [{
    name: 'wolmar-parser',
    script: 'server.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 3001
    },
    env_development: {
      NODE_ENV: 'development',
      PORT: 3001
    },
    // Логирование
    log_file: './logs/combined.log',
    out_file: './logs/out.log',
    error_file: './logs/error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    
    // Мониторинг
    monitoring: true,
    
    // Автоматический перезапуск при ошибках
    min_uptime: '10s',
    max_restarts: 10,
    
    // Health check
    health_check_grace_period: 3000,
    
    // Дополнительные настройки
    kill_timeout: 5000,
    listen_timeout: 3000,
    
    // Переменные окружения для мониторинга
    pmx: true,
    
    // Настройки для кластеризации (если понадобится)
    exec_mode: 'fork',
    
    // Автоматический перезапуск при изменении файлов (только в dev)
    watch: process.env.NODE_ENV === 'development' ? ['server.js', 'admin-server.js'] : false,
    ignore_watch: ['node_modules', 'logs', '*.log'],
    
    // Настройки для production
    node_args: '--max-old-space-size=1024',
    
    // Перезапуск по расписанию (каждый день в 3:00)
    cron_restart: '0 3 * * *',
    
    // Настройки для мониторинга ресурсов
    max_memory_restart: '1G',
    
    // Настройки для логирования
    merge_logs: true,
    log_type: 'json',
    
    // Настройки для уведомлений
    notify: true,
    
    // Настройки для health check
    health_check_url: 'http://localhost:3001/api/health',
    health_check_interval: 30000,
    
    // Настройки для graceful shutdown
    kill_timeout: 5000,
    listen_timeout: 3000,
    
    // Дополнительные переменные
    source_map_support: true,
    
    // Настройки для мониторинга
    pmx: {
      http: true,
      https: false,
      ignore_routes: ['/api/health', '/api/status']
    }
  }]
};
# 🔗 Руководство по интеграции анализа поведения в проект Wolmar

## 📋 Обзор интеграции

Это руководство описывает, как интегрировать систему анализа поведения на аукционе в основной проект Wolmar Parser.

## 🎯 Цели интеграции

1. **Автоматический мониторинг** - непрерывный анализ поведения пользователей
2. **Детекция нарушений** - выявление манипуляций в реальном времени
3. **Аналитические отчеты** - регулярные отчеты для администрации
4. **Система предупреждений** - автоматические алерты о подозрительной активности

## 🏗️ Архитектура интеграции

### Текущая архитектура Wolmar Parser:
```
wolmar-parser/
├── server.js                 # Основной сервер (порт 3001)
├── catalog-server.js         # Сервер каталога (порт 3000)
├── admin-server.js           # Административный интерфейс
├── catalog-parser.js         # Парсер аукционов
└── collection-service.js     # Сервис коллекций
```

### Новая архитектура с анализом поведения:
```
wolmar-parser/
├── server.js                 # Основной сервер (порт 3001)
├── catalog-server.js         # Сервер каталога (порт 3000)
├── admin-server.js           # Административный интерфейс
├── catalog-parser.js         # Парсер аукционов
├── collection-service.js     # Сервис коллекций
├── auction-behavior-analyzer.js      # Анализатор поведения
├── detailed-behavior-investigator.js # Детальный исследователь
├── anti-manipulation-strategies.js   # Стратегии противодействия
├── behavior-monitoring-service.js    # Сервис мониторинга (новый)
└── behavior-api.js                   # API для анализа (новый)
```

## 🔧 Этапы интеграции

### Этап 1: Подготовка инфраструктуры

#### 1.1 Установка зависимостей
```bash
# В корне проекта wolmar-parser
npm install pg
```

#### 1.2 Создание новых сервисов
```bash
# Создаем новые файлы
touch behavior-monitoring-service.js
touch behavior-api.js
touch behavior-scheduler.js
```

#### 1.3 Настройка базы данных
```sql
-- Добавляем индексы для оптимизации аналитических запросов
CREATE INDEX IF NOT EXISTS idx_auction_lots_winner_nick ON auction_lots(winner_nick);
CREATE INDEX IF NOT EXISTS idx_auction_lots_seller_nick ON auction_lots(seller_nick);
CREATE INDEX IF NOT EXISTS idx_auction_lots_final_price ON auction_lots(final_price);
CREATE INDEX IF NOT EXISTS idx_auction_lots_created_at ON auction_lots(created_at);
CREATE INDEX IF NOT EXISTS idx_auction_lots_price_multiplier ON auction_lots((final_price::numeric / starting_price::numeric));
```

### Этап 2: Создание сервиса мониторинга

#### 2.1 `behavior-monitoring-service.js`
```javascript
const AuctionBehaviorAnalyzer = require('./auction-behavior-analyzer');
const EventEmitter = require('events');

class BehaviorMonitoringService extends EventEmitter {
    constructor(dbConfig) {
        super();
        this.dbConfig = dbConfig;
        this.analyzer = new AuctionBehaviorAnalyzer(dbConfig);
        this.isRunning = false;
        this.intervalId = null;
    }

    async start(intervalMinutes = 60) {
        if (this.isRunning) return;
        
        this.isRunning = true;
        console.log(`🔍 Запуск мониторинга поведения (интервал: ${intervalMinutes} мин)`);
        
        // Немедленный анализ
        await this.runAnalysis();
        
        // Периодический анализ
        this.intervalId = setInterval(async () => {
            await this.runAnalysis();
        }, intervalMinutes * 60 * 1000);
    }

    async stop() {
        if (!this.isRunning) return;
        
        this.isRunning = false;
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        console.log('🛑 Мониторинг поведения остановлен');
    }

    async runAnalysis() {
        try {
            console.log('🔍 Запуск анализа поведения...');
            const results = await this.analyzer.generateComprehensiveReport();
            
            // Проверяем на критические нарушения
            this.checkForCriticalViolations(results);
            
            // Эмитируем событие с результатами
            this.emit('analysisComplete', results);
            
        } catch (error) {
            console.error('❌ Ошибка анализа поведения:', error.message);
            this.emit('analysisError', error);
        }
    }

    checkForCriticalViolations(results) {
        const criticalThresholds = {
            suspiciousSellers: 10,
            priceManipulators: 5,
            multipleAccounts: 3
        };

        if (results.summary.totalSuspiciousSellers > criticalThresholds.suspiciousSellers) {
            this.emit('criticalAlert', {
                type: 'SUSPICIOUS_SELLERS',
                count: results.summary.totalSuspiciousSellers,
                threshold: criticalThresholds.suspiciousSellers
            });
        }

        if (results.summary.totalPriceManipulators > criticalThresholds.priceManipulators) {
            this.emit('criticalAlert', {
                type: 'PRICE_MANIPULATION',
                count: results.summary.totalPriceManipulators,
                threshold: criticalThresholds.priceManipulators
            });
        }
    }
}

module.exports = BehaviorMonitoringService;
```

### Этап 3: Создание API для анализа

#### 3.1 `behavior-api.js`
```javascript
const express = require('express');
const AuctionBehaviorAnalyzer = require('./auction-behavior-analyzer');
const DetailedBehaviorInvestigator = require('./detailed-behavior-investigator');

class BehaviorAPI {
    constructor(dbConfig) {
        this.router = express.Router();
        this.dbConfig = dbConfig;
        this.setupRoutes();
    }

    setupRoutes() {
        // Получение общего статуса
        this.router.get('/status', async (req, res) => {
            try {
                const analyzer = new AuctionBehaviorAnalyzer(this.dbConfig);
                await analyzer.init();
                const results = await analyzer.generateComprehensiveReport();
                await analyzer.close();
                
                res.json({
                    status: 'success',
                    data: results.summary,
                    timestamp: new Date().toISOString()
                });
            } catch (error) {
                res.status(500).json({
                    status: 'error',
                    message: error.message
                });
            }
        });

        // Анализ конкретного пользователя
        this.router.get('/user/:nickname', async (req, res) => {
            try {
                const { nickname } = req.params;
                const { type = 'seller' } = req.query;
                
                const investigator = new DetailedBehaviorInvestigator(this.dbConfig);
                await investigator.init();
                const report = await investigator.generateDetailedReport(nickname, type);
                await investigator.close();
                
                res.json({
                    status: 'success',
                    data: report
                });
            } catch (error) {
                res.status(500).json({
                    status: 'error',
                    message: error.message
                });
            }
        });

        // Получение подозрительных пользователей
        this.router.get('/suspicious', async (req, res) => {
            try {
                const analyzer = new AuctionBehaviorAnalyzer(this.dbConfig);
                await analyzer.init();
                const results = await analyzer.generateComprehensiveReport();
                await analyzer.close();
                
                res.json({
                    status: 'success',
                    data: {
                        suspiciousSellers: results.suspiciousSellers,
                        priceManipulators: results.priceManipulation,
                        multipleAccounts: results.multipleAccounts
                    }
                });
            } catch (error) {
                res.status(500).json({
                    status: 'error',
                    message: error.message
                });
            }
        });

        // Запуск полного анализа
        this.router.post('/analyze', async (req, res) => {
            try {
                const analyzer = new AuctionBehaviorAnalyzer(this.dbConfig);
                await analyzer.init();
                const results = await analyzer.generateComprehensiveReport();
                await analyzer.close();
                
                res.json({
                    status: 'success',
                    message: 'Анализ завершен',
                    data: results
                });
            } catch (error) {
                res.status(500).json({
                    status: 'error',
                    message: error.message
                });
            }
        });
    }

    getRouter() {
        return this.router;
    }
}

module.exports = BehaviorAPI;
```

### Этап 4: Интеграция в основной сервер

#### 4.1 Модификация `server.js`
```javascript
// Добавляем импорты
const BehaviorMonitoringService = require('./behavior-monitoring-service');
const BehaviorAPI = require('./behavior-api');

// В секции инициализации сервера
const behaviorMonitoring = new BehaviorMonitoringService(dbConfig);
const behaviorAPI = new BehaviorAPI(dbConfig);

// Подключаем API маршруты
app.use('/api/behavior', behaviorAPI.getRouter());

// Настраиваем мониторинг
behaviorMonitoring.on('criticalAlert', (alert) => {
    console.log(`🚨 КРИТИЧЕСКОЕ ПРЕДУПРЕЖДЕНИЕ: ${alert.type} - ${alert.count} случаев`);
    // Здесь можно добавить отправку уведомлений
});

behaviorMonitoring.on('analysisComplete', (results) => {
    console.log(`✅ Анализ поведения завершен: ${results.summary.totalSuspiciousSellers} подозрительных продавцов`);
});

// Запускаем мониторинг при старте сервера
app.listen(PORT, async () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
    
    // Запускаем мониторинг поведения
    await behaviorMonitoring.start(60); // Анализ каждый час
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('🛑 Получен сигнал SIGTERM, завершаем работу...');
    await behaviorMonitoring.stop();
    process.exit(0);
});
```

### Этап 5: Интеграция в админ-панель

#### 5.1 Модификация `public/admin.html`
```html
<!-- Добавляем новую секцию в админ-панель -->
<div class="admin-section">
    <h3>🔍 Анализ поведения</h3>
    <div class="behavior-controls">
        <button id="runBehaviorAnalysis" class="btn btn-primary">
            Запустить анализ поведения
        </button>
        <button id="viewSuspiciousUsers" class="btn btn-warning">
            Подозрительные пользователи
        </button>
        <button id="viewBehaviorReports" class="btn btn-info">
            Отчеты по поведению
        </button>
    </div>
    
    <div id="behaviorResults" class="results-container" style="display: none;">
        <!-- Результаты анализа будут отображаться здесь -->
    </div>
</div>
```

#### 5.2 Модификация `public/admin.js`
```javascript
// Добавляем функции для работы с анализом поведения
document.getElementById('runBehaviorAnalysis').addEventListener('click', async () => {
    try {
        const response = await fetch('/api/behavior/analyze', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        const result = await response.json();
        
        if (result.status === 'success') {
            displayBehaviorResults(result.data);
        } else {
            showError('Ошибка анализа: ' + result.message);
        }
    } catch (error) {
        showError('Ошибка запроса: ' + error.message);
    }
});

document.getElementById('viewSuspiciousUsers').addEventListener('click', async () => {
    try {
        const response = await fetch('/api/behavior/suspicious');
        const result = await response.json();
        
        if (result.status === 'success') {
            displaySuspiciousUsers(result.data);
        } else {
            showError('Ошибка загрузки: ' + result.message);
        }
    } catch (error) {
        showError('Ошибка запроса: ' + error.message);
    }
});

function displayBehaviorResults(data) {
    const container = document.getElementById('behaviorResults');
    container.innerHTML = `
        <h4>Результаты анализа поведения</h4>
        <div class="metrics-grid">
            <div class="metric-card">
                <h5>Подозрительные продавцы</h5>
                <span class="metric-value">${data.summary.totalSuspiciousSellers}</span>
            </div>
            <div class="metric-card">
                <h5>Манипуляторы цен</h5>
                <span class="metric-value">${data.summary.totalPriceManipulators}</span>
            </div>
            <div class="metric-card">
                <h5>Множественные аккаунты</h5>
                <span class="metric-value">${data.summary.totalMultipleAccounts}</span>
            </div>
        </div>
    `;
    container.style.display = 'block';
}
```

## 📊 Мониторинг и алерты

### Настройка алертов
```javascript
// В behavior-monitoring-service.js
behaviorMonitoring.on('criticalAlert', (alert) => {
    // Отправка email уведомления
    sendEmailAlert(alert);
    
    // Отправка в Slack/Discord
    sendSlackAlert(alert);
    
    // Логирование в систему мониторинга
    logCriticalAlert(alert);
});
```

### Дашборд мониторинга
```javascript
// Создаем endpoint для дашборда
app.get('/admin/behavior-dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'behavior-dashboard.html'));
});
```

## 🚀 Развертывание

### 1. Обновление на сервере
```bash
# На сервере
cd /var/www
git pull origin main
npm install
pm2 restart wolmar-parser
```

### 2. Проверка работы
```bash
# Проверяем логи
pm2 logs wolmar-parser

# Проверяем API
curl http://localhost:3001/api/behavior/status
```

### 3. Настройка мониторинга
```bash
# Добавляем в crontab для регулярных отчетов
0 9 * * * curl -X POST http://localhost:3001/api/behavior/analyze
```

## 📈 Метрики и KPI

### Ключевые метрики для отслеживания:
- Количество подозрительных продавцов
- Процент лотов с манипуляциями цен
- Количество выявленных множественных аккаунтов
- Время отклика системы анализа
- Точность детекции нарушений

### Дашборд метрик:
```javascript
// Endpoint для метрик
app.get('/api/behavior/metrics', async (req, res) => {
    const metrics = await getBehaviorMetrics();
    res.json(metrics);
});
```

## 🔒 Безопасность

### Меры безопасности:
1. **Аутентификация** - доступ к API только для авторизованных пользователей
2. **Логирование** - все действия логируются
3. **Шифрование** - чувствительные данные шифруются
4. **Ограничения** - лимиты на количество запросов

### Настройка безопасности:
```javascript
// В server.js
const rateLimit = require('express-rate-limit');

const behaviorAPILimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 минут
    max: 100 // максимум 100 запросов на IP
});

app.use('/api/behavior', behaviorAPILimiter);
```

## 📝 Заключение

Интеграция системы анализа поведения в проект Wolmar Parser позволит:

1. **Автоматически выявлять** манипуляции и нарушения
2. **Предотвращать** нечестные практики
3. **Повышать доверие** пользователей к платформе
4. **Улучшать качество** торгов

Система готова к развертыванию и может быть адаптирована под конкретные потребности проекта.

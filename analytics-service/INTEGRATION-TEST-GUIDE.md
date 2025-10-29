# Руководство по тестированию новых аналитических отчетов

## Обзор интеграции

Успешно интегрированы все 7 новых аналитических гипотез в существующий аналитический сервис:

### ✅ Реализованные API endpoints:

1. **Круговые покупки** (Гипотеза 1)
   - Endpoint: `GET /api/analytics/circular-buyers`
   - Параметры: `min_purchases`, `months`
   - Описание: Анализ пользователей, покупающих одинаковые монеты многократно

2. **Связанные аккаунты** (Гипотеза 2)
   - Endpoint: `GET /api/analytics/linked-accounts`
   - Параметры: `similarity_threshold`, `min_bids`, `months`
   - Описание: Поиск аккаунтов с похожими паттернами поведения

3. **Заглохание торгов** (Гипотеза 3)
   - Endpoint: `GET /api/analytics/abandonment-analysis`
   - Параметры: `min_bids`, `max_seconds`, `months`
   - Описание: Анализ лотов с резким прекращением торгов

4. **Прощупывание автобидов** (Гипотеза 4)
   - Endpoint: `GET /api/analytics/autobid-probing`
   - Параметры: `min_bids`, `max_seconds`, `months`
   - Описание: Анализ подозрительных паттернов ставок

5. **Стратегии разгона цен** (Гипотеза 5)
   - Endpoint: `GET /api/analytics/pricing-strategies`
   - Параметры: `min_bids`, `min_price_multiplier`, `months`
   - Описание: Анализ стратегий "Группа А" и "Группа Б"

6. **Карусель перепродаж** (Гипотеза 8)
   - Endpoint: `GET /api/analytics/carousel-analysis`
   - Параметры: `min_sales`, `max_weeks`, `months`
   - Описание: Анализ монет, ходящих по кругу между участниками

7. **Тактики приманки** (Гипотеза 7)
   - Endpoint: `GET /api/analytics/decoy-tactics`
   - Параметры: `min_lots`, `max_price_diff`, `months`
   - Описание: Анализ пользователей с подозрительными паттернами покупок

### ✅ Обновленный фронтенд:

- Добавлены 7 новых вкладок в интерфейс аналитики
- Каждая вкладка имеет настраиваемые параметры
- Результаты отображаются в табличном формате с цветовой индикацией рисков
- Интегрированы с существующей системой навигации

## Инструкции по тестированию

### 1. Запуск сервиса

```bash
cd analytics-service
npm install
node analytics-service.js
```

Сервис будет доступен по адресу: `http://localhost:3002/analytics`

### 2. Тестирование API endpoints

#### Тест 1: Круговые покупки
```bash
curl "http://localhost:3002/api/analytics/circular-buyers?min_purchases=3&months=6"
```

#### Тест 2: Связанные аккаунты
```bash
curl "http://localhost:3002/api/analytics/linked-accounts?similarity_threshold=0.80&min_bids=10&months=3"
```

#### Тест 3: Заглохание торгов
```bash
curl "http://localhost:3002/api/analytics/abandonment-analysis?min_bids=5&max_seconds=30&months=3"
```

#### Тест 4: Прощупывание автобидов
```bash
curl "http://localhost:3002/api/analytics/autobid-probing?min_bids=3&max_seconds=60&months=3"
```

#### Тест 5: Стратегии разгона цен
```bash
curl "http://localhost:3002/api/analytics/pricing-strategies?min_bids=5&min_price_multiplier=2.0&months=6"
```

#### Тест 6: Карусель перепродаж
```bash
curl "http://localhost:3002/api/analytics/carousel-analysis?min_sales=3&max_weeks=4&months=6"
```

#### Тест 7: Тактики приманки
```bash
curl "http://localhost:3002/api/analytics/decoy-tactics?min_lots=3&max_price_diff=0.5&months=6"
```

### 3. Тестирование веб-интерфейса

1. Откройте `http://localhost:3002/analytics`
2. Переключитесь на каждую из новых вкладок:
   - Круговые покупки
   - Связанные аккаунты
   - Карусель перепродаж
   - Заглохание торгов
   - Прощупывание автобидов
   - Стратегии разгона
   - Тактики приманки
3. Настройте параметры для каждого анализа
4. Нажмите "Запустить анализ"
5. Проверьте отображение результатов в таблице

### 4. Проверка производительности

Для тестирования с большими объемами данных:

```bash
# Тест с расширенными параметрами
curl "http://localhost:3002/api/analytics/circular-buyers?min_purchases=2&months=12"
curl "http://localhost:3002/api/analytics/linked-accounts?similarity_threshold=0.70&min_bids=5&months=6"
```

### 5. Ожидаемые результаты

Каждый API endpoint должен возвращать JSON в формате:

```json
{
  "success": true,
  "data": [...],
  "count": 0,
  "parameters": {...},
  "message": "..."
}
```

### 6. Возможные проблемы и решения

#### Проблема: "Нет данных"
- **Причина**: Недостаточно данных в базе для анализа
- **Решение**: Уменьшите параметры (например, `min_purchases=2`, `months=1`)

#### Проблема: Медленная загрузка
- **Причина**: Сложные SQL запросы с большими объемами данных
- **Решение**: Ограничьте период анализа (`months=1`) или увеличьте пороговые значения

#### Проблема: Ошибки SQL
- **Причина**: Проблемы с синтаксисом запросов или структурой БД
- **Решение**: Проверьте логи сервера, убедитесь что таблицы `auction_lots` и `lot_bids` существуют

### 7. Мониторинг

Следите за логами сервера для отслеживания:
- Времени выполнения запросов
- Количества найденных подозрительных случаев
- Ошибок в SQL запросах

```bash
# Логи в реальном времени
tail -f analytics-service.log
```

## Следующие шаги

1. **Настройка параметров**: Отрегулируйте пороговые значения на основе реальных данных
2. **Оптимизация запросов**: Добавьте индексы для ускорения работы
3. **Расширение функционала**: Добавьте экспорт результатов, уведомления
4. **Интеграция с основным сервисом**: Подключите к основному Wolmar Parser

## Техническая информация

- **Backend**: Node.js + Express + PostgreSQL
- **Frontend**: Vanilla JavaScript + Tailwind CSS
- **База данных**: Supabase PostgreSQL
- **Порт**: 3002 (настраивается через ANALYTICS_PORT)

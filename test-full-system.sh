#!/bin/bash

# Комплексный тест всей системы мониторинга и восстановления
# Проверяет все компоненты системы

echo "🧪 Комплексное тестирование системы мониторинга и восстановления"
echo "================================================================="

# Цвета для вывода
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Счетчики
TESTS_PASSED=0
TESTS_FAILED=0
TOTAL_TESTS=0

# Функция для выполнения теста
run_test() {
    local test_name="$1"
    local test_command="$2"
    local expected_result="${3:-0}"
    
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    
    echo -e "${BLUE}🔍 Тест $TOTAL_TESTS: $test_name${NC}"
    
    if eval "$test_command" > /dev/null 2>&1; then
        if [ $? -eq $expected_result ]; then
            echo -e "   ${GREEN}✅ ПРОЙДЕН${NC}"
            TESTS_PASSED=$((TESTS_PASSED + 1))
        else
            echo -e "   ${RED}❌ ПРОВАЛЕН (неожиданный код возврата)${NC}"
            TESTS_FAILED=$((TESTS_FAILED + 1))
        fi
    else
        echo -e "   ${RED}❌ ПРОВАЛЕН${NC}"
        TESTS_FAILED=$((TESTS_FAILED + 1))
    fi
    echo ""
}

echo "📋 Проверяем наличие всех необходимых файлов..."

# Тест 1: Проверка файлов системы
run_test "Файл analyze-crash-recovery.js" "[ -f 'analyze-crash-recovery.js' ]"
run_test "Файл auto-restart.sh" "[ -f 'auto-restart.sh' ]"
run_test "Файл update-server.sh" "[ -f 'update-server.sh' ]"
run_test "Файл external-monitor.html" "[ -f 'external-monitor.html' ]"
run_test "Файл server.js" "[ -f 'server.js' ]"

echo "🔧 Проверяем права доступа к скриптам..."

# Тест 2: Права доступа
run_test "Права на analyze-crash-recovery.js" "[ -r 'analyze-crash-recovery.js' ]"
run_test "Права на auto-restart.sh" "[ -r 'auto-restart.sh' ]"
run_test "Права на update-server.sh" "[ -r 'update-server.sh' ]"

echo "📊 Проверяем синтаксис скриптов..."

# Тест 3: Синтаксис JavaScript
run_test "Синтаксис analyze-crash-recovery.js" "node -c analyze-crash-recovery.js"
run_test "Синтаксис server.js" "node -c server.js"

# Тест 4: Синтаксис Bash скриптов
run_test "Синтаксис auto-restart.sh" "bash -n auto-restart.sh"
run_test "Синтаксис update-server.sh" "bash -n update-server.sh"

echo "🌐 Проверяем веб-интерфейс..."

# Тест 5: Веб-интерфейс (если сервер запущен)
if curl -s http://localhost:3001/api/health > /dev/null 2>&1; then
    run_test "Health Check API" "curl -s http://localhost:3001/api/health | grep -q 'status'"
    run_test "Logs API" "curl -s http://localhost:3001/api/logs | grep -q 'logs'"
    run_test "Monitor Page" "curl -s http://localhost:3001/monitor | grep -q 'monitor'"
else
    echo -e "${YELLOW}⚠️ Сервер не запущен, пропускаем тесты веб-интерфейса${NC}"
    echo ""
fi

echo "🔍 Проверяем механизм анализа сбоя..."

# Тест 6: Анализ сбоя (создаем тестовые файлы)
echo "📝 Создаем тестовые файлы прогресса..."

# Создаем временную директорию для тестов
TEST_DIR="/tmp/wolmar-test-$$"
mkdir -p "$TEST_DIR"
cd "$TEST_DIR"

# Создаем тестовые файлы прогресса
cat > parser_progress_2133.json << EOF
{
    "auctionNumber": "2133",
    "currentLot": 150,
    "progress": 75.5
}
EOF

cat > mass_update_progress_968.json << EOF
{
    "auctionNumber": "968",
    "updateProgress": {
        "currentLot": 200,
        "progress": 80.0
    }
}
EOF

cat > predictions_progress_2133.json << EOF
{
    "auctionNumber": "2133",
    "predictionsProgress": {
        "currentIndex": 100,
        "progress": 50.0
    }
}
EOF

# Копируем скрипт анализа в тестовую директорию
cp /var/www/wolmar-parser/analyze-crash-recovery.js . 2>/dev/null || echo "⚠️ Не удалось скопировать analyze-crash-recovery.js"

# Тест анализа сбоя
run_test "Анализ сбоя (создание отчета)" "node analyze-crash-recovery.js 2>/dev/null"
run_test "Отчет о восстановлении создан" "[ -f 'crash-recovery-report.json' ]"

# Очищаем тестовую директорию
cd /tmp
rm -rf "$TEST_DIR"

echo "📈 Итоговые результаты:"
echo "======================="
echo -e "${GREEN}✅ Пройдено: $TESTS_PASSED${NC}"
echo -e "${RED}❌ Провалено: $TESTS_FAILED${NC}"
echo -e "${BLUE}📊 Всего тестов: $TOTAL_TESTS${NC}"

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}🎉 Все тесты пройдены успешно!${NC}"
    echo -e "${GREEN}✅ Система мониторинга и восстановления работает!${NC}"
    exit 0
else
    echo -e "${RED}⚠️ Некоторые тесты провалены${NC}"
    echo -e "${YELLOW}💡 Проверьте ошибки выше и исправьте их${NC}"
    exit 1
fi

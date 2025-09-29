// Административная панель для управления парсерами
let refreshInterval;
let currentLogType = null;

// Инициализация
document.addEventListener('DOMContentLoaded', function() {
    initializeAdminPanel();
    setupEventListeners();
    startAutoRefresh();
});

function initializeAdminPanel() {
    console.log('Инициализация административной панели...');
    refreshStatus();
    loadSchedule();
    loadCatalogProgress(); // Загружаем прогресс парсера каталога при инициализации
}

function setupEventListeners() {
    // Обработка изменения режима парсера
    document.getElementById('parser-mode').addEventListener('change', function() {
        const resumeInput = document.getElementById('resume-lot-input');
        if (this.value === 'resume') {
            resumeInput.classList.remove('hidden');
        } else {
            resumeInput.classList.add('hidden');
        }
    });
}

function startAutoRefresh() {
    // Обновляем статус каждые 5 секунд
    refreshInterval = setInterval(refreshStatus, 5000);
}

// Обновление статуса всех процессов
async function refreshStatus() {
    try {
        const response = await fetch('/api/admin/status');
        const data = await response.json();
        
        updateStatusDisplay(data);
        
        // Также загружаем прогресс парсера каталога при обновлении статуса
        loadCatalogProgress();
    } catch (error) {
        console.error('Ошибка получения статуса:', error);
        updateStatusDisplay({
            mainParser: { status: 'error', message: 'Ошибка подключения' },
            updateParser: { status: 'error', message: 'Ошибка подключения' },
            schedule: { status: 'error', message: 'Ошибка подключения' }
        });
    }
}

function updateStatusDisplay(data) {
    // Обновляем статус основного парсера
    const mainStatus = document.getElementById('main-parser-status');
    if (data.mainParser) {
        mainStatus.innerHTML = `<span class="status-${data.mainParser.status}">${data.mainParser.message}</span>`;
    }

    // Обновляем статус парсера обновлений
    const updateStatus = document.getElementById('update-parser-status');
    if (data.updateParser) {
        updateStatus.innerHTML = `<span class="status-${data.updateParser.status}">${data.updateParser.message}</span>`;
    }

    // Обновляем статус генератора прогнозов
    const predictionsStatus = document.getElementById('predictions-status');
    if (data.predictionsGenerator) {
        predictionsStatus.innerHTML = `<span class="status-${data.predictionsGenerator.status}">${data.predictionsGenerator.message}</span>`;
    }

    // Обновляем статус парсера каталога
    const catalogParserStatus = document.getElementById('catalog-parser-status');
    if (data.catalogParser) {
        catalogParserStatus.innerHTML = `<span class="status-${data.catalogParser.status}">${data.catalogParser.message}</span>`;
    }

    // Обновляем статус расписания
    const scheduleStatus = document.getElementById('schedule-status');
    if (data.schedule) {
        scheduleStatus.innerHTML = `<span class="status-${data.schedule.status}">${data.schedule.message}</span>`;
    }

    // Обновляем кнопки
    updateButtons(data);
}

function updateButtons(data) {
    const startMainBtn = document.getElementById('start-main-btn');
    const stopMainBtn = document.getElementById('stop-main-btn');
    const startUpdateBtn = document.getElementById('start-update-btn');
    const stopUpdateBtn = document.getElementById('stop-update-btn');
    const startPredictionsBtn = document.getElementById('start-predictions-btn');
    const stopPredictionsBtn = document.getElementById('stop-predictions-btn');
    const startCatalogBtn = document.getElementById('start-catalog-btn');
    const stopCatalogBtn = document.getElementById('stop-catalog-btn');

    // Основной парсер
    if (data.mainParser && data.mainParser.status === 'running') {
        startMainBtn.disabled = true;
        stopMainBtn.disabled = false;
    } else {
        startMainBtn.disabled = false;
        stopMainBtn.disabled = true;
    }

    // Парсер обновлений
    if (data.updateParser && data.updateParser.status === 'running') {
        startUpdateBtn.disabled = true;
        stopUpdateBtn.disabled = false;
    } else {
        startUpdateBtn.disabled = false;
        stopUpdateBtn.disabled = true;
    }

    // Генератор прогнозов
    if (data.predictionsGenerator && data.predictionsGenerator.status === 'running') {
        startPredictionsBtn.disabled = true;
        stopPredictionsBtn.disabled = false;
    } else {
        startPredictionsBtn.disabled = false;
        stopPredictionsBtn.disabled = true;
    }

    // Парсер каталога
    if (data.catalogParser && data.catalogParser.status === 'running') {
        startCatalogBtn.disabled = true;
        stopCatalogBtn.disabled = false;
    } else {
        startCatalogBtn.disabled = false;
        stopCatalogBtn.disabled = true;
    }
}

// Запуск основного парсера
async function startMainParser() {
    const auctionNumber = document.getElementById('auction-number').value;
    const mode = document.getElementById('parser-mode').value;
    const resumeLot = document.getElementById('resume-lot').value;

    if (!auctionNumber) {
        alert('Пожалуйста, введите номер аукциона');
        return;
    }

    if (mode === 'resume' && !resumeLot) {
        alert('Пожалуйста, введите номер лота для продолжения');
        return;
    }

    try {
        const response = await fetch('/api/admin/start-main-parser', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                auctionNumber: parseInt(auctionNumber),
                mode: mode,
                resumeLot: resumeLot ? parseInt(resumeLot) : null
            })
        });

        const result = await response.json();
        
        if (result.success) {
            alert('Основной парсер запущен');
            refreshStatus();
        } else {
            alert('Ошибка запуска: ' + result.error);
        }
    } catch (error) {
        console.error('Ошибка запуска основного парсера:', error);
        alert('Ошибка запуска основного парсера');
    }
}

// Остановка основного парсера
async function stopMainParser() {
    try {
        const response = await fetch('/api/admin/stop-main-parser', {
            method: 'POST'
        });

        const result = await response.json();
        
        if (result.success) {
            alert('Основной парсер остановлен');
            refreshStatus();
        } else {
            alert('Ошибка остановки: ' + result.error);
        }
    } catch (error) {
        console.error('Ошибка остановки основного парсера:', error);
        alert('Ошибка остановки основного парсера');
    }
}

// Запуск парсера обновлений
async function startUpdateParser() {
    const auctionNumber = document.getElementById('update-auction-number').value;
    const startIndex = document.getElementById('update-start-index').value;

    if (!auctionNumber) {
        alert('Пожалуйста, введите номер аукциона');
        return;
    }

    try {
        const response = await fetch('/api/admin/start-update-parser', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                auctionNumber: parseInt(auctionNumber),
                startIndex: startIndex ? parseInt(startIndex) : null
            })
        });

        const result = await response.json();
        
        if (result.success) {
            alert('Парсер обновлений запущен');
            refreshStatus();
        } else {
            alert('Ошибка запуска: ' + result.error);
        }
    } catch (error) {
        console.error('Ошибка запуска парсера обновлений:', error);
        alert('Ошибка запуска парсера обновлений');
    }
}

// Остановка парсера обновлений
async function stopUpdateParser() {
    try {
        const response = await fetch('/api/admin/stop-update-parser', {
            method: 'POST'
        });

        const result = await response.json();
        
        if (result.success) {
            alert('Парсер обновлений остановлен');
            refreshStatus();
        } else {
            alert('Ошибка остановки: ' + result.error);
        }
    } catch (error) {
        console.error('Ошибка остановки парсера обновлений:', error);
        alert('Ошибка остановки парсера обновлений');
    }
}

// Сохранение расписания
async function saveSchedule() {
    const time = document.getElementById('schedule-time').value;
    const auctionNumber = document.getElementById('schedule-auction').value;

    if (!time || !auctionNumber) {
        alert('Пожалуйста, заполните все поля');
        return;
    }

    try {
        const response = await fetch('/api/admin/schedule', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                time: time,
                auctionNumber: parseInt(auctionNumber)
            })
        });

        const result = await response.json();
        
        if (result.success) {
            alert('Расписание сохранено');
            loadSchedule();
        } else {
            alert('Ошибка сохранения: ' + result.error);
        }
    } catch (error) {
        console.error('Ошибка сохранения расписания:', error);
        alert('Ошибка сохранения расписания');
    }
}

// Удаление расписания
async function deleteSchedule() {
    if (!confirm('Вы уверены, что хотите удалить расписание?')) {
        return;
    }

    try {
        const response = await fetch('/api/admin/schedule', {
            method: 'DELETE'
        });

        const result = await response.json();
        
        if (result.success) {
            alert('Расписание удалено');
            loadSchedule();
        } else {
            alert('Ошибка удаления: ' + result.error);
        }
    } catch (error) {
        console.error('Ошибка удаления расписания:', error);
        alert('Ошибка удаления расписания');
    }
}

// Загрузка расписания
async function loadSchedule() {
    try {
        const response = await fetch('/api/admin/schedule');
        const data = await response.json();
        
        if (data.schedule) {
            document.getElementById('schedule-time').value = data.schedule.time;
            document.getElementById('schedule-auction').value = data.schedule.auctionNumber;
        }
    } catch (error) {
        console.error('Ошибка загрузки расписания:', error);
    }
}

// Показать логи основного парсера
async function showMainLogs() {
    currentLogType = 'main';
    await loadLogs('main');
}

// Показать логи парсера обновлений
async function showUpdateLogs() {
    currentLogType = 'update';
    await loadLogs('update');
}

// Показать логи генерации прогнозов
async function showPredictionsLogs() {
    currentLogType = 'predictions';
    await loadLogs('predictions');
}

// Загрузка логов
async function loadLogs(type) {
    try {
        const response = await fetch(`/api/admin/logs/${type}`);
        const data = await response.json();
        
        const logContainer = document.getElementById('log-container');
        if (data.logs && data.logs.length > 0) {
            logContainer.innerHTML = data.logs.map(log => 
                `<div class="mb-1">${log}</div>`
            ).join('');
            logContainer.scrollTop = logContainer.scrollHeight;
        } else {
            logContainer.innerHTML = '<div class="text-gray-400">Логи отсутствуют</div>';
        }
    } catch (error) {
        console.error('Ошибка загрузки логов:', error);
        document.getElementById('log-container').innerHTML = 
            '<div class="text-red-400">Ошибка загрузки логов</div>';
    }
}

// Очистка логов
async function clearLogs() {
    if (!confirm('Вы уверены, что хотите очистить все логи (основной парсер, обновления, прогнозы)?')) {
        return;
    }

    try {
        const response = await fetch('/api/admin/logs/clear', {
            method: 'POST'
        });

        const result = await response.json();
        
        if (result.success) {
            alert(result.message || 'Все логи очищены');
            if (currentLogType) {
                await loadLogs(currentLogType);
            }
        } else {
            alert('Ошибка очистки: ' + result.error);
        }
    } catch (error) {
        console.error('Ошибка очистки логов:', error);
        alert('Ошибка очистки логов');
    }
}

// Загрузка прогресса парсера обновлений
async function loadUpdateProgress(auctionNumber) {
    try {
        const response = await fetch(`/api/admin/update-progress/${auctionNumber}`);
        
        // Проверяем, что ответ не HTML
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            console.warn('API возвращает не JSON, возможно сервер не перезапущен');
            return;
        }
        
        const data = await response.json();
        
        const progressInfo = document.getElementById('update-progress-info');
        const progressText = document.getElementById('update-progress-text');
        const progressBar = document.getElementById('progress-bar');
        
        if (data.progress) {
            const progress = data.progress;
            const percentage = Math.round((progress.currentIndex / progress.totalLots) * 100);
            const lastUpdate = new Date(progress.lastUpdate).toLocaleString();
            
            progressText.textContent = `Прогресс: ${progress.currentIndex}/${progress.totalLots} (${percentage}%) | Последнее обновление: ${lastUpdate}`;
            progressBar.style.width = `${percentage}%`;
            progressInfo.classList.remove('hidden');
            
            // Автоматически заполняем стартовый индекс
            const startIndexInput = document.getElementById('update-start-index');
            if (startIndexInput && !startIndexInput.value) {
                startIndexInput.value = progress.currentIndex;
                startIndexInput.placeholder = `Автовозобновление с лота ${progress.currentIndex}`;
            }
        } else {
            progressInfo.classList.add('hidden');
        }
    } catch (error) {
        console.error('Ошибка загрузки прогресса:', error);
    }
}

// Обновление прогресса
async function refreshUpdateProgress() {
    const auctionNumber = document.getElementById('update-auction-number').value;
    if (auctionNumber) {
        await loadUpdateProgress(auctionNumber);
    }
}

// Очистка прогресса
async function clearUpdateProgress() {
    if (!confirm('Вы уверены, что хотите очистить прогресс? Это удалит информацию о текущем состоянии парсера.')) {
        return;
    }
    
    const auctionNumber = document.getElementById('update-auction-number').value;
    if (!auctionNumber) {
        alert('Введите номер аукциона');
        return;
    }
    
    try {
        const response = await fetch(`/api/admin/clear-update-progress/${auctionNumber}`, {
            method: 'POST'
        });
        
        const result = await response.json();
        
        if (result.success) {
            alert('Прогресс очищен');
            document.getElementById('update-progress-info').classList.add('hidden');
            document.getElementById('update-start-index').value = '';
            document.getElementById('update-start-index').placeholder = 'Например: 1000 (оставить пустым для автовозобновления)';
        } else {
            alert('Ошибка очистки прогресса: ' + result.error);
        }
    } catch (error) {
        console.error('Ошибка очистки прогресса:', error);
        alert('Ошибка очистки прогресса');
    }
}

// Обработка изменения номера аукциона для обновления
document.addEventListener('DOMContentLoaded', function() {
    const updateAuctionInput = document.getElementById('update-auction-number');
    if (updateAuctionInput) {
        updateAuctionInput.addEventListener('input', function() {
            const auctionNumber = this.value;
            if (auctionNumber) {
                loadUpdateProgress(auctionNumber);
            } else {
                document.getElementById('update-progress-info').classList.add('hidden');
            }
        });
    }

    // Обработка изменения номера аукциона для прогнозов
    const predictionsAuctionInput = document.getElementById('predictions-auction-number');
    if (predictionsAuctionInput) {
        predictionsAuctionInput.addEventListener('input', function() {
            const auctionNumber = this.value;
            if (auctionNumber) {
                loadPredictionsProgress(auctionNumber);
            } else {
                document.getElementById('predictions-progress-info').classList.add('hidden');
            }
        });
    }
});

// ==================== ФУНКЦИИ ДЛЯ ГЕНЕРАЦИИ ПРОГНОЗОВ ====================

// Загрузка прогресса генерации прогнозов
async function loadPredictionsProgress(auctionNumber) {
    try {
        const response = await fetch(`/api/admin/predictions-progress/${auctionNumber}`);
        
        // Проверяем, что ответ не HTML
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            console.warn('API возвращает не JSON, возможно сервер не перезапущен');
            return;
        }
        
        const data = await response.json();
        
        const progressInfo = document.getElementById('predictions-progress-info');
        const progressText = document.getElementById('predictions-progress-text');
        const progressBar = document.getElementById('predictions-progress-bar');
        
        if (data.progress) {
            const progress = data.progress;
            const percentage = Math.round((progress.currentIndex / progress.totalLots) * 100);
            const lastUpdate = new Date(progress.lastUpdate).toLocaleString();
            
            progressText.textContent = `Прогресс: ${progress.currentIndex}/${progress.totalLots} (${percentage}%) | Обработано: ${progress.processedCount} | Ошибок: ${progress.errorCount} | Последнее обновление: ${lastUpdate}`;
            progressBar.style.width = `${percentage}%`;
            progressInfo.classList.remove('hidden');
            
            // Автоматически заполняем стартовый индекс
            const startIndexInput = document.getElementById('predictions-start-index');
            if (startIndexInput && !startIndexInput.value) {
                startIndexInput.value = progress.currentIndex;
                startIndexInput.placeholder = `Автовозобновление с лота ${progress.currentIndex}`;
            }
        } else {
            progressInfo.classList.add('hidden');
        }
    } catch (error) {
        console.error('Ошибка загрузки прогресса прогнозов:', error);
    }
}

// Обновление прогресса прогнозов
async function refreshPredictionsProgress() {
    const auctionNumber = document.getElementById('predictions-auction-number').value;
    if (auctionNumber) {
        await loadPredictionsProgress(auctionNumber);
    }
}

// Очистка прогресса прогнозов
async function clearPredictionsProgress() {
    if (!confirm('Вы уверены, что хотите очистить прогресс генерации прогнозов? Это удалит информацию о текущем состоянии.')) {
        return;
    }
    
    const auctionNumber = document.getElementById('predictions-auction-number').value;
    if (!auctionNumber) {
        alert('Введите номер аукциона');
        return;
    }
    
    try {
        const response = await fetch(`/api/admin/clear-predictions-progress/${auctionNumber}`, {
            method: 'POST'
        });
        
        const result = await response.json();
        
        if (result.success) {
            alert('Прогресс прогнозов очищен');
            document.getElementById('predictions-progress-info').classList.add('hidden');
            document.getElementById('predictions-start-index').value = '';
            document.getElementById('predictions-start-index').placeholder = 'Например: 1000 (оставить пустым для автовозобновления)';
        } else {
            alert('Ошибка очистки прогресса: ' + result.error);
        }
    } catch (error) {
        console.error('Ошибка очистки прогресса прогнозов:', error);
        alert('Ошибка очистки прогресса прогнозов');
    }
}

// Запуск генерации прогнозов
async function startPredictionsGenerator() {
    const auctionNumber = document.getElementById('predictions-auction-number').value;
    const startFromIndex = document.getElementById('predictions-start-index').value;

    if (!auctionNumber) {
        alert('Пожалуйста, введите номер аукциона');
        return;
    }

    try {
        const response = await fetch('/api/admin/start-predictions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                auctionNumber: parseInt(auctionNumber),
                startFromIndex: startFromIndex ? parseInt(startFromIndex) : null
            })
        });

        const result = await response.json();
        
        if (result.success) {
            alert('Генерация прогнозов запущена');
            refreshStatus();
        } else {
            alert('Ошибка запуска: ' + result.error);
        }
    } catch (error) {
        console.error('Ошибка запуска генерации прогнозов:', error);
        alert('Ошибка запуска генерации прогнозов');
    }
}

// Остановка генерации прогнозов
async function stopPredictionsGenerator() {
    try {
        const response = await fetch('/api/admin/stop-predictions', {
            method: 'POST'
        });

        const result = await response.json();
        
        if (result.success) {
            alert('Генерация прогнозов остановлена');
            refreshStatus();
        } else {
            alert('Ошибка остановки: ' + result.error);
        }
    } catch (error) {
        console.error('Ошибка остановки генерации прогнозов:', error);
        alert('Ошибка остановки генерации прогнозов');
    }
}

// ==================== ФУНКЦИИ ДЛЯ ПАРСЕРА КАТАЛОГА ====================

// Запуск парсера каталога
async function startCatalogParser() {
    try {
        const response = await fetch('/api/admin/start-catalog-parser', {
            method: 'POST'
        });

        const result = await response.json();
        
        if (result.success) {
            alert('Парсер каталога запущен');
            refreshStatus();
            // Загружаем прогресс
            setTimeout(() => {
                loadCatalogProgress();
            }, 1000);
        } else {
            alert('Ошибка запуска: ' + result.error);
        }
    } catch (error) {
        console.error('Ошибка запуска парсера каталога:', error);
        alert('Ошибка запуска парсера каталога');
    }
}

// Остановка парсера каталога
async function stopCatalogParser() {
    try {
        const response = await fetch('/api/admin/stop-catalog-parser', {
            method: 'POST'
        });

        const result = await response.json();
        
        if (result.success) {
            alert('Парсер каталога остановлен');
            refreshStatus();
        } else {
            alert('Ошибка остановки: ' + result.error);
        }
    } catch (error) {
        console.error('Ошибка остановки парсера каталога:', error);
        alert('Ошибка остановки парсера каталога');
    }
}

// Загрузка прогресса парсера каталога
async function loadCatalogProgress() {
    try {
        // Сначала проверяем статус парсера
        const statusResponse = await fetch('/api/admin/catalog-parser-status');
        const statusData = await statusResponse.json();
        
        const progressInfo = document.getElementById('catalog-progress-info');
        const progressText = document.getElementById('catalog-progress-text');
        const progressBar = document.getElementById('catalog-progress-bar');
        
        // Если парсер остановлен, скрываем блок прогресса
        if (statusData.status === 'stopped') {
            progressInfo.classList.add('hidden');
            return;
        }
        
        // Если парсер работает, загружаем прогресс
        const response = await fetch('/api/admin/catalog-parser-progress');
        const data = await response.json();
        
        if (data.success && data.progress) {
            const progress = data.progress;
            const lastUpdate = new Date(progress.lastUpdate).toLocaleString();
            
            // Показываем детальную информацию о прогрессе с индикатором активности
            const timeSinceUpdate = new Date() - new Date(progress.lastUpdate);
            const isActive = timeSinceUpdate < 30000; // Активен, если обновлялся менее 30 секунд назад
            const statusIcon = isActive ? '🟢' : '🟡';
            const statusText = isActive ? 'Активен' : 'Пауза';
            
            // Используем реальное общее количество лотов
            const totalLots = progress.totalLots || 0;
            const processedCount = progress.totalProcessed || 0;
            const percentage = totalLots > 0 ? Math.round((processedCount / totalLots) * 100) : 0;
            
            const progressTextContent = `${statusIcon} ${statusText} | Прогресс: ${processedCount}/${totalLots} (${percentage}%) | Ошибок: ${progress.totalErrors} | ID: ${progress.lastProcessedId} | ${lastUpdate}`;
            progressText.textContent = progressTextContent;
            
            // Реальный прогресс-бар на основе общего количества лотов
            progressBar.style.width = `${percentage}%`;
            progressInfo.classList.remove('hidden');
        } else if (data.success) {
            console.log('⚠️ API работает, но нет данных о прогрессе');
            // Если API работает, но нет данных о прогрессе, показываем блок с сообщением
            progressText.textContent = 'Прогресс парсера каталога недоступен';
            progressBar.style.width = '0%';
            progressInfo.classList.remove('hidden');
        } else {
            console.log('❌ API не работает, скрываем блок');
            progressInfo.classList.add('hidden');
        }
    } catch (error) {
        console.error('Ошибка загрузки прогресса парсера каталога:', error);
    }
}

// Обновление прогресса парсера каталога
async function refreshCatalogProgress() {
    await loadCatalogProgress();
}

// Очистка прогресса парсера каталога
async function clearCatalogProgress() {
    if (!confirm('Вы уверены, что хотите очистить прогресс парсера каталога? Это удалит информацию о текущем состоянии.')) {
        return;
    }
    
    try {
        const response = await fetch('/api/admin/clear-catalog-progress', {
            method: 'POST'
        });
        
        const result = await response.json();
        
        if (result.success) {
            alert('Прогресс парсера каталога очищен');
            document.getElementById('catalog-progress-info').classList.add('hidden');
        } else {
            alert('Ошибка очистки прогресса: ' + result.error);
        }
    } catch (error) {
        console.error('Ошибка очистки прогресса парсера каталога:', error);
        alert('Ошибка очистки прогресса парсера каталога');
    }
}

// Показать логи парсера каталога
async function showCatalogLogs() {
    currentLogType = 'catalog';
    await loadCatalogLogs();
}

// Загрузка логов парсера каталога
async function loadCatalogLogs() {
    try {
        const response = await fetch('/api/admin/catalog-parser-logs');
        const data = await response.json();
        
        const logContainer = document.getElementById('log-container');
        if (data.logs && data.logs.length > 0) {
            let logContent = '';
            data.logs.forEach(log => {
                if (log.type === 'json') {
                    logContent += `<div class="mb-2"><strong>${log.file}:</strong></div>`;
                    logContent += `<div class="ml-4 mb-2 text-sm text-gray-300">${JSON.stringify(log.data, null, 2)}</div>`;
                } else if (log.type === 'text') {
                    logContent += `<div class="mb-2"><strong>${log.file}:</strong></div>`;
                    logContent += log.lines.map(line => `<div class="ml-4 mb-1">${line}</div>`).join('');
                } else if (log.type === 'error') {
                    logContent += `<div class="mb-2 text-red-400"><strong>${log.file}:</strong> ${log.error}</div>`;
                }
            });
            logContainer.innerHTML = logContent;
            logContainer.scrollTop = logContainer.scrollHeight;
        } else {
            logContainer.innerHTML = '<div class="text-gray-400">Логи парсера каталога отсутствуют</div>';
        }
    } catch (error) {
        console.error('Ошибка загрузки логов парсера каталога:', error);
        document.getElementById('log-container').innerHTML = 
            '<div class="text-red-400">Ошибка загрузки логов парсера каталога</div>';
    }
}






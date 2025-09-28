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
    if (!confirm('Вы уверены, что хотите очистить логи?')) {
        return;
    }

    try {
        const response = await fetch('/api/admin/logs/clear', {
            method: 'POST'
        });

        const result = await response.json();
        
        if (result.success) {
            alert('Логи очищены');
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
});






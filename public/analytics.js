// ============================================================================
// АНАЛИТИКА ПОДОЗРИТЕЛЬНЫХ СТАВОК - КЛИЕНТСКИЙ КОД
// ============================================================================

// Глобальные переменные
let currentTab = 'fast-bids';
let dashboardStats = {};

// ============================================================================
// ИНИЦИАЛИЗАЦИЯ
// ============================================================================

document.addEventListener('DOMContentLoaded', function() {
    initializeTabs();
    loadDashboardStats();
});

// ============================================================================
// УПРАВЛЕНИЕ ВКЛАДКАМИ
// ============================================================================

function initializeTabs() {
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');
    
    tabButtons.forEach(button => {
        button.addEventListener('click', function() {
            const tabId = this.getAttribute('data-tab');
            switchTab(tabId);
        });
    });
}

function switchTab(tabId) {
    // Обновляем кнопки
    document.querySelectorAll('.tab-button').forEach(btn => {
        btn.classList.remove('active', 'border-blue-500', 'text-blue-600');
        btn.classList.add('border-transparent', 'text-gray-500');
    });
    
    const activeButton = document.querySelector(`[data-tab="${tabId}"]`);
    activeButton.classList.add('active', 'border-blue-500', 'text-blue-600');
    activeButton.classList.remove('border-transparent', 'text-gray-500');
    
    // Обновляем контент
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.add('hidden');
    });
    
    document.getElementById(tabId).classList.remove('hidden');
    currentTab = tabId;
}

// ============================================================================
// ЗАГРУЗКА СТАТИСТИКИ ДАШБОРДА
// ============================================================================

async function loadDashboardStats() {
    try {
        showLoading();
        const response = await fetch('/api/analytics/dashboard-stats');
        const result = await response.json();
        
        if (result.success) {
            dashboardStats = result.data;
            updateDashboardStats();
        } else {
            showError('Ошибка загрузки статистики: ' + result.error);
        }
    } catch (error) {
        showError('Ошибка загрузки статистики: ' + error.message);
    } finally {
        hideLoading();
    }
}

function updateDashboardStats() {
    document.getElementById('total-bids').textContent = formatNumber(dashboardStats.totalBids);
    document.getElementById('total-bidders').textContent = formatNumber(dashboardStats.totalBidders);
    document.getElementById('manual-bids').textContent = formatNumber(dashboardStats.manualBids);
    document.getElementById('manual-percentage').textContent = `${dashboardStats.manualBidPercentage}% от всех ставок`;
    document.getElementById('suspicious-users').textContent = formatNumber(dashboardStats.suspiciousUsers);
    document.getElementById('suspicious-percentage').textContent = `${dashboardStats.suspiciousPercentage}% от всех участников`;
}

// ============================================================================
// АНАЛИЗ БЫСТРЫХ СТАВОК
// ============================================================================

async function loadFastBids() {
    try {
        showLoading();
        
        const interval = document.getElementById('fast-bids-interval').value;
        const limit = document.getElementById('fast-bids-limit').value;
        
        const response = await fetch(`/api/analytics/fast-manual-bids?minInterval=${interval}&limit=${limit}`);
        const result = await response.json();
        
        if (result.success) {
            displayFastBids(result.data);
        } else {
            showError('Ошибка анализа быстрых ставок: ' + result.error);
        }
    } catch (error) {
        showError('Ошибка анализа быстрых ставок: ' + error.message);
    } finally {
        hideLoading();
    }
}

function displayFastBids(data) {
    const resultsDiv = document.getElementById('fast-bids-results');
    const tableBody = document.getElementById('fast-bids-table-body');
    
    if (data.length === 0) {
        resultsDiv.innerHTML = '<p class="text-gray-600 text-center py-8">Подозрительных быстрых ставок не найдено</p>';
        resultsDiv.classList.remove('hidden');
        return;
    }
    
    tableBody.innerHTML = '';
    
    data.forEach(bid => {
        const row = document.createElement('tr');
        row.className = 'hover:bg-gray-50';
        
        const riskClass = getRiskClass(bid.suspicious_level);
        
        row.innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                ${bid.auction_number}/${bid.lot_number}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                ${bid.bidder_login}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                ${formatPrice(bid.bid_amount)}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                ${formatDateTime(bid.bid_timestamp)}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                <span class="font-mono">${bid.seconds_between_bids.toFixed(2)}</span>
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
                <span class="inline-flex px-2 py-1 text-xs font-semibold rounded-full ${riskClass}">
                    ${bid.suspicious_level}
                </span>
            </td>
        `;
        
        tableBody.appendChild(row);
    });
    
    resultsDiv.classList.remove('hidden');
}

// ============================================================================
// АНАЛИЗ ЛОВУШЕК АВТОБИДА
// ============================================================================

async function loadAutobidTraps() {
    try {
        showLoading();
        
        const limit = document.getElementById('autobid-traps-limit').value;
        
        const response = await fetch(`/api/analytics/autobid-traps?limit=${limit}`);
        const result = await response.json();
        
        if (result.success) {
            displayAutobidTraps(result.data);
        } else {
            showError('Ошибка анализа ловушек автобида: ' + result.error);
        }
    } catch (error) {
        showError('Ошибка анализа ловушек автобида: ' + error.message);
    } finally {
        hideLoading();
    }
}

function displayAutobidTraps(data) {
    const resultsDiv = document.getElementById('autobid-traps-results');
    const tableBody = document.getElementById('autobid-traps-table-body');
    
    if (data.length === 0) {
        resultsDiv.innerHTML = '<p class="text-gray-600 text-center py-8">Ловушек автобида не найдено</p>';
        resultsDiv.classList.remove('hidden');
        return;
    }
    
    tableBody.innerHTML = '';
    
    data.forEach(trap => {
        const row = document.createElement('tr');
        row.className = 'hover:bg-gray-50';
        
        const isWinner = trap.bidder_login === trap.winner_login;
        const winnerClass = isWinner ? 'text-green-600 font-semibold' : 'text-gray-900';
        
        row.innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                ${trap.auction_number}/${trap.lot_number}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm ${winnerClass}">
                ${trap.bidder_login}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                ${formatPrice(trap.bid_amount)}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                ${formatPrice(trap.winning_bid)}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                ${trap.winner_login || 'Не продан'}
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
                <span class="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-red-100 text-red-800">
                    ${trap.suspicious_pattern}
                </span>
            </td>
        `;
        
        tableBody.appendChild(row);
    });
    
    resultsDiv.classList.remove('hidden');
}

// ============================================================================
// АНАЛИЗ ВРЕМЕННЫХ ПАТТЕРНОВ
// ============================================================================

async function loadTimePatterns() {
    try {
        showLoading();
        
        const bidderLogin = document.getElementById('time-patterns-bidder').value;
        const params = bidderLogin ? `?bidderLogin=${encodeURIComponent(bidderLogin)}` : '';
        
        const response = await fetch(`/api/analytics/time-patterns${params}`);
        const result = await response.json();
        
        if (result.success) {
            displayTimePatterns(result.data);
        } else {
            showError('Ошибка анализа временных паттернов: ' + result.error);
        }
    } catch (error) {
        showError('Ошибка анализа временных паттернов: ' + error.message);
    } finally {
        hideLoading();
    }
}

function displayTimePatterns(data) {
    const resultsDiv = document.getElementById('time-patterns-results');
    const tableBody = document.getElementById('time-patterns-table-body');
    
    if (data.length === 0) {
        resultsDiv.innerHTML = '<p class="text-gray-600 text-center py-8">Временных паттернов не найдено</p>';
        resultsDiv.classList.remove('hidden');
        return;
    }
    
    tableBody.innerHTML = '';
    
    data.forEach(pattern => {
        const row = document.createElement('tr');
        row.className = 'hover:bg-gray-50';
        
        const dayNames = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
        const isNightTime = pattern.hour_of_day >= 22 || pattern.hour_of_day <= 6;
        const timeClass = isNightTime ? 'text-red-600 font-semibold' : 'text-gray-900';
        
        row.innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                ${pattern.bidder_login}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm ${timeClass}">
                ${pattern.hour_of_day}:00
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                ${dayNames[pattern.day_of_week]}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                ${formatNumber(pattern.manual_bid_count)}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                ${formatPrice(pattern.avg_bid_amount)}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                ${formatPrice(pattern.min_bid_amount)} - ${formatPrice(pattern.max_bid_amount)}
            </td>
        `;
        
        tableBody.appendChild(row);
    });
    
    resultsDiv.classList.remove('hidden');
}

// ============================================================================
// АНАЛИЗ СООТНОШЕНИЯ СТАВОК
// ============================================================================

async function loadBidRatios() {
    try {
        showLoading();
        
        const minBids = document.getElementById('bid-ratios-min-bids').value;
        const minManual = document.getElementById('bid-ratios-min-manual').value;
        
        const response = await fetch(`/api/analytics/bid-ratios?minBids=${minBids}&minManualRatio=${minManual}`);
        const result = await response.json();
        
        if (result.success) {
            displayBidRatios(result.data);
        } else {
            showError('Ошибка анализа соотношения ставок: ' + result.error);
        }
    } catch (error) {
        showError('Ошибка анализа соотношения ставок: ' + error.message);
    } finally {
        hideLoading();
    }
}

function displayBidRatios(data) {
    const resultsDiv = document.getElementById('bid-ratios-results');
    const tableBody = document.getElementById('bid-ratios-table-body');
    
    if (data.length === 0) {
        resultsDiv.innerHTML = '<p class="text-gray-600 text-center py-8">Пользователей с высоким процентом ручных ставок не найдено</p>';
        resultsDiv.classList.remove('hidden');
        return;
    }
    
    tableBody.innerHTML = '';
    
    data.forEach(ratio => {
        const row = document.createElement('tr');
        row.className = 'hover:bg-gray-50';
        
        const manualClass = ratio.manual_bid_percentage > 90 ? 'text-red-600 font-semibold' : 'text-gray-900';
        
        row.innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                ${ratio.bidder_login}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                ${formatNumber(ratio.total_bids)}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                ${formatNumber(ratio.autobid_count)}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                ${formatNumber(ratio.manual_bid_count)}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm ${manualClass}">
                ${ratio.manual_bid_percentage}%
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                ${ratio.autobid_percentage}%
            </td>
        `;
        
        tableBody.appendChild(row);
    });
    
    resultsDiv.classList.remove('hidden');
}

// ============================================================================
// АНАЛИЗ КОНФЛИКТОВ СТАВЩИКОВ
// ============================================================================

async function loadConflicts() {
    try {
        showLoading();
        
        const minConflicts = document.getElementById('conflicts-min-conflicts').value;
        const limit = document.getElementById('conflicts-limit').value;
        
        const response = await fetch(`/api/analytics/bidder-conflicts?minConflicts=${minConflicts}&limit=${limit}`);
        const result = await response.json();
        
        if (result.success) {
            displayConflicts(result.data);
        } else {
            showError('Ошибка анализа конфликтов: ' + result.error);
        }
    } catch (error) {
        showError('Ошибка анализа конфликтов: ' + error.message);
    } finally {
        hideLoading();
    }
}

function displayConflicts(data) {
    const resultsDiv = document.getElementById('conflicts-results');
    const tableBody = document.getElementById('conflicts-table-body');
    
    if (data.length === 0) {
        resultsDiv.innerHTML = '<p class="text-gray-600 text-center py-8">Конфликтов ставщиков не найдено</p>';
        resultsDiv.classList.remove('hidden');
        return;
    }
    
    tableBody.innerHTML = '';
    
    data.forEach(conflict => {
        const row = document.createElement('tr');
        row.className = 'hover:bg-gray-50';
        
        const duration = formatDuration(conflict.duration_seconds);
        const conflictClass = conflict.bid_count > 10 ? 'text-red-600 font-semibold' : 'text-gray-900';
        
        row.innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                ${conflict.auction_number}/${conflict.lot_number}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                ${conflict.bidder_login}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                ${conflict.prev_bidder}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm ${conflictClass}">
                ${conflict.bid_count}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                ${duration}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                ${formatDateTime(conflict.first_bid)} - ${formatDateTime(conflict.last_bid)}
            </td>
        `;
        
        tableBody.appendChild(row);
    });
    
    resultsDiv.classList.remove('hidden');
}

// ============================================================================
// СКОРИНГ ПОДОЗРИТЕЛЬНОСТИ
// ============================================================================

async function loadScoring() {
    try {
        showLoading();
        
        const minBids = document.getElementById('scoring-min-bids').value;
        const limit = document.getElementById('scoring-limit').value;
        
        const response = await fetch(`/api/analytics/suspicious-scoring?minBids=${minBids}&limit=${limit}`);
        const result = await response.json();
        
        if (result.success) {
            displayScoring(result.data);
        } else {
            showError('Ошибка скоринга подозрительности: ' + result.error);
        }
    } catch (error) {
        showError('Ошибка скоринга подозрительности: ' + error.message);
    } finally {
        hideLoading();
    }
}

function displayScoring(data) {
    const resultsDiv = document.getElementById('scoring-results');
    const tableBody = document.getElementById('scoring-table-body');
    
    if (data.length === 0) {
        resultsDiv.innerHTML = '<p class="text-gray-600 text-center py-8">Данных для скоринга не найдено</p>';
        resultsDiv.classList.remove('hidden');
        return;
    }
    
    tableBody.innerHTML = '';
    
    data.forEach(score => {
        const row = document.createElement('tr');
        row.className = 'hover:bg-gray-50';
        
        const riskClass = getRiskClass(score.risk_level);
        const scoreClass = score.total_suspicious_score > 30 ? 'text-red-600 font-semibold' : 'text-gray-900';
        
        row.innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                ${score.bidder_login}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                ${formatNumber(score.total_bids)}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                ${formatNumber(score.manual_bids)}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                ${score.manual_bid_percentage}%
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                ${score.night_bids_score}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                ${score.high_manual_ratio_score}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm ${scoreClass}">
                ${score.total_suspicious_score}
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
                <span class="inline-flex px-2 py-1 text-xs font-semibold rounded-full ${riskClass}">
                    ${score.risk_level}
                </span>
            </td>
        `;
        
        tableBody.appendChild(row);
    });
    
    resultsDiv.classList.remove('hidden');
}

// ============================================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================================================

function getRiskClass(riskLevel) {
    switch (riskLevel) {
        case 'ВЫСОКИЙ РИСК':
        case 'КРИТИЧЕСКИ ПОДОЗРИТЕЛЬНО':
            return 'bg-red-100 text-red-800';
        case 'СРЕДНИЙ РИСК':
        case 'ПОДОЗРИТЕЛЬНО':
            return 'bg-yellow-100 text-yellow-800';
        case 'НИЗКИЙ РИСК':
        case 'ВНИМАНИЕ':
            return 'bg-green-100 text-green-800';
        default:
            return 'bg-gray-100 text-gray-800';
    }
}

function formatNumber(num) {
    return new Intl.NumberFormat('ru-RU').format(num);
}

function formatPrice(price) {
    if (!price) return '0 ₽';
    return new Intl.NumberFormat('ru-RU', {
        style: 'currency',
        currency: 'RUB',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(price);
}

function formatDateTime(dateString) {
    const date = new Date(dateString);
    return date.toLocaleString('ru-RU', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function formatDuration(seconds) {
    if (seconds < 60) {
        return `${Math.round(seconds)} сек`;
    } else if (seconds < 3600) {
        return `${Math.round(seconds / 60)} мин`;
    } else {
        return `${Math.round(seconds / 3600)} ч`;
    }
}

function showLoading() {
    document.getElementById('loading-overlay').classList.remove('hidden');
}

function hideLoading() {
    document.getElementById('loading-overlay').classList.add('hidden');
}

function showError(message) {
    alert('Ошибка: ' + message);
    console.error(message);
}

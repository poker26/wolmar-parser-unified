// Global state
let currentAuction = null;
let currentPage = 1;
let currentFilters = {};

// Cache for API requests
const apiCache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// DOM elements
const elements = {
    // Tabs
    auctionsTab: document.getElementById('auctionsTab'),
    lotsTab: document.getElementById('lotsTab'),
    statsTab: document.getElementById('statsTab'),
    
    // Sections
    auctionsSection: document.getElementById('auctionsSection'),
    lotsSection: document.getElementById('lotsSection'),
    statsSection: document.getElementById('statsSection'),
    
    // Loading indicators
    auctionsLoading: document.getElementById('auctionsLoading'),
    lotsLoading: document.getElementById('lotsLoading'),
    topLotsLoading: document.getElementById('topLotsLoading'),
    
    // Content containers
    auctionsGrid: document.getElementById('auctionsGrid'),
    lotsGrid: document.getElementById('lotsGrid'),
    topLotsList: document.getElementById('topLotsList'),
    
    // Filters
    auctionSelect: document.getElementById('auctionSelect'),
    searchInput: document.getElementById('searchInput'),
    metalFilter: document.getElementById('metalFilter'),
    conditionFilter: document.getElementById('conditionFilter'),
    yearInput: document.getElementById('yearInput'),
    clearYearBtn: document.getElementById('clearYearBtn'),
    minPrice: document.getElementById('minPrice'),
    maxPrice: document.getElementById('maxPrice'),
    applyFilters: document.getElementById('applyFilters'),
    clearFilters: document.getElementById('clearFilters'),
    
    // Statistics
    totalAuctions: document.getElementById('totalAuctions'),
    totalLots: document.getElementById('totalLots'),
    totalValue: document.getElementById('totalValue'),
    totalBidders: document.getElementById('totalBidders'),
    
    // Modal
    lotModal: document.getElementById('lotModal'),
    modalTitle: document.getElementById('modalTitle'),
    modalContent: document.getElementById('modalContent'),
    closeModal: document.getElementById('closeModal'),
    
    // Buttons
    refreshBtn: document.getElementById('refreshBtn'),
    exportBtn: document.getElementById('exportBtn'),
    pagination: document.getElementById('pagination')
};

// Initialize app
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
});

async function initializeApp() {
    setupEventListeners();
    await loadAuctions();
    await loadStatistics();
    await loadGlobalFilters();
}

// Cached API request function
async function cachedFetch(url, options = {}) {
    const cacheKey = `${url}_${JSON.stringify(options)}`;
    const cached = apiCache.get(cacheKey);
    
    // Don't cache filtered requests (requests with query parameters)
    const hasFilters = url.includes('?') && (url.includes('search=') || url.includes('metal=') || url.includes('condition=') || url.includes('year=') || url.includes('minPrice=') || url.includes('maxPrice='));
    
    if (!hasFilters && cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        console.log('Using cached data for:', url);
        return cached.data;
    }
    
    try {
        const response = await fetch(url, options);
        const data = await response.json();
        
        // Only cache non-filtered requests
        if (!hasFilters) {
            apiCache.set(cacheKey, {
                data: data,
                timestamp: Date.now()
            });
        }
        
        return data;
    } catch (error) {
        console.error('API request failed:', error);
        throw error;
    }
}

function setupEventListeners() {
    // Tab navigation
    elements.auctionsTab.addEventListener('click', () => switchTab('auctions'));
    elements.lotsTab.addEventListener('click', () => switchTab('lots'));
    elements.statsTab.addEventListener('click', () => switchTab('stats'));
    
    // Filters
    elements.auctionSelect.addEventListener('change', handleAuctionChange);
    elements.applyFilters.addEventListener('click', applyFilters);
    elements.clearFilters.addEventListener('click', clearFilters);
    
    // Modal
    elements.closeModal.addEventListener('click', closeModal);
    elements.lotModal.addEventListener('click', (e) => {
        if (e.target === elements.lotModal) closeModal();
    });
    
    // Refresh button
    elements.refreshBtn.addEventListener('click', refreshData);
    
    // Export button
    elements.exportBtn.addEventListener('click', exportToCSV);
    
    // Year input - only show/hide clear button, no auto-search
    elements.yearInput.addEventListener('input', (e) => {
        // Show/hide clear button
        if (e.target.value) {
            elements.clearYearBtn.classList.remove('hidden');
        } else {
            elements.clearYearBtn.classList.add('hidden');
        }
    });
    
    // Clear year button
    elements.clearYearBtn.addEventListener('click', () => {
        elements.yearInput.value = '';
        elements.clearYearBtn.classList.add('hidden');
        // Don't auto-search, user needs to click "Apply Filters"
    });
    
    // Search input - no auto-search, user needs to click "Apply Filters"
    // (removed automatic search to be consistent with other filters)
}

function switchTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active', 'bg-blue-500', 'text-white');
        btn.classList.add('text-gray-600', 'hover:text-gray-800');
    });
    
    // Hide all sections
    document.querySelectorAll('.section').forEach(section => {
        section.classList.add('hidden');
    });
    
    // Show selected section
    switch(tabName) {
        case 'auctions':
            elements.auctionsTab.classList.add('active', 'bg-blue-500', 'text-white');
            elements.auctionsTab.classList.remove('text-gray-600', 'hover:text-gray-800');
            elements.auctionsSection.classList.remove('hidden');
            break;
        case 'lots':
            elements.lotsTab.classList.add('active', 'bg-blue-500', 'text-white');
            elements.lotsTab.classList.remove('text-gray-600', 'hover:text-gray-800');
            elements.lotsSection.classList.remove('hidden');
            break;
        case 'stats':
            elements.statsTab.classList.add('active', 'bg-blue-500', 'text-white');
            elements.statsTab.classList.remove('text-gray-600', 'hover:text-gray-800');
            elements.statsSection.classList.remove('hidden');
            break;
    }
}

async function loadAuctions() {
    try {
        elements.auctionsLoading.classList.remove('hidden');
        elements.auctionsGrid.classList.add('hidden');
        
        const auctions = await cachedFetch('/api/auctions');
        
        elements.auctionsGrid.innerHTML = '';
        
        if (auctions.length === 0) {
            elements.auctionsGrid.innerHTML = `
                <div class="col-span-full text-center py-8">
                    <i class="fas fa-inbox text-4xl text-gray-400 mb-4"></i>
                    <p class="text-gray-600">Аукционы не найдены</p>
                </div>
            `;
        } else {
            auctions.forEach(auction => {
                const auctionCard = createAuctionCard(auction);
                elements.auctionsGrid.appendChild(auctionCard);
            });
        }
        
        // Populate auction select
        elements.auctionSelect.innerHTML = '<option value="">Выберите аукцион</option>';
        auctions.forEach(auction => {
            const option = document.createElement('option');
            option.value = auction.auction_number;
            option.textContent = `Аукцион ${auction.auction_number} (${auction.lots_count} лотов)`;
            elements.auctionSelect.appendChild(option);
        });
        
        elements.auctionsLoading.classList.add('hidden');
        elements.auctionsGrid.classList.remove('hidden');
        elements.auctionsGrid.classList.add('fade-in');
        
    } catch (error) {
        console.error('Ошибка загрузки аукционов:', error);
        elements.auctionsLoading.innerHTML = `
            <div class="text-center py-8">
                <i class="fas fa-exclamation-triangle text-3xl text-red-500 mb-4"></i>
                <p class="text-red-600">Ошибка загрузки аукционов</p>
            </div>
        `;
    }
}

function createAuctionCard(auction) {
    const card = document.createElement('div');
    card.className = 'bg-white rounded-lg shadow-sm p-6 card-hover cursor-pointer';
    card.addEventListener('click', () => {
        currentAuction = auction.auction_number;
        elements.auctionSelect.value = auction.auction_number;
        switchTab('lots');
        loadLots(auction.auction_number, 1);
    });
    
    const startDate = auction.start_date ? new Date(auction.start_date).toLocaleDateString('ru-RU') : 'Не указана';
    const endDate = auction.end_date ? new Date(auction.end_date).toLocaleDateString('ru-RU') : 'Не указана';
    const totalValue = auction.total_value ? formatPrice(auction.total_value) : 'Не указана';
    const avgBid = auction.avg_bid ? formatPrice(auction.avg_bid) : 'Не указана';
    
    card.innerHTML = `
        <div class="flex items-center justify-between mb-4">
            <h3 class="text-lg font-semibold text-gray-800">Аукцион ${auction.auction_number}</h3>
            <span class="bg-blue-100 text-blue-800 px-2 py-1 rounded-full text-sm font-medium">
                ${auction.lots_count} лотов
            </span>
        </div>
        
        <div class="space-y-2 text-sm text-gray-600">
            <div class="flex justify-between">
                <span>Период:</span>
                <span>${startDate} - ${endDate}</span>
            </div>
            <div class="flex justify-between">
                <span>Общая стоимость:</span>
                <span class="font-medium text-green-600">${totalValue}</span>
            </div>
            <div class="flex justify-between">
                <span>Средняя цена:</span>
                <span class="font-medium">${avgBid}</span>
            </div>
            <div class="flex justify-between">
                <span>Макс. цена:</span>
                <span class="font-medium text-red-600">${formatPrice(auction.max_bid)}</span>
            </div>
        </div>
        
        <div class="mt-4 pt-4 border-t border-gray-200">
            <button class="w-full bg-blue-500 hover:bg-blue-600 text-white py-2 px-4 rounded-lg transition-colors">
                <i class="fas fa-eye mr-2"></i>Просмотреть лоты
            </button>
        </div>
    `;
    
    return card;
}

async function loadLots(auctionNumber, page = 1) {
    if (!auctionNumber) return;
    
    try {
        elements.lotsLoading.classList.remove('hidden');
        elements.lotsGrid.classList.add('hidden');
        elements.pagination.classList.add('hidden');
        
        const params = new URLSearchParams({
            page: page,
            limit: 20,
            ...currentFilters
        });
        
        console.log('🔍 API URL:', `/api/auctions/${auctionNumber}/lots?${params}`);
        console.log('🔍 Current filters:', currentFilters);
        
        const data = await cachedFetch(`/api/auctions/${auctionNumber}/lots?${params}`);
        
        elements.lotsGrid.innerHTML = '';
        
        if (data.lots.length === 0) {
            elements.lotsGrid.innerHTML = `
                <div class="col-span-full text-center py-8">
                    <i class="fas fa-inbox text-4xl text-gray-400 mb-4"></i>
                    <p class="text-gray-600">Лоты не найдены</p>
                </div>
            `;
        } else {
            data.lots.forEach(lot => {
                const lotCard = createLotCard(lot);
                elements.lotsGrid.appendChild(lotCard);
            });
            
            // Show pagination
            if (data.pagination.pages > 1) {
                showPagination(data.pagination);
            }
        }
        
        elements.lotsLoading.classList.add('hidden');
        elements.lotsGrid.classList.remove('hidden');
        elements.lotsGrid.classList.add('fade-in');
        
    } catch (error) {
        console.error('Ошибка загрузки лотов:', error);
        elements.lotsLoading.innerHTML = `
            <div class="text-center py-8">
                <i class="fas fa-exclamation-triangle text-3xl text-red-500 mb-4"></i>
                <p class="text-red-600">Ошибка загрузки лотов</p>
            </div>
        `;
    }
}

function createLotCard(lot) {
    const card = document.createElement('div');
    card.className = 'bg-white rounded-lg shadow-sm overflow-hidden card-hover cursor-pointer';
    card.addEventListener('click', () => showLotModal(lot.id));
    
        const imageUrl = lot.avers_image_url || createPlaceholderImage();
        const winningBid = lot.winning_bid ? formatPrice(lot.winning_bid) : 'Не продано';
        const winnerLogin = lot.winner_login || 'Не указан';
        const description = lot.coin_description ? lot.coin_description.substring(0, 100) + '...' : 'Описание отсутствует';
    
    card.innerHTML = `
        <div class="relative">
            <img src="${imageUrl}" alt="Лот ${lot.lot_number}" 
                 class="w-full h-48 object-cover bg-gray-100"
                 onerror="this.src='${createPlaceholderImage()}'"
                 loading="lazy">
            <div class="absolute top-2 left-2 bg-blue-500 text-white px-2 py-1 rounded text-sm font-medium">
                Лот ${lot.lot_number}
            </div>
            ${lot.metal ? `<div class="absolute top-2 right-2 bg-gray-800 text-white px-2 py-1 rounded text-xs">
                ${lot.metal}
            </div>` : ''}
        </div>
        
        <div class="p-4">
            <h3 class="font-semibold text-gray-800 mb-2 line-clamp-2">${description}</h3>
            
            <div class="space-y-1 text-sm text-gray-600 mb-3">
                ${lot.year ? `<div><i class="fas fa-calendar mr-1"></i>${lot.year}</div>` : ''}
                ${lot.condition ? `<div><i class="fas fa-star mr-1"></i>${lot.condition}</div>` : ''}
                ${lot.bids_count ? `<div><i class="fas fa-gavel mr-1"></i>${lot.bids_count} ставок</div>` : ''}
            </div>
            
            <div class="border-t pt-3">
                <div class="flex justify-between items-center">
                    <div>
                        <p class="text-sm text-gray-500">Победитель</p>
                        <p class="font-medium text-gray-800">${winnerLogin}</p>
                    </div>
                    <div class="text-right">
                        <p class="text-sm text-gray-500">Цена</p>
                        <p class="font-bold text-green-600">${winningBid}</p>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    return card;
}

function showPagination(pagination) {
    elements.pagination.innerHTML = '';
    elements.pagination.classList.remove('hidden');
    
    const { page, pages } = pagination;
    
    // Previous button
    if (page > 1) {
        const prevBtn = createPaginationButton('←', page - 1, false);
        elements.pagination.appendChild(prevBtn);
    }
    
    // Page numbers
    const startPage = Math.max(1, page - 2);
    const endPage = Math.min(pages, page + 2);
    
    for (let i = startPage; i <= endPage; i++) {
        const pageBtn = createPaginationButton(i.toString(), i, i === page);
        elements.pagination.appendChild(pageBtn);
    }
    
    // Next button
    if (page < pages) {
        const nextBtn = createPaginationButton('→', page + 1, false);
        elements.pagination.appendChild(nextBtn);
    }
}

function createPaginationButton(text, pageNum, isActive) {
    const button = document.createElement('button');
    button.className = `px-3 py-2 mx-1 rounded-lg transition-colors ${
        isActive 
            ? 'bg-blue-500 text-white' 
            : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-300'
    }`;
    button.textContent = text;
    button.addEventListener('click', () => {
        currentPage = pageNum;
        loadLots(currentAuction, pageNum);
    });
    return button;
}

async function showLotModal(lotId) {
    try {
        const response = await fetch(`/api/lots/${lotId}`);
        const lot = await response.json();
        
        elements.modalTitle.textContent = `Лот ${lot.lot_number}`;
        
        const imageUrl = lot.avers_image_url || '/placeholder-coin.png';
        const reversImageUrl = lot.revers_image_url || '/placeholder-coin.png';
        
        elements.modalContent.innerHTML = `
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div>
                    <h4 class="text-lg font-semibold mb-4">Изображения</h4>
                    <div class="space-y-4">
                        <div>
                            <p class="text-sm text-gray-600 mb-2">Аверс</p>
                            <img src="${imageUrl}" alt="Аверс" class="w-full h-64 object-cover rounded-lg border"
                                 onerror="this.src='/placeholder-coin.png'">
                        </div>
                        <div>
                            <p class="text-sm text-gray-600 mb-2">Реверс</p>
                            <img src="${reversImageUrl}" alt="Реверс" class="w-full h-64 object-cover rounded-lg border"
                                 onerror="this.src='/placeholder-coin.png'">
                        </div>
                    </div>
                </div>
                
                <div>
                    <h4 class="text-lg font-semibold mb-4">Информация о лоте</h4>
                    <div class="space-y-4">
                        <div>
                            <p class="text-sm text-gray-600">Описание</p>
                            <p class="text-gray-800">${lot.coin_description || 'Не указано'}</p>
                        </div>
                        
                        <div class="grid grid-cols-2 gap-4">
                            <div>
                                <p class="text-sm text-gray-600">Год</p>
                                <p class="text-gray-800">${lot.year || 'Не указан'}</p>
                            </div>
                            <div>
                                <p class="text-sm text-gray-600">Металл</p>
                                <p class="text-gray-800">${lot.metal || 'Не указан'}</p>
                            </div>
                            <div>
                                <p class="text-sm text-gray-600">Состояние</p>
                                <p class="text-gray-800">${lot.condition || 'Не указано'}</p>
                            </div>
                            <div>
                                <p class="text-sm text-gray-600">Буквы</p>
                                <p class="text-gray-800">${lot.letters || 'Не указаны'}</p>
                            </div>
                        </div>
                        
                        <div class="border-t pt-4">
                            <h5 class="font-semibold mb-3">Результаты торгов</h5>
                            <div class="space-y-2">
                                <div class="flex justify-between">
                                    <span class="text-gray-600">Победитель:</span>
                                    <span class="font-medium">${lot.winner_login || 'Не указан'}</span>
                                </div>
                                <div class="flex justify-between">
                                    <span class="text-gray-600">Цена:</span>
                                    <span class="font-bold text-green-600">${lot.winning_bid ? formatPrice(lot.winning_bid) : 'Не продано'}</span>
                                </div>
                                <div class="flex justify-between">
                                    <span class="text-gray-600">Количество ставок:</span>
                                    <span class="font-medium">${lot.bids_count || 'Не указано'}</span>
                                </div>
                                <div class="flex justify-between">
                                    <span class="text-gray-600">Статус:</span>
                                    <span class="font-medium">${lot.lot_status || 'Не указан'}</span>
                                </div>
                            </div>
                        </div>
                        
                        ${lot.source_url ? `
                            <div class="border-t pt-4">
                                <a href="${lot.source_url}" target="_blank" 
                                   class="inline-flex items-center text-blue-600 hover:text-blue-800">
                                    <i class="fas fa-external-link-alt mr-2"></i>
                                    Открыть на сайте аукциона
                                </a>
                            </div>
                        ` : ''}
                    </div>
                </div>
            </div>
        `;
        
        elements.lotModal.classList.remove('hidden');
        
    } catch (error) {
        console.error('Ошибка загрузки лота:', error);
        elements.modalContent.innerHTML = `
            <div class="text-center py-8">
                <i class="fas fa-exclamation-triangle text-3xl text-red-500 mb-4"></i>
                <p class="text-red-600">Ошибка загрузки данных лота</p>
            </div>
        `;
        elements.lotModal.classList.remove('hidden');
    }
}

function closeModal() {
    elements.lotModal.classList.add('hidden');
}

async function loadStatistics() {
    try {
        const [auctionsResponse, topLotsResponse] = await Promise.all([
            cachedFetch('/api/auctions'),
            cachedFetch('/api/top-lots?limit=5')
        ]);
        
        const auctions = auctionsResponse;
        const topLots = topLotsResponse;
        
        // Calculate totals
        const totalAuctions = auctions.length;
        const totalLots = auctions.reduce((sum, auction) => sum + parseInt(auction.lots_count), 0);
        const totalValue = auctions.reduce((sum, auction) => sum + (parseFloat(auction.total_value) || 0), 0);
        
        // Update statistics
        elements.totalAuctions.textContent = totalAuctions;
        elements.totalLots.textContent = totalLots;
        elements.totalValue.textContent = formatPrice(totalValue);
        
        // Load top lots
        elements.topLotsLoading.classList.add('hidden');
        elements.topLotsList.classList.remove('hidden');
        
        if (topLots.length === 0) {
            elements.topLotsList.innerHTML = '<p class="text-gray-600">Топ лоты не найдены</p>';
        } else {
            elements.topLotsList.innerHTML = topLots.map(lot => `
                <div class="flex items-center justify-between py-3 border-b border-gray-200 last:border-b-0">
                    <div class="flex items-center space-x-3">
                        <img src="${lot.avers_image_url || '/placeholder-coin.png'}" 
                             alt="Лот ${lot.lot_number}" 
                             class="w-12 h-12 object-cover rounded"
                             onerror="this.src='/placeholder-coin.png'">
                        <div>
                            <p class="font-medium text-gray-800">Лот ${lot.lot_number}</p>
                            <p class="text-sm text-gray-600">${lot.coin_description ? lot.coin_description.substring(0, 50) + '...' : 'Описание отсутствует'}</p>
                        </div>
                    </div>
                    <div class="text-right">
                        <p class="font-bold text-green-600">${formatPrice(lot.winning_bid)}</p>
                        <p class="text-sm text-gray-500">${lot.winner_login || 'Не указан'}</p>
                    </div>
                </div>
            `).join('');
        }
        
    } catch (error) {
        console.error('Ошибка загрузки статистики:', error);
    }
}

async function loadGlobalFilters() {
    try {
        const filters = await cachedFetch('/api/filters');
        console.log('Loaded filters:', filters); // Debug log
        
        // Populate global filters (for when no auction is selected)
        elements.metalFilter.innerHTML = '<option value="">Все металлы</option>';
        if (filters.metals && filters.metals.length > 0) {
            filters.metals.forEach(metal => {
                const option = document.createElement('option');
                option.value = metal;
                option.textContent = metal;
                elements.metalFilter.appendChild(option);
            });
        }
        
        elements.conditionFilter.innerHTML = '<option value="">Все состояния</option>';
        if (filters.conditions && filters.conditions.length > 0) {
            filters.conditions.forEach(condition => {
                const option = document.createElement('option');
                option.value = condition;
                option.textContent = condition;
                elements.conditionFilter.appendChild(option);
            });
        }
        
    } catch (error) {
        console.error('Ошибка загрузки глобальных фильтров:', error);
    }
}

function handleAuctionChange() {
    const selectedAuction = elements.auctionSelect.value;
    if (selectedAuction) {
        currentAuction = selectedAuction;
        currentPage = 1;
        loadLots(selectedAuction, 1);
        loadFilters(selectedAuction);
        
        // Enable export button when auction is selected
        elements.exportBtn.disabled = false;
    } else {
        // Disable export button when no auction is selected
        elements.exportBtn.disabled = true;
    }
}

async function exportToCSV() {
    if (!currentAuction) {
        alert('Выберите аукцион для экспорта');
        return;
    }
    
    try {
        elements.exportBtn.innerHTML = '<i class="fas fa-spinner loading mr-2"></i>Экспорт...';
        elements.exportBtn.disabled = true;
        
        const response = await fetch(`/api/export/csv?auctionNumber=${currentAuction}`);
        
        if (!response.ok) {
            throw new Error('Ошибка экспорта данных');
        }
        
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `wolmar-auction-${currentAuction}-${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        
    } catch (error) {
        console.error('Ошибка экспорта:', error);
        alert('Ошибка экспорта данных: ' + error.message);
    } finally {
        elements.exportBtn.innerHTML = '<i class="fas fa-download mr-2"></i>Экспорт CSV';
        elements.exportBtn.disabled = false;
    }
}

async function loadFilters(auctionNumber) {
    try {
        const filters = await cachedFetch(`/api/filters?auctionNumber=${auctionNumber}`);
        console.log('Loaded auction filters:', filters); // Debug log
        
        // Update metal filter
        elements.metalFilter.innerHTML = '<option value="">Все металлы</option>';
        if (filters.metals && filters.metals.length > 0) {
            filters.metals.forEach(metal => {
                const option = document.createElement('option');
                option.value = metal;
                option.textContent = metal;
                elements.metalFilter.appendChild(option);
            });
        }
        
        // Update condition filter
        elements.conditionFilter.innerHTML = '<option value="">Все состояния</option>';
        if (filters.conditions && filters.conditions.length > 0) {
            filters.conditions.forEach(condition => {
                const option = document.createElement('option');
                option.value = condition;
                option.textContent = condition;
                elements.conditionFilter.appendChild(option);
            });
        }
        
    } catch (error) {
        console.error('Ошибка загрузки фильтров:', error);
    }
}

function applyFilters() {
    currentFilters = {
        search: elements.searchInput.value,
        metal: elements.metalFilter.value,
        condition: elements.conditionFilter.value,
        year: elements.yearInput.value,
        minPrice: elements.minPrice.value,
        maxPrice: elements.maxPrice.value
    };
    
    console.log('🔍 Applying filters:', currentFilters);
    
    // Remove empty filters
    Object.keys(currentFilters).forEach(key => {
        if (!currentFilters[key]) {
            delete currentFilters[key];
        }
    });
    
    console.log('🔍 Final filters after cleanup:', currentFilters);
    
    // Clear cache to ensure fresh data
    apiCache.clear();
    
    currentPage = 1;
    if (currentAuction) {
        console.log('🔍 Loading lots for auction:', currentAuction);
        loadLots(currentAuction, 1);
    }
}

function clearFilters() {
    elements.searchInput.value = '';
    elements.metalFilter.value = '';
    elements.conditionFilter.value = '';
    elements.yearInput.value = '';
    elements.clearYearBtn.classList.add('hidden');
    elements.minPrice.value = '';
    elements.maxPrice.value = '';
    
    currentFilters = {};
    currentPage = 1;
    
    if (currentAuction) {
        loadLots(currentAuction, 1);
    }
}

async function refreshData() {
    elements.refreshBtn.innerHTML = '<i class="fas fa-spinner loading mr-2"></i>Обновление...';
    elements.refreshBtn.disabled = true;
    
    try {
        // Clear cache before refreshing
        apiCache.clear();
        console.log('Cache cleared');
        
        await Promise.all([
            loadAuctions(),
            loadStatistics()
        ]);
        
        if (currentAuction) {
            await loadLots(currentAuction, currentPage);
        }
        
    } catch (error) {
        console.error('Ошибка обновления данных:', error);
    } finally {
        elements.refreshBtn.innerHTML = '<i class="fas fa-sync-alt mr-2"></i>Обновить';
        elements.refreshBtn.disabled = false;
    }
}

function formatPrice(price) {
    if (!price) return 'Не указана';
    return new Intl.NumberFormat('ru-RU', {
        style: 'currency',
        currency: 'RUB',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(price);
}

// Utility function to create placeholder image
function createPlaceholderImage() {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 200;
    const ctx = canvas.getContext('2d');
    
    ctx.fillStyle = '#f3f4f6';
    ctx.fillRect(0, 0, 200, 200);
    
    ctx.fillStyle = '#9ca3af';
    ctx.font = '16px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Изображение', 100, 100);
    ctx.fillText('отсутствует', 100, 120);
    
    return canvas.toDataURL();
}

// Set placeholder image for missing images
document.addEventListener('DOMContentLoaded', function() {
    const placeholderDataUrl = createPlaceholderImage();
    
    // Create a style element to set the placeholder
    const style = document.createElement('style');
    style.textContent = `
        img[src="/placeholder-coin.png"] {
            background-image: url('${placeholderDataUrl}');
            background-size: cover;
            background-position: center;
        }
    `;
    document.head.appendChild(style);
});

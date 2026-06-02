// Global state
let currentAuction = null;
let currentPage = 1;
let currentFilters = {};


// Global search state
let globalSearchFilters = {};
let globalSearchPage = 1;
let globalSearchResults = null;

// Current auction state
let currentAuctionPage = 1;
let currentAuctionResults = null;

// Cache for API requests
const apiCache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// DOM elements
const elements = {
    // Tabs
    auctionsTab: document.getElementById('auctionsTab'),
    lotsTab: document.getElementById('lotsTab'),
    statsTab: document.getElementById('statsTab'),
    catalogTab: document.getElementById('catalogTab'),
    collectionTab: document.getElementById('collectionTab'),
    
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
    categoryFilter: document.getElementById('categoryFilter'),
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
    pagination: document.getElementById('pagination'),
    
    // Winners
    winnersTab: document.getElementById('winnersTab'),
    winnersSection: document.getElementById('winnersSection'),
    
    // Users
    usersTab: document.getElementById('usersTab'),
    usersSection: document.getElementById('usersSection'),
    usersTableBody: document.getElementById('usersTableBody'),
    usersSearch: document.getElementById('usersSearch'),
    usersStatusFilter: document.getElementById('usersStatusFilter'),
    usersRiskFilter: document.getElementById('usersRiskFilter'),
    usersRatingFilter: document.getElementById('usersRatingFilter'),
    usersPagination: document.getElementById('usersPagination'),
    userProfileModal: document.getElementById('userProfileModal'),
    userProfileContent: document.getElementById('userProfileContent'),
    userProfileLoading: document.getElementById('userProfileLoading'),
    closeUserProfileModal: document.getElementById('closeUserProfileModal'),
    winnerSearch: document.getElementById('winnerSearch'),
    searchWinner: document.getElementById('searchWinner'),
    winnerStats: document.getElementById('winnerStats'),
    winnerLogin: document.getElementById('winnerLogin'),
    winnerTotalLots: document.getElementById('winnerTotalLots'),
    winnerTotalAmount: document.getElementById('winnerTotalAmount'),
    winnerAuctions: document.getElementById('winnerAuctions'),
    auctionsList: document.getElementById('auctionsList'),
    winnerLots: document.getElementById('winnerLots'),
    lotsList: document.getElementById('lotsList'),
    winnersLoading: document.getElementById('winnersLoading'),
    winnersError: document.getElementById('winnersError'),
    
    // Global Search
    searchTab: document.getElementById('searchTab'),
    searchSection: document.getElementById('searchSection'),
    globalSearchInput: document.getElementById('globalSearchInput'),
    globalMetalFilter: document.getElementById('globalMetalFilter'),
    globalConditionFilter: document.getElementById('globalConditionFilter'),
    globalCategoryFilter: document.getElementById('globalCategoryFilter'),
    globalYearInput: document.getElementById('globalYearInput'),
    clearGlobalYearBtn: document.getElementById('clearGlobalYearBtn'),
    globalMinPrice: document.getElementById('globalMinPrice'),
    globalMaxPrice: document.getElementById('globalMaxPrice'),
    applyGlobalFilters: document.getElementById('applyGlobalFilters'),
    clearGlobalFilters: document.getElementById('clearGlobalFilters'),
    exportGlobalResults: document.getElementById('exportGlobalResults'),
    globalLotsList: document.getElementById('globalLotsList'),
    globalPagination: document.getElementById('globalPagination'),
    globalResultsCount: document.getElementById('globalResultsCount'),
    globalSearchLoading: document.getElementById('globalSearchLoading'),
    globalSearchError: document.getElementById('globalSearchError'),
    
    // Current Auction
    currentAuctionTab: document.getElementById('currentAuctionTab'),
    currentAuctionSection: document.getElementById('currentAuctionSection'),
    currentAuctionLotsList: document.getElementById('currentAuctionLotsList'),
    currentAuctionPagination: document.getElementById('currentAuctionPagination'),
    currentAuctionResultsCount: document.getElementById('currentAuctionResultsCount'),
    currentAuctionLoading: document.getElementById('currentAuctionLoading'),
    currentAuctionError: document.getElementById('currentAuctionError'),
    
    // Watchlist
    watchlistTab: document.getElementById('watchlistTab')
};

// Initialize app
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
});

async function initializeApp() {
    setupEventListeners();
    updateWatchlistCount(); // Initialize watchlist count
    await loadAuctions();
    await loadStatistics();
    await loadGlobalFilters();
}

// Cached API request function
async function cachedFetch(url, options = {}) {
    const cacheKey = `${url}_${JSON.stringify(options)}`;
    const cached = apiCache.get(cacheKey);
    
    // Don't cache filtered lot requests (requests with search/filter parameters)
    const hasFilters = url.includes('?') && (url.includes('search=') || url.includes('metal=') || url.includes('condition=') || url.includes('category=') || url.includes('year=') || url.includes('minPrice=') || url.includes('maxPrice='));
    
    // But allow caching for filter data requests
    const isFilterDataRequest = url.includes('/api/filters');
    
    if ((!hasFilters || isFilterDataRequest) && cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        console.log('Using cached data for:', url);
        return cached.data;
    }
    
    try {
        const response = await fetch(url, options);
        const data = await response.json();
        
        // Cache non-filtered requests and filter data requests
        if (!hasFilters || isFilterDataRequest) {
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
    if (elements.auctionsTab) elements.auctionsTab.addEventListener('click', () => switchTab('auctions'));
    if (elements.lotsTab) elements.lotsTab.addEventListener('click', () => switchTab('lots'));
    if (elements.winnersTab) elements.winnersTab.addEventListener('click', () => switchTab('winners'));
    if (elements.usersTab) elements.usersTab.addEventListener('click', () => switchTab('users'));
    if (elements.searchTab) elements.searchTab.addEventListener('click', () => switchTab('search'));
    if (elements.currentAuctionTab) elements.currentAuctionTab.addEventListener('click', () => switchTab('currentAuction'));
    if (elements.watchlistTab) {
        elements.watchlistTab.addEventListener('click', () => {
            console.log('Watchlist tab clicked');
            switchTab('watchlist');
        });
    }
    if (elements.statsTab) elements.statsTab.addEventListener('click', () => switchTab('stats'));
    
    // Catalog and Collection tabs
    if (elements.catalogTab) {
        elements.catalogTab.addEventListener('click', () => {
            window.location.href = '/catalog';
        });
    }
    if (elements.collectionTab) {
        elements.collectionTab.addEventListener('click', () => {
            window.location.href = '/collection';
        });
    }
    
    // Filters
    if (elements.auctionSelect) elements.auctionSelect.addEventListener('change', handleAuctionChange);
    if (elements.applyFilters) elements.applyFilters.addEventListener('click', applyFilters);
    if (elements.clearFilters) elements.clearFilters.addEventListener('click', clearFilters);
    
    // Watchlist
    const clearWatchlistBtn = document.getElementById('clearWatchlist');
    if (clearWatchlistBtn) clearWatchlistBtn.addEventListener('click', clearWatchlist);
    
    // Users
    if (elements.usersSearch) {
        elements.usersSearch.addEventListener('input', debounce(() => loadUsers(), 500));
    }
    if (elements.usersStatusFilter) {
        elements.usersStatusFilter.addEventListener('change', () => loadUsers());
    }
    if (elements.usersRiskFilter) {
        elements.usersRiskFilter.addEventListener('change', () => loadUsers());
    }
    if (elements.usersRatingFilter) {
        elements.usersRatingFilter.addEventListener('change', () => loadUsers());
    }
    if (elements.closeUserProfileModal) {
        elements.closeUserProfileModal.addEventListener('click', () => {
            elements.userProfileModal.classList.add('hidden');
        });
    }
    if (elements.userProfileModal) {
        elements.userProfileModal.addEventListener('click', (e) => {
            if (e.target === elements.userProfileModal) {
                elements.userProfileModal.classList.add('hidden');
            }
        });
    }
    
    // Modal
    if (elements.closeModal) elements.closeModal.addEventListener('click', closeModal);
    if (elements.lotModal) {
        elements.lotModal.addEventListener('click', (e) => {
            if (e.target === elements.lotModal) closeModal();
        });
    }
    
    // Refresh button
    if (elements.refreshBtn) elements.refreshBtn.addEventListener('click', refreshData);
    
    // Export button
    if (elements.exportBtn) elements.exportBtn.addEventListener('click', exportToCSV);
    
    // Year input - only show/hide clear button, no auto-search
    if (elements.yearInput) {
        elements.yearInput.addEventListener('input', (e) => {
            // Show/hide clear button
            if (e.target.value) {
                if (elements.clearYearBtn) elements.clearYearBtn.classList.remove('hidden');
            } else {
                if (elements.clearYearBtn) elements.clearYearBtn.classList.add('hidden');
            }
        });
    }
    
    // Clear year button
    if (elements.clearYearBtn) {
        elements.clearYearBtn.addEventListener('click', () => {
            if (elements.yearInput) elements.yearInput.value = '';
            elements.clearYearBtn.classList.add('hidden');
            // Don't auto-search, user needs to click "Apply Filters"
        });
    }
    
    // Search input - no auto-search, user needs to click "Apply Filters"
    // (removed automatic search to be consistent with other filters)
    
    // Winner search
    if (elements.searchWinner) elements.searchWinner.addEventListener('click', searchWinner);
    if (elements.winnerSearch) {
        elements.winnerSearch.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                searchWinner();
            }
        });
    }
    
    // Global Search
    if (elements.applyGlobalFilters) elements.applyGlobalFilters.addEventListener('click', applyGlobalFilters);
    if (elements.clearGlobalFilters) elements.clearGlobalFilters.addEventListener('click', clearGlobalFilters);
    if (elements.exportGlobalResults) elements.exportGlobalResults.addEventListener('click', exportGlobalResults);
    if (elements.globalSearchInput) {
        elements.globalSearchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                applyGlobalFilters();
            }
        });
    }
    if (elements.globalYearInput) {
        elements.globalYearInput.addEventListener('input', (e) => {
            if (elements.clearGlobalYearBtn) {
                elements.clearGlobalYearBtn.classList.toggle('hidden', !e.target.value);
            }
        });
    }
    if (elements.clearGlobalYearBtn) {
        elements.clearGlobalYearBtn.addEventListener('click', () => {
            if (elements.globalYearInput) elements.globalYearInput.value = '';
            elements.clearGlobalYearBtn.classList.add('hidden');
        });
    }
    
    // Auction filters
    const applyAuctionFiltersBtn = document.getElementById('apply-auction-filters');
    if (applyAuctionFiltersBtn) applyAuctionFiltersBtn.addEventListener('click', applyAuctionFilters);
    const clearAuctionFiltersBtn = document.getElementById('clear-auction-filters');
    if (clearAuctionFiltersBtn) clearAuctionFiltersBtn.addEventListener('click', clearAuctionFilters);
    
    // Добавляем обработчики для всех фильтров аукциона
    const auctionFilters = [
        'auction-country-filter',
        'auction-metal-filter', 
        'auction-rarity-filter',
        'auction-condition-filter',
        'auction-category-filter',
        'auction-mint-filter',
        'auction-year-from-filter',
        'auction-year-to-filter',
        'auction-search-filter',
        'auction-price-from-filter',
        'auction-price-to-filter',
        'auction-sort-filter'
    ];
    
    auctionFilters.forEach(filterId => {
        const element = document.getElementById(filterId);
        if (element) {
            element.addEventListener('change', applyAuctionFilters);
            // Для текстовых полей также добавляем обработчик на ввод
            if (element.type === 'text' || element.type === 'number') {
                element.addEventListener('input', debounce(applyAuctionFilters, 500));
            }
        }
    });
}

// Функция debounce для задержки выполнения
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
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
            loadAuctionFilterOptions(); // Загружаем опции фильтров
            break;
        case 'winners':
            elements.winnersTab.classList.add('active', 'bg-blue-500', 'text-white');
            elements.winnersTab.classList.remove('text-gray-600', 'hover:text-gray-800');
            elements.winnersSection.classList.remove('hidden');
            break;
        case 'users':
            console.log('Переключение на вкладку Пользователи');
            if (!elements.usersTab) {
                console.error('elements.usersTab не найден');
                return;
            }
            if (!elements.usersSection) {
                console.error('elements.usersSection не найден');
                return;
            }
            elements.usersTab.classList.add('active', 'bg-blue-500', 'text-white');
            elements.usersTab.classList.remove('text-gray-600', 'hover:text-gray-800');
            elements.usersSection.classList.remove('hidden');
            console.log('Загрузка пользователей...');
            loadUsers();
            break;
        case 'search':
            elements.searchTab.classList.add('active', 'bg-blue-500', 'text-white');
            elements.searchTab.classList.remove('text-gray-600', 'hover:text-gray-800');
            elements.searchSection.classList.remove('hidden');
            loadGlobalFilters();
            break;
        case 'currentAuction':
            elements.currentAuctionTab.classList.add('active', 'bg-blue-500', 'text-white');
            elements.currentAuctionTab.classList.remove('text-gray-600', 'hover:text-gray-800');
            elements.currentAuctionSection.classList.remove('hidden');
            loadCurrentAuction();
            loadAuctionFilterOptions(); // Загружаем опции фильтров
            // Temporarily disable analytics update due to API issues
            // updateAuctionAnalytics();
            break;
        case 'watchlist':
            console.log('Switching to watchlist tab');
            elements.watchlistTab.classList.add('active', 'bg-blue-500', 'text-white');
            elements.watchlistTab.classList.remove('text-gray-600', 'hover:text-gray-800');
            document.getElementById('watchlistSection').classList.remove('hidden');
            loadWatchlist();
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
    // Обработчик клика по карточке (для аукционов без категорий)
    const handleCardClick = (e) => {
        // Если клик по категории, не переходим на страницу лотов
        if (e.target.closest('.category-link')) {
            return;
        }
        
        currentAuction = auction.auction_number;
        elements.auctionSelect.value = auction.auction_number;
        switchTab('lots');
        
        // Очищаем фильтры при обычном просмотре лотов
        currentFilters = {};
        console.log('🔍 Обычный просмотр лотов - очищаем фильтры:', currentFilters);
        
        loadLots(auction.auction_number, 1);
    };
    
    card.addEventListener('click', handleCardClick);
    
    const startDate = auction.start_date ? new Date(auction.start_date).toLocaleDateString('ru-RU') : 'Не указана';
    const endDate = auction.end_date ? new Date(auction.end_date).toLocaleDateString('ru-RU') : 'Не указана';
    const totalValue = auction.total_value ? formatPrice(auction.total_value) : 'Не указана';
    const avgBid = auction.avg_bid ? formatPrice(auction.avg_bid) : 'Не указана';
    
    // Генерируем HTML для категорий
    let categoriesHtml = '';
    if (auction.categories && auction.categories.length > 0) {
        categoriesHtml = `
            <div class="mt-3 pt-3 border-t border-gray-200">
                <div class="flex items-center justify-between mb-2">
                    <span class="text-sm font-medium text-gray-700">Категории:</span>
                    <span class="text-xs text-gray-500">${auction.categories_count} категорий</span>
                </div>
                <div class="flex flex-wrap gap-1">
                    ${auction.categories.map(cat => `
                        <span class="category-link bg-gray-100 hover:bg-blue-100 text-gray-700 hover:text-blue-700 px-2 py-1 rounded text-xs cursor-pointer transition-colors"
                              onclick="console.log('🔍 Клик по категории:', '${cat.category}'); filterByCategory(${auction.auction_number}, '${cat.category.replace(/'/g, "\\'")}')"
                              title="Показать ${cat.lots_count} лотов в категории '${cat.category}'">
                            ${cat.category} (${cat.lots_count})
                        </span>
                    `).join('')}
                </div>
            </div>
        `;
    }
    
    card.innerHTML = `
        <div class="flex items-center justify-between mb-4">
            <div>
                <h3 class="text-lg font-semibold text-gray-800">Аукцион ${auction.auction_number}</h3>
                <p class="text-sm text-gray-500">ID для парсинга: ${auction.parsing_number || auction.auction_number}</p>
            </div>
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
                <span class="font-medium text-red-600">${formatPrice(auction.max_price)}</span>
            </div>
        </div>
        
        ${categoriesHtml}
        
        <div class="mt-4 pt-4 border-t border-gray-200">
            <button class="w-full bg-blue-500 hover:bg-blue-600 text-white py-2 px-4 rounded-lg transition-colors">
                <i class="fas fa-eye mr-2"></i>Просмотреть лоты
            </button>
        </div>
    `;
    
    return card;
}

// Функция для фильтрации лотов по категории из карточки аукциона
function filterByCategory(auctionNumber, category) {
    console.log(`🔍 Фильтрация по категории: ${category} в аукционе ${auctionNumber}`);
    
    // Переключаемся на вкладку "Лоты"
    switchTab('lots');
    
    // Устанавливаем текущий аукцион
    currentAuction = auctionNumber;
    elements.auctionSelect.value = auctionNumber;
    
    // Устанавливаем фильтр по категории
    const categoryFilter = document.getElementById('auction-category-filter');
    if (categoryFilter) {
        categoryFilter.value = category;
    }
    
    // Обновляем currentFilters с новым фильтром по категории
    currentFilters = {
        ...currentFilters,
        category: category
    };
    
    // Очищаем другие фильтры, которые могут мешать
    currentFilters = {
        category: category
    };
    
    console.log('📋 Обновленные фильтры:', currentFilters);
    
    // Загружаем лоты с фильтром
    loadLots(auctionNumber, 1);
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
        
        console.log(`🔍 Загружаем лоты для аукциона ${auctionNumber}, страница ${page}`);
        console.log('📋 Параметры запроса:', Object.fromEntries(params));
        
        const data = await cachedFetch(`/api/auctions/${auctionNumber}/lots?${params}`);
        
        console.log(`📊 Получены данные лотов:`, data);
        if (data.lots && data.lots.length > 0) {
            console.log(`🖼️ Первый лот - avers_image_url:`, data.lots[0].avers_image_url);
            console.log(`🖼️ Первый лот - revers_image_url:`, data.lots[0].revers_image_url);
        }
        
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
    const description = lot.coin_description ? lot.coin_description.substring(0, 100) + '...' : 'Описание отсутствует';
    
    // Диагностика изображений
    if (lot.avers_image_url) {
        console.log(`🖼️ Лот ${lot.lot_number}: avers_image_url = "${lot.avers_image_url}"`);
    } else {
        console.log(`🖼️ Лот ${lot.lot_number}: avers_image_url отсутствует, используем placeholder`);
    }
    
    card.innerHTML = `
        <div class="relative">
            <img src="${imageUrl}" alt="Лот ${lot.lot_number}" 
                 class="w-full h-48 object-cover bg-gray-100"
                 onerror="console.log('❌ Ошибка загрузки изображения для лота ${lot.lot_number}:', this.src); this.src='${createPlaceholderImage()}'"
                 onload="console.log('✅ Изображение загружено для лота ${lot.lot_number}:', this.src)"
                 loading="lazy">
            <div class="absolute top-2 left-2 bg-blue-500 text-white px-2 py-1 rounded text-sm font-medium">
                Лот ${lot.lot_number} (Аукцион ${lot.auction_number})
            </div>
            ${lot.metal ? `<div class="absolute top-2 right-2 bg-gray-800 text-white px-2 py-1 rounded text-xs">
                ${lot.metal}
            </div>` : ''}
        </div>
        
        <div class="p-4">
            <h3 class="font-semibold text-gray-800 mb-2 line-clamp-2">${description}</h3>
            
            <div class="space-y-1 text-sm text-gray-600 mb-3">
                ${lot.category ? `<div><i class="fas fa-tag mr-1"></i>${getCategoryDisplayName(lot.category)}</div>` : ''}
                ${lot.year ? `<div><i class="fas fa-calendar mr-1"></i>${lot.year}</div>` : ''}
                ${lot.condition ? `<div><i class="fas fa-star mr-1"></i>${lot.condition}</div>` : ''}
                ${lot.weight ? `<div><i class="fas fa-weight mr-1"></i>${lot.weight}г</div>` : ''}
                ${lot.bids_count ? `<div class="cursor-pointer hover:text-blue-600 transition-colors" onclick="showBidsModal(${lot.id})"><i class="fas fa-gavel mr-1"></i>${lot.bids_count} ставок</div>` : ''}
            </div>
            
            <div class="border-t pt-3">
                <div class="flex justify-between items-center">
                    <div>
                        <p class="text-sm text-gray-500">Победитель</p>
                        <div id="winner-${lot.id}" class="font-medium text-gray-800">
                            <!-- Победитель будет загружен асинхронно с рейтингом -->
                        </div>
                    </div>
                    <div class="text-right">
                        <p class="text-sm text-gray-500">Цена</p>
                        <p class="font-bold text-green-600">${winningBid}</p>
                    </div>
                </div>
                <div class="flex justify-between items-center mt-3">
                    <div id="metal-info-${lot.id}">
                        <!-- Информация о металле будет загружена асинхронно -->
                    </div>
                    <button onclick="event.stopPropagation(); addToWatchlist(${lot.id})" 
                            class="bg-yellow-500 hover:bg-yellow-600 text-white px-2 py-1 rounded-lg transition-colors text-sm"
                            title="Добавить в избранное">
                        <i class="fas fa-star"></i>
                    </button>
                </div>
            </div>
        </div>
    `;
    
    // Add clickable winner link with rating
    const winnerContainer = card.querySelector(`#winner-${lot.id}`);
    if (lot.winner_login) {
        const winnerLink = createWinnerLink(lot.winner_login);
        winnerContainer.appendChild(winnerLink);
    } else {
        winnerContainer.textContent = 'Не указан';
    }
    
    // Загружаем информацию о металле асинхронно
    if (lot.winning_bid && lot.metal && lot.weight) {
        loadMetalInfo(lot.id).then(metalInfo => {
            const metalInfoContainer = card.querySelector(`#metal-info-${lot.id}`);
            if (metalInfoContainer && metalInfo) {
                metalInfoContainer.innerHTML = createMetalInfoHTML(metalInfo);
            }
        });
    }
    
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
        const response = await fetch(`/api/lot-details/${lotId}`);
        const lot = await response.json();
        
        elements.modalTitle.innerHTML = `
            <i class="fas fa-coins text-yellow-500 mr-2"></i>
            Лот ${lot.lot_number} (Аукцион ${lot.auction_number})
        `;
        
        const imageUrl = lot.avers_image_url || '/placeholder-coin.png';
        const reversImageUrl = lot.revers_image_url || '/placeholder-coin.png';
        
        elements.modalContent.innerHTML = `
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div>
                    <h4 class="text-lg font-semibold mb-4">
                        <i class="fas fa-images text-blue-500 mr-2"></i>Изображения
                    </h4>
                    <div class="space-y-4">
                        ${lot.avers_image_url ? `
                            <div>
                                <p class="text-sm text-gray-600 mb-2">Аверс</p>
                                <img src="${imageUrl}" alt="Аверс" class="w-full h-64 object-cover rounded-lg border shadow-sm"
                                     onerror="this.src='/placeholder-coin.png'">
                            </div>
                        ` : ''}
                        ${lot.revers_image_url ? `
                            <div>
                                <p class="text-sm text-gray-600 mb-2">Реверс</p>
                                <img src="${reversImageUrl}" alt="Реверс" class="w-full h-64 object-cover rounded-lg border shadow-sm"
                                     onerror="this.src='/placeholder-coin.png'">
                            </div>
                        ` : ''}
                    </div>
                </div>
                
                <div>
                    <h4 class="text-lg font-semibold mb-4">
                        <i class="fas fa-info-circle text-green-500 mr-2"></i>Информация о лоте
                    </h4>
                    <div class="space-y-4">
                        <div class="bg-gray-50 rounded-lg p-4">
                            <h5 class="font-medium text-gray-800 mb-2">Описание</h5>
                            <p class="text-sm text-gray-700 leading-relaxed">${lot.coin_description || 'Описание не указано'}</p>
                        </div>
                        
                        <div class="grid grid-cols-2 gap-3">
                            <div class="bg-blue-50 rounded-lg p-3">
                                <p class="text-sm text-gray-600">Год</p>
                                <p class="font-medium text-blue-800">${lot.year || 'Не указан'}</p>
                            </div>
                            <div class="bg-green-50 rounded-lg p-3">
                                <p class="text-sm text-gray-600">Металл</p>
                                <p class="font-medium text-green-800">${lot.metal || 'Не указан'}</p>
                            </div>
                            <div class="bg-yellow-50 rounded-lg p-3">
                                <p class="text-sm text-gray-600">Сохранность</p>
                                <p class="font-medium text-yellow-800">${lot.condition || 'Не указана'}</p>
                            </div>
                            <div class="bg-purple-50 rounded-lg p-3">
                                <p class="text-sm text-gray-600">Буквы</p>
                                <p class="font-medium text-purple-800">${lot.letters || 'Не указаны'}</p>
                            </div>
                            ${lot.weight ? `
                                <div class="bg-orange-50 rounded-lg p-3">
                                    <p class="text-sm text-gray-600">Вес</p>
                                    <p class="font-medium text-orange-800">${lot.weight}г</p>
                                </div>
                            ` : ''}
                        </div>
                        
                        <div class="bg-green-50 rounded-lg p-4">
                            <h5 class="font-medium text-gray-800 mb-3">
                                <i class="fas fa-gavel text-green-600 mr-2"></i>Результаты торгов
                            </h5>
                            <div class="space-y-2">
                                <div class="flex justify-between">
                                    <span class="text-sm text-gray-600">Победитель:</span>
                                    <div id="modal-winner-${lot.id}" class="font-medium text-green-800"></div>
                                </div>
                                <div class="flex justify-between">
                                    <span class="text-sm text-gray-600">Цена:</span>
                                    <span class="font-bold text-green-600 text-lg">${lot.winning_bid ? formatPrice(lot.winning_bid) : 'Не продано'}</span>
                                </div>
                                <div class="flex justify-between">
                                    <span class="text-sm text-gray-600">Количество ставок:</span>
                                    <span class="font-medium text-gray-800 cursor-pointer hover:text-blue-600 transition-colors" onclick="showBidsModal(${lot.id})">${lot.bids_count || 0}</span>
                                </div>
                                <div class="flex justify-between">
                                    <span class="text-sm text-gray-600">Статус:</span>
                                    <span class="font-medium text-gray-800">${lot.lot_status || 'Не указан'}</span>
                                </div>
                                <div class="flex justify-between">
                                    <span class="text-sm text-gray-600">Дата окончания:</span>
                                    <span class="font-medium text-gray-800">${lot.auction_end_date ? new Date(lot.auction_end_date).toLocaleDateString('ru-RU') : 'Не указана'}</span>
                                </div>
                            </div>
                            <div id="modal-metal-info-${lot.id}" class="mt-4">
                                <!-- Информация о металле будет загружена асинхронно -->
                            </div>
                        </div>
                        
                        ${lot.source_url ? `
                            <div class="border-t pt-4">
                                <a href="${lot.source_url}" target="_blank" 
                                   class="inline-flex items-center text-blue-600 hover:text-blue-800 transition-colors">
                                    <i class="fas fa-external-link-alt mr-2"></i>
                                    Открыть на сайте аукциона
                                </a>
                            </div>
                        ` : ''}
                    </div>
                </div>
            </div>
        `;
        
        // Add clickable winner link in modal
        const modalWinnerContainer = document.querySelector(`#modal-winner-${lot.id}`);
        if (modalWinnerContainer && lot.winner_login) {
            const winnerLink = createWinnerLink(lot.winner_login);
            modalWinnerContainer.appendChild(winnerLink);
        } else if (modalWinnerContainer) {
            modalWinnerContainer.textContent = 'Не указан';
        }
        
        // Загружаем информацию о металле асинхронно
        if (lot.winning_bid && lot.metal && lot.weight) {
            loadMetalInfo(lot.id).then(metalInfo => {
                const modalMetalInfoContainer = document.querySelector(`#modal-metal-info-${lot.id}`);
                if (modalMetalInfoContainer && metalInfo) {
                    modalMetalInfoContainer.innerHTML = createMetalInfoHTML(metalInfo);
                }
            });
        }
        
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
        const [statisticsResponse, topLotsResponse] = await Promise.all([
            cachedFetch('/api/statistics'),
            cachedFetch('/api/top-lots?limit=5')
        ]);
        
        const stats = statisticsResponse;
        const topLots = topLotsResponse;
        
        // Update statistics
        elements.totalAuctions.textContent = stats.total_auctions || 0;
        elements.totalLots.textContent = stats.total_lots || 0;
        elements.totalValue.textContent = formatPrice(stats.total_value || 0);
        elements.totalBidders.textContent = stats.unique_participants || 0;
        
        // Load top lots
        elements.topLotsLoading.classList.add('hidden');
        elements.topLotsList.classList.remove('hidden');
        
        if (topLots.length === 0) {
            elements.topLotsList.innerHTML = '<p class="text-gray-600">Топ лоты не найдены</p>';
        } else {
            elements.topLotsList.innerHTML = '';
            topLots.forEach(lot => {
                const lotElement = document.createElement('div');
                lotElement.className = 'flex items-center justify-between py-3 border-b border-gray-200 last:border-b-0';
                
                lotElement.innerHTML = `
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
                        <div id="stats-winner-${lot.id}" class="text-sm text-gray-500"></div>
                    </div>
                `;
                
                // Add clickable winner link
                const winnerContainer = lotElement.querySelector(`#stats-winner-${lot.id}`);
                if (lot.winner_login) {
                    const winnerLink = createWinnerLink(lot.winner_login);
                    winnerContainer.appendChild(winnerLink);
                } else {
                    winnerContainer.textContent = 'Не указан';
                }
                
                elements.topLotsList.appendChild(lotElement);
            });
        }
        
    } catch (error) {
        console.error('Ошибка загрузки статистики:', error);
    }
}

async function loadGlobalFilters() {
    try {
        console.log('🔍 Загружаем глобальные фильтры...');
        const filters = await cachedFetch('/api/filters');
        console.log('📊 Получены фильтры:', filters);
        
        // Populate global filters (for Search Lots page)
        elements.globalMetalFilter.innerHTML = '<option value="">Все металлы</option>';
        if (filters.metals && filters.metals.length > 0) {
            console.log('🔧 Заполняем металлы:', filters.metals);
            filters.metals.forEach(metal => {
                const option = document.createElement('option');
                // Check if metal is an object with 'metal' property or just a string
                const metalValue = typeof metal === 'object' ? metal.metal : metal;
                const metalText = typeof metal === 'object' ? `${metal.metal} (${metal.count})` : metal;
                option.value = metalValue;
                option.textContent = metalText;
                elements.globalMetalFilter.appendChild(option);
            });
        } else {
            console.log('⚠️ Металлы не найдены или пусты');
        }
        
        elements.globalConditionFilter.innerHTML = '<option value="">Все состояния</option>';
        if (filters.conditions && filters.conditions.length > 0) {
            console.log('🔧 Заполняем состояния:', filters.conditions);
            filters.conditions.forEach(condition => {
                const option = document.createElement('option');
                // Check if condition is an object with 'condition' property or just a string
                const conditionValue = typeof condition === 'object' ? condition.condition : condition;
                const conditionText = typeof condition === 'object' ? `${condition.condition} (${condition.count})` : condition;
                option.value = conditionValue;
                option.textContent = conditionText;
                elements.globalConditionFilter.appendChild(option);
            });
        } else {
            console.log('⚠️ Состояния не найдены или пусты');
        }
        
        // Populate global category filter
        elements.globalCategoryFilter.innerHTML = '<option value="">Все категории</option>';
        if (filters.categories && filters.categories.length > 0) {
            console.log('🔧 Заполняем категории:', filters.categories);
            filters.categories.forEach(category => {
                const option = document.createElement('option');
                const categoryValue = typeof category === 'object' ? category.category : category;
                const categoryText = typeof category === 'object' ? `${getCategoryDisplayName(category.category)} (${category.count})` : getCategoryDisplayName(category);
                option.value = categoryValue;
                option.textContent = categoryText;
                elements.globalCategoryFilter.appendChild(option);
            });
        } else {
            console.log('⚠️ Категории не найдены или пусты');
        }
        
        // Also populate auction lots category filter
        elements.categoryFilter.innerHTML = '<option value="">Все категории</option>';
        if (filters.categories && filters.categories.length > 0) {
            console.log('🔧 Заполняем категории для лотов аукциона:', filters.categories);
            filters.categories.forEach(category => {
                const option = document.createElement('option');
                const categoryValue = typeof category === 'object' ? category.category : category;
                const categoryText = typeof category === 'object' ? `${category.category} (${category.count})` : category;
                option.value = categoryValue;
                option.textContent = categoryText;
                elements.categoryFilter.appendChild(option);
            });
        }
        
    } catch (error) {
        console.error('Ошибка загрузки глобальных фильтров:', error);
    }
}

async function handleAuctionChange() {
    const selectedAuction = elements.auctionSelect.value;
    if (selectedAuction) {
        currentAuction = selectedAuction;
        currentPage = 1;
        
        // Load filters first, then lots
        await loadFilters(selectedAuction);
        loadLots(selectedAuction, 1);
        
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
        
        // Update metal filter
        elements.metalFilter.innerHTML = '<option value="">Все металлы</option>';
        if (filters.metals && filters.metals.length > 0) {
            filters.metals.forEach(metal => {
                const option = document.createElement('option');
                // Check if metal is an object with 'metal' property or just a string
                const metalValue = typeof metal === 'object' ? metal.metal : metal;
                const metalText = typeof metal === 'object' ? `${metal.metal} (${metal.count})` : metal;
                option.value = metalValue;
                option.textContent = metalText;
                elements.metalFilter.appendChild(option);
            });
        }
        
        // Update condition filter
        elements.conditionFilter.innerHTML = '<option value="">Все состояния</option>';
        if (filters.conditions && filters.conditions.length > 0) {
            filters.conditions.forEach(condition => {
                const option = document.createElement('option');
                // Check if condition is an object with 'condition' property or just a string
                const conditionValue = typeof condition === 'object' ? condition.condition : condition;
                const conditionText = typeof condition === 'object' ? `${condition.condition} (${condition.count})` : condition;
                option.value = conditionValue;
                option.textContent = conditionText;
                elements.conditionFilter.appendChild(option);
            });
        }
        
        // Update category filter for auction lots page
        elements.categoryFilter.innerHTML = '<option value="">Все категории</option>';
        if (filters.categories && filters.categories.length > 0) {
            filters.categories.forEach(category => {
                const option = document.createElement('option');
                const categoryValue = typeof category === 'object' ? category.category : category;
                const categoryText = typeof category === 'object' ? `${category.category} (${category.count})` : category;
                option.value = categoryValue;
                option.textContent = categoryText;
                elements.categoryFilter.appendChild(option);
            });
        }
        
        // Also update the catalog category filter
        const catalogCategoryFilter = document.getElementById('auction-category-filter');
        if (catalogCategoryFilter) {
            catalogCategoryFilter.innerHTML = '<option value="">Все категории</option>';
            if (filters.categories && filters.categories.length > 0) {
                filters.categories.forEach(category => {
                    const option = document.createElement('option');
                    const categoryValue = typeof category === 'object' ? category.category : category;
                    const categoryText = typeof category === 'object' ? `${category.category} (${category.count})` : category;
                    option.value = categoryValue;
                    option.textContent = categoryText;
                    catalogCategoryFilter.appendChild(option);
                });
            }
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
        category: elements.categoryFilter.value,
        year: elements.yearInput.value,
        minPrice: elements.minPrice.value,
        maxPrice: elements.maxPrice.value
    };
    
    // Remove empty filters
    Object.keys(currentFilters).forEach(key => {
        if (!currentFilters[key]) {
            delete currentFilters[key];
        }
    });
    
    // Clear cache to ensure fresh data
    apiCache.clear();
    
    currentPage = 1;
    if (currentAuction) {
        loadLots(currentAuction, 1);
    }
}

function clearFilters() {
    elements.searchInput.value = '';
    elements.metalFilter.value = '';
    elements.conditionFilter.value = '';
    elements.categoryFilter.value = '';
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

function getCategoryDisplayName(category) {
    // Просто возвращаем название категории как есть
    return category || 'Не указана';
}

function formatPredictionDate(dateString) {
    if (!dateString) return 'Не указана';
    
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    
    if (diffMinutes < 60) {
        return `${diffMinutes} мин. назад`;
    } else if (diffHours < 24) {
        return `${diffHours} ч. назад`;
    } else if (diffDays < 7) {
        return `${diffDays} дн. назад`;
    } else {
        return date.toLocaleDateString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }
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

// Winner functions
async function searchWinner() {
    const login = elements.winnerSearch.value.trim();
    
    if (!login) {
        alert('Введите логин победителя');
        return;
    }
    
    try {
        // Show loading state
        elements.winnersLoading.classList.remove('hidden');
        elements.winnersError.classList.add('hidden');
        elements.winnerStats.classList.add('hidden');
        elements.winnerAuctions.classList.add('hidden');
        elements.winnerLots.classList.add('hidden');
        
        const data = await cachedFetch(`/api/winners/${encodeURIComponent(login)}`);
        
        // Hide loading state
        elements.winnersLoading.classList.add('hidden');
        
        // Show winner data
        displayWinnerData(data);
        
    } catch (error) {
        console.error('Ошибка поиска победителя:', error);
        elements.winnersLoading.classList.add('hidden');
        elements.winnersError.classList.remove('hidden');
    }
}

async function displayWinnerData(data) {
    const { stats, auctions, lots } = data;
    
    // Display statistics
    elements.winnerLogin.textContent = stats.winner_login;
    elements.winnerTotalLots.textContent = stats.total_lots;
    elements.winnerTotalAmount.textContent = formatPrice(stats.total_amount);
    
    // Загружаем и отображаем рейтинг победителя
    try {
        const rating = await getCachedRating(stats.winner_login);
        if (rating) {
            // Создаем контейнер для никнейма и рейтинга
            const loginContainer = document.createElement('div');
            loginContainer.className = 'flex items-center space-x-3';
            
            // Никнейм
            const loginSpan = document.createElement('span');
            loginSpan.textContent = stats.winner_login;
            loginSpan.className = 'text-2xl font-bold text-gray-800';
            loginContainer.appendChild(loginSpan);
            
            // Рейтинг
            const ratingBadge = document.createElement('span');
            ratingBadge.className = 'inline-flex items-center px-3 py-1 rounded-full text-sm font-medium';
            ratingBadge.style.backgroundColor = rating.color;
            ratingBadge.style.color = 'white';
            ratingBadge.innerHTML = `${rating.icon} ${rating.rating} (${rating.category})`;
            loginContainer.appendChild(ratingBadge);
            
            // Скоринг подозрительности (если есть)
            if (rating.suspiciousLevel) {
                const suspiciousBadge = document.createElement('span');
                suspiciousBadge.className = 'inline-flex items-center px-3 py-1 rounded-full text-sm font-medium cursor-pointer hover:opacity-80 transition-opacity';
                suspiciousBadge.style.backgroundColor = rating.suspiciousLevel.color;
                suspiciousBadge.style.color = 'white';
                suspiciousBadge.innerHTML = `${rating.suspiciousLevel.icon} ${rating.suspiciousScore}`;
                suspiciousBadge.title = `Подозрительность: ${rating.suspiciousLevel.level}. Кликните для расшифровки`;
                suspiciousBadge.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    showUserScoringDetails(stats.winner_login);
                });
                loginContainer.appendChild(suspiciousBadge);
            }
            
            // Заменяем содержимое
            elements.winnerLogin.innerHTML = '';
            elements.winnerLogin.appendChild(loginContainer);
        }
    } catch (error) {
        console.error('Ошибка загрузки рейтинга:', error);
    }
    
    elements.winnerStats.classList.remove('hidden');
    
    // Display auctions
    displayWinnerAuctions(auctions);
    elements.winnerAuctions.classList.remove('hidden');
    
    // Display lots
    displayWinnerLots(lots);
    elements.winnerLots.classList.remove('hidden');
}

function displayWinnerAuctions(auctions) {
    elements.auctionsList.innerHTML = '';
    
    auctions.forEach(auction => {
        const auctionCard = document.createElement('div');
        auctionCard.className = 'bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow';
        
        auctionCard.innerHTML = `
            <div class="flex items-center justify-between mb-2">
                <h4 class="font-semibold text-gray-800">Аукцион ${auction.auction_number}</h4>
                <span class="text-sm text-gray-500">${formatDate(auction.auction_date)}</span>
            </div>
            <div class="space-y-1">
                <div class="flex justify-between text-sm">
                    <span class="text-gray-600">Лотов выиграно:</span>
                    <span class="font-medium">${auction.lots_won}</span>
                </div>
                <div class="flex justify-between text-sm">
                    <span class="text-gray-600">Потрачено:</span>
                    <span class="font-medium text-green-600">${formatPrice(auction.total_spent)}</span>
                </div>
            </div>
        `;
        
        elements.auctionsList.appendChild(auctionCard);
    });
}

function displayWinnerLots(lots) {
    elements.lotsList.innerHTML = '';
    
    lots.forEach(lot => {
        const lotCard = createWinnerLotCard(lot);
        elements.lotsList.appendChild(lotCard);
    });
}

function createWinnerLotCard(lot) {
    const card = document.createElement('div');
    card.className = 'bg-white border border-gray-200 rounded-lg overflow-hidden hover:shadow-lg hover:border-blue-300 transition-all duration-200 cursor-pointer transform hover:-translate-y-1';
    
    card.innerHTML = `
        <div class="p-4">
            <div class="flex items-start justify-between mb-3">
                <div class="flex-1">
                    <h4 class="font-semibold text-gray-800 mb-1 flex items-center">
                        <i class="fas fa-coins text-blue-500 mr-2"></i>Лот ${lot.lot_number}
                    </h4>
                    <p class="text-sm text-gray-600 mb-2">Аукцион ${lot.auction_number}</p>
                    <p class="text-sm text-gray-500">${formatDate(lot.auction_end_date)}</p>
                </div>
                <div class="text-right">
                    <p class="text-lg font-bold text-green-600">${formatPrice(lot.winning_bid)}</p>
                </div>
            </div>
            
            <div class="mb-3">
                <p class="text-sm text-gray-700 line-clamp-2">${lot.coin_description || 'Описание недоступно'}</p>
            </div>
            
            <div class="flex flex-wrap gap-2 text-xs">
                ${lot.year ? `<span class="bg-blue-100 text-blue-800 px-2 py-1 rounded">${lot.year}</span>` : ''}
                ${lot.metal ? `<span class="bg-gray-100 text-gray-800 px-2 py-1 rounded">${lot.metal}</span>` : ''}
                ${lot.condition ? `<span class="bg-green-100 text-green-800 px-2 py-1 rounded">${lot.condition}</span>` : ''}
            </div>
            
            <div class="mt-3 pt-3 border-t border-gray-100">
                <div id="winner-metal-info-${lot.id}" class="mb-2">
                    <!-- Информация о металле будет загружена асинхронно -->
                </div>
                <p class="text-xs text-gray-500 text-center">
                    <i class="fas fa-info-circle mr-1"></i>Кликните для подробностей
                </p>
            </div>
        </div>
    `;
    
    card.addEventListener('click', () => showLotModal(lot.id));
    
    // Загружаем информацию о металле асинхронно
    if (lot.winning_bid && lot.metal && lot.weight) {
        loadMetalInfo(lot.id).then(metalInfo => {
            const metalInfoContainer = card.querySelector(`#winner-metal-info-${lot.id}`);
            if (metalInfoContainer && metalInfo) {
                metalInfoContainer.innerHTML = createMetalInfoHTML(metalInfo);
            }
        });
    }
    
    return card;
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('ru-RU', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

// Функция для загрузки информации о металле и нумизматической наценке
async function loadMetalInfo(lotId) {
    try {
        const response = await fetch(`/api/numismatic-premium/${lotId}`);
        if (response.ok) {
            return await response.json();
        }
        return null;
    } catch (error) {
        console.error('Ошибка загрузки информации о металле:', error);
        return null;
    }
}

// Функция для загрузки рейтинга победителя
async function loadWinnerRating(winnerLogin) {
    try {
        const response = await fetch(`/api/ratings/${winnerLogin}`);
        if (response.ok) {
            return await response.json();
        }
        return null;
    } catch (error) {
        console.error('Ошибка загрузки рейтинга победителя:', error);
        return null;
    }
}

// Кэш рейтингов для быстрого доступа
const ratingsCache = new Map();

// Функция для получения рейтинга с кэшированием
async function getCachedRating(winnerLogin) {
    const cached = ratingsCache.get(winnerLogin);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        return cached.data;
    }
    
    const rating = await loadWinnerRating(winnerLogin);
    if (rating) {
        ratingsCache.set(winnerLogin, {
            data: rating,
            timestamp: Date.now()
        });
    }
    
    return rating;
}

// Функция для загрузки информации о металле на текущую дату
async function loadCurrentMetalInfo(lotId) {
    try {
        const response = await fetch(`/api/numismatic-premium-current/${lotId}`);
        if (response.ok) {
            return await response.json();
        }
        return null;
    } catch (error) {
        console.error('Ошибка загрузки информации о металле на текущую дату:', error);
        return null;
    }
}

// Функция для создания HTML блока с информацией о металле
function createMetalInfoHTML(metalInfo) {
    if (!metalInfo) return '';
    
    const { metal_price, numismatic_premium } = metalInfo;
    const metalValue = parseFloat(numismatic_premium.metalValue).toLocaleString('ru-RU', {
        style: 'currency',
        currency: 'RUB',
        minimumFractionDigits: 0
    });
    const premium = parseFloat(numismatic_premium.premium).toLocaleString('ru-RU', {
        style: 'currency',
        currency: 'RUB',
        minimumFractionDigits: 0
    });
    const premiumPercent = parseFloat(numismatic_premium.premiumPercent).toFixed(1);
    
    return `
        <div class="bg-blue-50 rounded-lg p-3 mt-3">
            <h6 class="font-semibold text-blue-800 mb-2 flex items-center">
                <i class="fas fa-coins mr-2"></i>Анализ металла
            </h6>
            <div class="space-y-1 text-sm">
                <div class="flex justify-between">
                    <span class="text-gray-600">Цена металла:</span>
                    <span class="font-medium">${metalValue}</span>
                </div>
                <div class="flex justify-between">
                    <span class="text-gray-600">Нумизматическая наценка:</span>
                    <span class="font-medium text-green-600">${premium}</span>
                </div>
                <div class="flex justify-between">
                    <span class="text-gray-600">Наценка:</span>
                    <span class="font-medium text-green-600">${premiumPercent}%</span>
                </div>
            </div>
        </div>
    `;
}

// Функция для создания HTML блока с информацией о металле на текущую дату
function createCurrentMetalInfoHTML(metalInfo) {
    if (!metalInfo) return '';
    
    const { metal_price, numismatic_premium } = metalInfo;
    const metalValue = parseFloat(numismatic_premium.metalValue).toLocaleString('ru-RU', {
        style: 'currency',
        currency: 'RUB',
        minimumFractionDigits: 0
    });
    const premium = parseFloat(numismatic_premium.premium).toLocaleString('ru-RU', {
        style: 'currency',
        currency: 'RUB',
        minimumFractionDigits: 0
    });
    const premiumPercent = parseFloat(numismatic_premium.premiumPercent).toFixed(1);
    
    // Определяем цвет в зависимости от знака наценки
    const premiumColor = parseFloat(numismatic_premium.premium) >= 0 ? 'text-green-600' : 'text-red-600';
    const percentColor = parseFloat(numismatic_premium.premiumPercent) >= 0 ? 'text-green-600' : 'text-red-600';
    
    return `
        <div class="bg-orange-50 rounded-lg p-3 mt-3">
            <h6 class="font-semibold text-orange-800 mb-2 flex items-center">
                <i class="fas fa-chart-line mr-2"></i>Анализ на сегодня
            </h6>
            <div class="space-y-1 text-sm">
                <div class="flex justify-between">
                    <span class="text-gray-600">Цена металла:</span>
                    <span class="font-medium">${metalValue}</span>
                </div>
                <div class="flex justify-between">
                    <span class="text-gray-600">Нумизматическая наценка:</span>
                    <span class="font-medium ${premiumColor}">${premium}</span>
                </div>
                <div class="flex justify-between">
                    <span class="text-gray-600">Наценка:</span>
                    <span class="font-medium ${percentColor}">${premiumPercent}%</span>
                </div>
            </div>
        </div>
    `;
}

// Create clickable winner link
function createWinnerLink(winnerLogin) {
    if (!winnerLogin) return 'Не указан';
    
    const container = document.createElement('div');
    container.className = 'flex items-center space-x-2';
    
    const link = document.createElement('a');
    link.href = '#';
    link.className = 'text-blue-600 hover:text-blue-800 hover:underline font-medium';
    link.textContent = winnerLogin;
    link.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation(); // Prevent event bubbling to parent elements
        showWinnerStats(winnerLogin);
    });
    
    container.appendChild(link);
    
    // Загружаем рейтинг асинхронно
    getCachedRating(winnerLogin).then(rating => {
        if (rating) {
            // Рейтинг
            const ratingBadge = document.createElement('span');
            ratingBadge.className = 'inline-flex items-center px-2 py-1 rounded-full text-xs font-medium';
            ratingBadge.style.backgroundColor = rating.color;
            ratingBadge.style.color = 'white';
            ratingBadge.innerHTML = `${rating.icon} ${rating.rating}`;
            container.appendChild(ratingBadge);
            
            // Скоринг подозрительности (если есть)
            if (rating.suspiciousLevel) {
                const suspiciousBadge = document.createElement('span');
                suspiciousBadge.className = 'inline-flex items-center px-2 py-1 rounded-full text-xs font-medium cursor-pointer hover:opacity-80 transition-opacity';
                suspiciousBadge.style.backgroundColor = rating.suspiciousLevel.color;
                suspiciousBadge.style.color = 'white';
                suspiciousBadge.innerHTML = `${rating.suspiciousLevel.icon} ${rating.suspiciousScore}`;
                suspiciousBadge.title = `Подозрительность: ${rating.suspiciousLevel.level}. Кликните для расшифровки`;
                suspiciousBadge.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    showUserScoringDetails(winnerLogin);
                });
                container.appendChild(suspiciousBadge);
            }
        }
    });
    
    return container;
}

// Show winner stats by switching to winners tab and searching
function showWinnerStats(login) {
    // Switch to winners tab
    switchTab('winners');
    
    // Set search input and trigger search
    elements.winnerSearch.value = login;
    searchWinner();
}

// Global Search Functions

async function applyGlobalFilters() {
    try {
        // Show loading state
        elements.globalSearchLoading.classList.remove('hidden');
        elements.globalSearchError.classList.add('hidden');
        elements.globalLotsList.classList.add('hidden');
        elements.globalPagination.classList.add('hidden');
        
        // Collect filter values
        globalSearchFilters = {
            search: elements.globalSearchInput.value.trim(),
            metal: elements.globalMetalFilter.value,
            condition: elements.globalConditionFilter.value,
            category: elements.globalCategoryFilter.value,
            year: elements.globalYearInput.value,
            minPrice: elements.globalMinPrice.value,
            maxPrice: elements.globalMaxPrice.value
        };
        
        // Clear cache for search requests to ensure fresh data
        const cacheKeysToDelete = [];
        for (const [key, value] of apiCache.entries()) {
            if (key.includes('/api/search-lots')) {
                cacheKeysToDelete.push(key);
            }
        }
        cacheKeysToDelete.forEach(key => apiCache.delete(key));
        
        // Reset to first page
        globalSearchPage = 1;
        
        // Perform search
        console.log('🔍 Применяем фильтры:', globalSearchFilters);
        await performGlobalSearch();
        
    } catch (error) {
        console.error('Ошибка применения фильтров:', error);
        elements.globalSearchLoading.classList.add('hidden');
        elements.globalSearchError.classList.remove('hidden');
    }
}

async function performGlobalSearch() {
    try {
        const params = new URLSearchParams({
            page: globalSearchPage,
            limit: 20,
            ...Object.fromEntries(
                Object.entries(globalSearchFilters).filter(([_, value]) => value)
            )
        });
        
        const url = `/api/search-lots?${params}`;
        console.log('🔗 URL запроса:', url);
        console.log('📋 Параметры:', params.toString());
        const response = await cachedFetch(url);
        
        globalSearchResults = response;
        
        // Hide loading state
        elements.globalSearchLoading.classList.add('hidden');
        
        // Display results
        displayGlobalSearchResults(response);
        
    } catch (error) {
        console.error('Ошибка поиска лотов:', error);
        elements.globalSearchLoading.classList.add('hidden');
        elements.globalSearchError.classList.remove('hidden');
    }
}

function displayGlobalSearchResults(data) {
    const { lots, pagination } = data;
    
    // Update results count
    elements.globalResultsCount.textContent = `Найдено: ${pagination.total} лотов`;
    
    // Display lots
    if (lots.length === 0) {
        elements.globalLotsList.innerHTML = '<p class="text-gray-600 col-span-full text-center py-8">Лоты не найдены</p>';
    } else {
        elements.globalLotsList.innerHTML = '';
        lots.forEach(lot => {
            const lotCard = createLotCard(lot);
            elements.globalLotsList.appendChild(lotCard);
        });
    }
    
    // Show results and pagination
    elements.globalLotsList.classList.remove('hidden');
    displayGlobalPagination(pagination);
}

function displayGlobalPagination(pagination) {
    if (pagination.pages <= 1) {
        elements.globalPagination.classList.add('hidden');
        return;
    }
    
    elements.globalPagination.classList.remove('hidden');
    
    let paginationHTML = '<div class="flex items-center space-x-2">';
    
    // Previous button
    if (pagination.page > 1) {
        paginationHTML += `
            <button onclick="changeGlobalPage(${pagination.page - 1})" 
                    class="px-3 py-2 text-sm font-medium text-gray-500 bg-white border border-gray-300 rounded-md hover:bg-gray-50">
                Предыдущая
            </button>
        `;
    }
    
    // Page numbers
    const startPage = Math.max(1, pagination.page - 2);
    const endPage = Math.min(pagination.pages, pagination.page + 2);
    
    for (let i = startPage; i <= endPage; i++) {
        const isActive = i === pagination.page;
        paginationHTML += `
            <button onclick="changeGlobalPage(${i})" 
                    class="px-3 py-2 text-sm font-medium ${isActive ? 'text-white bg-blue-600' : 'text-gray-500 bg-white border border-gray-300'} rounded-md hover:bg-gray-50">
                ${i}
            </button>
        `;
    }
    
    // Next button
    if (pagination.page < pagination.pages) {
        paginationHTML += `
            <button onclick="changeGlobalPage(${pagination.page + 1})" 
                    class="px-3 py-2 text-sm font-medium text-gray-500 bg-white border border-gray-300 rounded-md hover:bg-gray-50">
                Следующая
            </button>
        `;
    }
    
    paginationHTML += '</div>';
    elements.globalPagination.innerHTML = paginationHTML;
}

function changeGlobalPage(page) {
    globalSearchPage = page;
    performGlobalSearch();
}

// Make function globally accessible
window.changeGlobalPage = changeGlobalPage;

function clearGlobalFilters() {
    elements.globalSearchInput.value = '';
    elements.globalMetalFilter.value = '';
    elements.globalConditionFilter.value = '';
    elements.globalCategoryFilter.value = '';
    elements.globalYearInput.value = '';
    elements.globalMinPrice.value = '';
    elements.globalMaxPrice.value = '';
    elements.clearGlobalYearBtn.classList.add('hidden');
    
    globalSearchFilters = {};
    globalSearchPage = 1;
    globalSearchResults = null;
    
    elements.globalLotsList.classList.add('hidden');
    elements.globalPagination.classList.add('hidden');
    elements.globalResultsCount.textContent = '';
}

function exportGlobalResults() {
    if (!globalSearchResults || !globalSearchResults.lots.length) {
        alert('Нет результатов для экспорта');
        return;
    }
    
    // Create CSV content
    const headers = ['Аукцион', 'Лот', 'Описание', 'Металл', 'Состояние', 'Год', 'Победитель', 'Цена', 'Дата'];
    const csvContent = [
        headers.join(','),
        ...globalSearchResults.lots.map(lot => [
            lot.auction_number,
            lot.lot_number,
            `"${lot.coin_description.replace(/"/g, '""')}"`,
            lot.metal || '',
            lot.condition || '',
            lot.year || '',
            lot.winner_login || '',
            lot.winning_bid || '',
            lot.auction_end_date || ''
        ].join(','))
    ].join('\n');
    
    // Download CSV
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `search_results_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// Current Auction Functions
async function loadCurrentAuction() {
    try {
        // Show loading state
        elements.currentAuctionLoading.classList.remove('hidden');
        elements.currentAuctionError.classList.add('hidden');
        elements.currentAuctionLotsList.classList.add('hidden');
        elements.currentAuctionPagination.classList.add('hidden');
        
        // Reset to first page
        currentAuctionPage = 1;
        
        // Load current auction lots
        await performCurrentAuctionLoad();
        
    } catch (error) {
        console.error('Ошибка загрузки текущего аукциона:', error);
        elements.currentAuctionLoading.classList.add('hidden');
        elements.currentAuctionError.classList.remove('hidden');
    }
}

async function performCurrentAuctionLoad() {
    try {
        const params = new URLSearchParams({
            page: currentAuctionPage,
            limit: 12
        });
        
        const url = `/api/current-auction?${params}`;
        console.log('Loading current auction from:', url);
        const response = await cachedFetch(url);
        console.log('Current auction response:', response);
        
        // Проверяем структуру ответа
        if (!response) {
            throw new Error('Пустой ответ от API');
        }
        if (!response.lots) {
            throw new Error('Отсутствует поле lots в ответе');
        }
        if (!response.pagination) {
            throw new Error('Отсутствует поле pagination в ответе');
        }
        
        currentAuctionResults = response;
        
        // Update section title with current auction number
        const sectionTitle = document.querySelector('#currentAuctionSection h2');
        if (sectionTitle) {
            if (response.currentAuctionNumber) {
                sectionTitle.innerHTML = `
                    <i class="fas fa-clock text-orange-500 mr-3"></i>Текущий аукцион ${response.currentAuctionNumber}
                `;
            } else {
                sectionTitle.innerHTML = `
                    <i class="fas fa-clock text-orange-500 mr-3"></i>Текущий аукцион
                `;
            }
        }
        
        // Hide loading state
        if (elements.currentAuctionLoading) {
            elements.currentAuctionLoading.classList.add('hidden');
        } else {
            console.error('Элемент currentAuctionLoading не найден');
        }
        
        // Display results
        displayCurrentAuctionResults(response);
        
        // Load analytics for all lots in the auction
        // Use simple analytics based on current page data
        updateSimpleAnalytics(response);
        
    } catch (error) {
        console.error('Ошибка загрузки лотов текущего аукциона:', error);
        elements.currentAuctionLoading.classList.add('hidden');
        elements.currentAuctionError.classList.remove('hidden');
    }
}

function displayCurrentAuctionResults(data) {
    console.log('displayCurrentAuctionResults called with:', data);
    
    if (!data) {
        console.error('displayCurrentAuctionResults: data is null or undefined');
        return;
    }
    
    const { currentAuctionNumber, lots, pagination } = data;
    
    if (!lots) {
        console.error('displayCurrentAuctionResults: lots is null or undefined');
        return;
    }
    
    if (!pagination) {console.error('displayCurrentAuctionResults: pagination is null or undefined');
        return;
    }
    
    // Update results count with current auction number
    if (currentAuctionNumber) {
        elements.currentAuctionResultsCount.textContent = `Аукцион ${currentAuctionNumber} • Найдено: ${pagination.total} активных лотов`;
    } else {
        elements.currentAuctionResultsCount.textContent = `Активных аукционов не найдено`;
    }
    
    // Display lots
    if (lots.length === 0) {
        if (currentAuctionNumber) {
            elements.currentAuctionLotsList.innerHTML = `
                <div class="text-center py-8">
                    <i class="fas fa-inbox text-4xl text-gray-400 mb-4"></i>
                    <p class="text-gray-600">Активных лотов не найдено</p>
                    <p class="text-sm text-gray-500 mt-2">Аукцион ${currentAuctionNumber} еще не начался или все лоты уже имеют победителей</p>
                </div>
            `;
        } else {
            elements.currentAuctionLotsList.innerHTML = `
                <div class="text-center py-8">
                    <i class="fas fa-inbox text-4xl text-gray-400 mb-4"></i>
                    <p class="text-gray-600">Активных аукционов не найдено</p>
                    <p class="text-sm text-gray-500 mt-2">Все аукционы завершены или еще не начались</p>
                </div>
            `;
        }
    } else {
        elements.currentAuctionLotsList.innerHTML = '';
        
        // Don't update analytics here - it's managed by updateAnalyticsDashboard()
        
        lots.forEach(lot => {
            const lotElement = createCurrentAuctionLotElement(lot);
            elements.currentAuctionLotsList.appendChild(lotElement);
        });
        
        // Загружаем прогнозы для всех лотов (асинхронно, не блокируем UI)
        if (data.currentAuctionNumber) {
            loadAllPredictions(data.currentAuctionNumber);
        }
    }
    
    // Show results and pagination
    elements.currentAuctionLotsList.classList.remove('hidden');
    displayCurrentAuctionPagination(pagination);
}

function createCurrentAuctionLotElement(lot) {
    const lotElement = document.createElement('div');
    lotElement.className = 'bg-white border border-gray-200 rounded-lg p-6 hover:shadow-lg transition-all duration-200 transform hover:-translate-y-1';
    lotElement.setAttribute('data-lot-id', lot.id);
    
    const description = lot.coin_description ? lot.coin_description.substring(0, 120) + '...' : 'Описание отсутствует';
    
    // Определяем цветовую схему на основе соотношения текущей ставки к прогнозу
    const getBidStatusColors = (currentBid, predictedPrice) => {
        if (!currentBid || !predictedPrice || predictedPrice <= 0) {
            // Если нет данных о ставке или прогнозе - нейтральный серый
            return { 
                bg: 'from-gray-50 to-gray-100', 
                border: 'border-gray-200', 
                icon: 'text-gray-600', 
                badge: 'bg-gray-100 text-gray-800',
                status: 'neutral'
            };
        }
        
        const ratio = currentBid / predictedPrice;
        
        if (ratio >= 1.05) {
            // Ставка выше прогноза на 5%+ - зеленая зона (цена слишком высокая)
            return { 
                bg: 'from-green-50 to-green-100', 
                border: 'border-green-200', 
                icon: 'text-green-600', 
                badge: 'bg-green-100 text-green-800',
                status: 'high'
            };
        } else if (ratio <= 0.90) {
            // Ставка ниже прогноза на 10%+ - красная зона (внимание, можно торговаться)
            return { 
                bg: 'from-red-50 to-red-100', 
                border: 'border-red-200', 
                icon: 'text-red-600', 
                badge: 'bg-red-100 text-red-800',
                status: 'low'
            };
        } else {
            // Промежуточная зона - градиент от красного к зеленому
            const progress = (ratio - 0.90) / (1.05 - 0.90); // 0-1 между 90% и 105%
            if (progress < 0.5) {
                // Ближе к красному
                return { 
                    bg: 'from-red-50 to-yellow-100', 
                    border: 'border-orange-200', 
                    icon: 'text-orange-600', 
                    badge: 'bg-orange-100 text-orange-800',
                    status: 'medium-low'
                };
            } else {
                // Ближе к зеленому
                return { 
                    bg: 'from-yellow-50 to-green-100', 
                    border: 'border-yellow-200', 
                    icon: 'text-yellow-600', 
                    badge: 'bg-yellow-100 text-yellow-800',
                    status: 'medium-high'
                };
            }
        }
    };
    
    const colors = getBidStatusColors(lot.current_bid_amount || lot.winning_bid, lot.predicted_price);
    
    lotElement.innerHTML = `
        <!-- Header with Premium Badge -->
        <div class="relative mb-4">
            <div class="flex items-start justify-between">
                <div class="flex-1">
                    <div class="flex items-center mb-2">
                        <h4 class="text-lg font-semibold text-gray-800 mr-3">
                            <i class="fas fa-coins ${colors.icon} mr-2"></i>Лот ${lot.lot_number}
                        </h4>
                        <span class="bg-orange-100 text-orange-800 px-2 py-1 rounded-full text-sm font-medium">
                            Активный
                        </span>
                    </div>
                    <p class="text-sm text-gray-600 mb-2">Аукцион ${lot.auction_number}</p>
                </div>
                <div id="premium-badge-${lot.id}" class="text-right">
                    <!-- Premium badge will be loaded here -->
                </div>
            </div>
        </div>
        
        <!-- Coin Images -->
        <div class="mb-4">
            <div class="flex space-x-4">
                ${lot.avers_image_url ? `
                    <div class="flex-1">
                        <div class="bg-gray-100 rounded-lg p-2">
                            <img src="${lot.avers_image_url}" 
                                 alt="Аверс лота ${lot.lot_number}" 
                                 class="w-full h-32 object-cover rounded"
                                 onerror="this.src='${createPlaceholderImage()}'"
                                 loading="lazy">
                            <p class="text-xs text-gray-500 text-center mt-1">Аверс</p>
                        </div>
                    </div>
                ` : ''}
                ${lot.revers_image_url ? `
                    <div class="flex-1">
                        <div class="bg-gray-100 rounded-lg p-2">
                            <img src="${lot.revers_image_url}" 
                                 alt="Реверс лота ${lot.lot_number}" 
                                 class="w-full h-32 object-cover rounded"
                                 onerror="this.src='${createPlaceholderImage()}'"
                                 loading="lazy">
                            <p class="text-xs text-gray-500 text-center mt-1">Реверс</p>
                        </div>
                    </div>
                ` : ''}
            </div>
        </div>
        
        <!-- Description -->
        <div class="mb-4">
            <p class="text-gray-700 text-sm leading-relaxed">${description}</p>
        </div>
        
        <!-- Key Metrics Grid -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            ${lot.year ? `
                <div class="text-center p-2 bg-gray-50 rounded-lg">
                    <p class="text-xs text-gray-500 mb-1">Год</p>
                    <p class="font-semibold text-gray-800">${lot.year}</p>
                </div>
            ` : ''}
            ${lot.metal ? `
                <div class="text-center p-2 bg-gray-50 rounded-lg">
                    <p class="text-xs text-gray-500 mb-1">Металл</p>
                    <p class="font-semibold ${colors.icon}">${lot.metal}</p>
                </div>
            ` : ''}
            ${lot.condition ? `
                <div class="text-center p-2 bg-gray-50 rounded-lg">
                    <p class="text-xs text-gray-500 mb-1">Состояние</p>
                    <p class="font-semibold text-gray-800">${lot.condition}</p>
                </div>
            ` : ''}
            ${lot.weight ? `
                <div class="text-center p-2 bg-blue-50 rounded-lg">
                    <p class="text-xs text-blue-600 mb-1">Вес</p>
                    <p class="font-semibold text-blue-800">${lot.weight}г</p>
                </div>
            ` : ''}
        </div>
        
        <!-- Current Bid and Activity -->
        <div class="bg-gradient-to-r ${colors.bg} border ${colors.border} rounded-lg p-4 mb-4">
            <div class="flex items-center justify-between">
                <div>
                    <div class="flex items-center mb-1">
                        <p class="text-sm text-gray-600 mr-2">Текущая ставка</p>
                        ${colors.status === 'high' ? '<span class="text-xs bg-green-100 text-green-800 px-2 py-1 rounded-full">Высокая цена</span>' : ''}
                        ${colors.status === 'low' ? '<span class="text-xs bg-red-100 text-red-800 px-2 py-1 rounded-full">Внимание!</span>' : ''}
                        ${colors.status === 'medium-low' ? '<span class="text-xs bg-orange-100 text-orange-800 px-2 py-1 rounded-full">Средняя</span>' : ''}
                        ${colors.status === 'medium-high' ? '<span class="text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded-full">Приемлемая</span>' : ''}
                        ${colors.status === 'neutral' ? '<span class="text-xs bg-gray-100 text-gray-800 px-2 py-1 rounded-full">Нет прогноза</span>' : ''}
                    </div>
                    <p class="text-2xl font-bold text-gray-800">${lot.current_bid_amount ? formatPrice(lot.current_bid_amount) : (lot.winning_bid ? formatPrice(lot.winning_bid) : 'Нет ставок')}</p>
                    ${lot.current_bidder ? `
                        <p class="text-xs text-gray-500 mt-1">
                            <i class="fas fa-user mr-1"></i>
                            <span class="cursor-pointer hover:text-blue-600 transition-colors" onclick="showUserStats('${lot.current_bidder}')">${lot.current_bidder}</span>
                            ${lot.current_bid_is_auto ? '<span class="text-orange-500 ml-1">*</span>' : ''}
                        </p>
                    ` : ''}
                </div>
                <div class="text-right">
                    <p class="text-sm text-gray-600 mb-1">Активность</p>
                    <div class="flex items-center">
                        <i class="fas fa-gavel text-gray-500 mr-1"></i>
                        <span class="font-semibold text-gray-800 cursor-pointer hover:text-blue-600 transition-colors" onclick="showBidsModal(${lot.id})">${lot.bids_count || 0} ставок</span>
                    </div>
                    ${lot.current_bid_timestamp ? `
                        <p class="text-xs text-gray-500 mt-1">
                            <i class="fas fa-clock mr-1"></i>
                            ${formatDate(lot.current_bid_timestamp)}
                        </p>
                    ` : ''}
                </div>
            </div>
        </div>
        
        <!-- User's Bid Section -->
        ${lot.user_bid_amount ? `
            <div class="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
                <div class="flex items-center justify-between">
                    <div>
                        <p class="text-sm text-blue-600 mb-1">Моя ставка</p>
                        <p class="text-lg font-bold text-blue-800">${formatPrice(lot.user_bid_amount)}</p>
                        ${lot.user_bid_is_auto ? '<span class="text-xs text-orange-600">Автобид</span>' : ''}
                    </div>
                    <div class="text-right">
                        <p class="text-xs text-blue-500">
                            <i class="fas fa-clock mr-1"></i>
                            ${formatDate(lot.user_bid_timestamp)}
                        </p>
                        ${lot.user_bid_amount === lot.current_bid_amount ? `
                            <span class="text-xs bg-green-100 text-green-800 px-2 py-1 rounded-full mt-1">
                                Лидирую
                            </span>
                        ` : `
                            <span class="text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded-full mt-1">
                                Перебита
                            </span>
                        `}
                    </div>
                </div>
            </div>
        ` : ''}
        
        <!-- Risk Indicator Section -->
        <div id="risk-indicator-${lot.id}" class="mb-4">
            <!-- Индикатор рискованности будет загружен асинхронно -->
        </div>
        
        <!-- Price Prediction Section -->
        <div id="prediction-${lot.id}" class="mb-4">
            <!-- Прогнозная цена будет загружена асинхронно -->
        </div>
        
        <!-- Metal Analysis Section -->
        <div id="current-metal-info-${lot.id}" class="mb-4">
            <!-- Информация о металле будет загружена асинхронно -->
        </div>
        
        <!-- Action Buttons -->
        <div class="flex items-center justify-center pt-4 border-t">
            <div class="flex space-x-2">
                <button onclick="loadPriceHistory(${lot.id})" 
                        class="bg-blue-500 hover:bg-blue-600 text-white px-3 py-2 rounded-lg transition-colors text-sm"
                        title="Анализ цены">
                    <i class="fas fa-chart-line"></i>
                </button>
                <button onclick="showLotModal(${lot.id})" 
                        class="bg-gray-500 hover:bg-gray-600 text-white px-3 py-2 rounded-lg transition-colors text-sm"
                        title="Подробнее">
                    <i class="fas fa-info-circle"></i>
                </button>
                <button onclick="addToWatchlist(${lot.id})" 
                        class="bg-yellow-500 hover:bg-yellow-600 text-white px-3 py-2 rounded-lg transition-colors text-sm"
                        title="Добавить в избранное">
                    <i class="fas fa-star"></i>
                </button>
            </div>
        </div>
        
        <!-- Price History Section (initially hidden) -->
        <div id="priceHistory-${lot.id}" class="hidden mt-4 pt-4 border-t">
            <div class="bg-gray-50 rounded-lg p-4">
                <h5 class="font-semibold text-gray-800 mb-3">
                    <i class="fas fa-history mr-2"></i>История цен аналогичных лотов
                </h5>
                <div id="priceHistoryContent-${lot.id}" class="text-center py-4">
                    <i class="fas fa-spinner fa-spin text-blue-500 mr-2"></i>
                    Загрузка истории цен...
                </div>
            </div>
        </div>
    `;
    
    // Загружаем информацию о металле на текущую дату асинхронно
    if (lot.winning_bid && lot.metal && lot.weight) {
        loadCurrentMetalInfo(lot.id).then(metalInfo => {
            const metalInfoContainer = lotElement.querySelector(`#current-metal-info-${lot.id}`);
            const premiumBadgeContainer = lotElement.querySelector(`#premium-badge-${lot.id}`);
            
            if (metalInfoContainer && metalInfo) {
                metalInfoContainer.innerHTML = createCurrentMetalInfoHTML(metalInfo);
            }
            
            if (premiumBadgeContainer && metalInfo && metalInfo.numismatic_premium) {
                const premium = parseFloat(metalInfo.numismatic_premium.premium);
                const premiumPercent = lot.winning_bid ? ((premium / lot.winning_bid) * 100).toFixed(1) : 0;
                
                let badgeClass = 'bg-gray-100 text-gray-800';
                let badgeIcon = 'fas fa-minus';
                
                if (premium > 0) {
                    if (premiumPercent > 50) {
                        badgeClass = 'bg-red-100 text-red-800';
                        badgeIcon = 'fas fa-exclamation-triangle';
                    } else if (premiumPercent > 20) {
                        badgeClass = 'bg-yellow-100 text-yellow-800';
                        badgeIcon = 'fas fa-exclamation-circle';
                    } else {
                        badgeClass = 'bg-green-100 text-green-800';
                        badgeIcon = 'fas fa-check-circle';
                    }
                } else if (premium < 0) {
                    badgeClass = 'bg-blue-100 text-blue-800';
                    badgeIcon = 'fas fa-arrow-down';
                }
                
                premiumBadgeContainer.innerHTML = `
                    <div class="text-center">
                        <div class="${badgeClass} px-3 py-1 rounded-full text-sm font-medium inline-flex items-center">
                            <i class="${badgeIcon} mr-1"></i>
                            ${premium > 0 ? '+' : ''}${formatPrice(premium)}
                        </div>
                        <p class="text-xs text-gray-500 mt-1">${premiumPercent}%</p>
                    </div>
                `;
                
                // Update analytics after premium data is loaded
                setTimeout(() => updateAnalyticsFromPageData(), 100);
            }
        });
    }
    
    // Загружаем прогнозную цену и рискованность асинхронно
    loadLotPrediction(lot.id);
    loadLotRisk(lot.id).then(riskData => {
        if (riskData) {
            renderRiskIndicator(lot.id, riskData);
        }
    });
    
    return lotElement;
}

function displayCurrentAuctionPagination(pagination) {
    if (pagination.pages <= 1) {
        elements.currentAuctionPagination.classList.add('hidden');
        return;
    }
    
    elements.currentAuctionPagination.classList.remove('hidden');
    
    let paginationHTML = '<div class="flex items-center space-x-2">';
    
    // Previous button
    if (pagination.page > 1) {
        paginationHTML += `
            <button onclick="changeCurrentAuctionPage(${pagination.page - 1})" 
                    class="px-3 py-2 text-sm font-medium text-gray-500 bg-white border border-gray-300 rounded-md hover:bg-gray-50">
                Предыдущая
            </button>
        `;
    }
    
    // Page numbers
    const startPage = Math.max(1, pagination.page - 2);
    const endPage = Math.min(pagination.pages, pagination.page + 2);
    
    for (let i = startPage; i <= endPage; i++) {
        const isActive = i === pagination.page;
        paginationHTML += `
            <button onclick="changeCurrentAuctionPage(${i})" 
                    class="px-3 py-2 text-sm font-medium ${isActive ? 'text-white bg-blue-600' : 'text-gray-500 bg-white border border-gray-300'} rounded-md hover:bg-gray-50">
                ${i}
            </button>
        `;
    }
    
    // Next button
    if (pagination.page < pagination.pages) {
        paginationHTML += `
            <button onclick="changeCurrentAuctionPage(${pagination.page + 1})" 
                    class="px-3 py-2 text-sm font-medium text-gray-500 bg-white border border-gray-300 rounded-md hover:bg-gray-50">
                Следующая
            </button>
        `;
    }
    
    paginationHTML += '</div>';
    elements.currentAuctionPagination.innerHTML = paginationHTML;
}

function changeCurrentAuctionPage(page) {
    currentAuctionPage = page;
    performCurrentAuctionLoad();
}

// Make function globally accessible
window.changeCurrentAuctionPage = changeCurrentAuctionPage;

async function loadPriceHistory(lotId) {
    const priceHistorySection = document.getElementById(`priceHistory-${lotId}`);
    const priceHistoryContent = document.getElementById(`priceHistoryContent-${lotId}`);
    
    // Toggle visibility
    if (priceHistorySection.classList.contains('hidden')) {
        priceHistorySection.classList.remove('hidden');
        
        // Load price history if not already loaded
        if (priceHistoryContent.innerHTML.includes('Загрузка истории цен')) {
            try {
                const response = await fetch(`/api/similar-lots/${lotId}`);
                const data = await response.json();
                
                displayPriceHistory(lotId, data);
            } catch (error) {
                console.error('Ошибка загрузки истории цен:', error);
                priceHistoryContent.innerHTML = `
                    <div class="text-red-600">
                        <i class="fas fa-exclamation-triangle mr-2"></i>
                        Ошибка загрузки истории цен
                    </div>
                `;
            }
        }
    } else {
        priceHistorySection.classList.add('hidden');
    }
}

function displayPriceHistory(lotId, data) {
    const priceHistoryContent = document.getElementById(`priceHistoryContent-${lotId}`);
    const { currentLot, similarLots } = data;
    
    if (similarLots.length === 0) {
        priceHistoryContent.innerHTML = `
            <div class="text-gray-600">
                <i class="fas fa-info-circle mr-2"></i>
                Аналогичные лоты не найдены
            </div>
        `;
        return;
    }
    
    // Calculate price statistics
    const prices = similarLots.map(lot => lot.winning_bid);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    
    let historyHTML = `
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <div class="bg-green-50 rounded-lg p-3 text-center">
                <p class="text-sm text-gray-600">Минимальная цена</p>
                <p class="text-lg font-bold text-green-600">${formatPrice(minPrice)}</p>
            </div>
            <div class="bg-red-50 rounded-lg p-3 text-center">
                <p class="text-sm text-gray-600">Максимальная цена</p>
                <p class="text-lg font-bold text-red-600">${formatPrice(maxPrice)}</p>
            </div>
        </div>
        
        <!-- Chart Section -->
        <div class="mb-6">
            <h6 class="font-medium text-gray-800 mb-3">
                <i class="fas fa-chart-line mr-2"></i>График динамики цен
            </h6>
            <div class="bg-white rounded-lg border p-4">
                <div class="chart-container">
                    <canvas id="priceHistoryChart-${lotId}" style="max-height: 400px; border-radius: 8px; background: #fafafa;"></canvas>
                </div>
            </div>
        </div>
        
        <div class="space-y-2">
            <h6 class="font-medium text-gray-800 mb-2">Аналогичные лоты:</h6>
    `;
    
    similarLots.slice(0, 5).forEach(lot => {
        historyHTML += `
            <div class="py-2 px-3 bg-white rounded border cursor-pointer hover:bg-gray-50 transition-colors" 
                 onclick="showLotModal(${lot.id})">
                <div class="flex items-center justify-between">
                    <div class="flex-1">
                        <p class="text-sm font-medium">Лот ${lot.lot_number} (Аукцион ${lot.auction_number})</p>
                        <p class="text-xs text-gray-500">${lot.year}г. • ${lot.metal} • ${lot.condition}${lot.weight ? ` • ${lot.weight}г` : ''}</p>
                        <p class="text-xs text-gray-500">${formatDate(lot.auction_end_date)}</p>
                    </div>
                    <div class="text-right">
                        <p class="font-bold text-green-600">${formatPrice(lot.winning_bid)}</p>
                        <div id="history-winner-${lot.id}" class="text-xs text-gray-500">
                            <!-- Победитель с рейтингом будет загружен асинхронно -->
                        </div>
                    </div>
                </div>
                <div id="history-metal-info-${lot.id}" class="mt-2">
                    <!-- Информация о металле будет загружена асинхронно -->
                </div>
            </div>
        `;
    });
    
    historyHTML += '</div>';
    priceHistoryContent.innerHTML = historyHTML;
    
    // Загружаем информацию о металле и рейтинги для каждого лота в истории асинхронно
    const metalPromises = similarLots.slice(0, 5).map(lot => {
        if (lot.winning_bid && lot.metal && lot.weight) {
            return loadMetalInfo(lot.id).then(metalInfo => {
                const metalInfoContainer = document.getElementById(`history-metal-info-${lot.id}`);
                if (metalInfoContainer && metalInfo) {
                    metalInfoContainer.innerHTML = createMetalInfoHTML(metalInfo);
                }
                return { lotId: lot.id, metalInfo };
            });
        }
        return Promise.resolve({ lotId: null, metalInfo: null });
    });
    
    // Загружаем рейтинги победителей для истории
    similarLots.slice(0, 5).forEach(lot => {
        if (lot.winner_login) {
            getCachedRating(lot.winner_login).then(rating => {
                const winnerContainer = document.getElementById(`history-winner-${lot.id}`);
                if (winnerContainer) {
                    if (rating) {
                        const winnerLink = createWinnerLink(lot.winner_login);
                        winnerContainer.appendChild(winnerLink);
                    } else {
                        winnerContainer.textContent = lot.winner_login;
                    }
                }
            });
        }
    });
    
    // Wait for all metal data to load, then create chart with complete data
    Promise.all(metalPromises).then((metalDataResults) => {
        console.log(`Creating chart for lot ${lotId} with ${similarLots.length} similar lots and ${metalDataResults.length} metal data results`);
        
        // Create chart with all data
        createPriceHistoryChart(lotId, similarLots);
        
        // Update chart with metal data
        metalDataResults.forEach(({ lotId: dataLotId, metalInfo }) => {
            if (dataLotId && metalInfo) {
                updateChartWithMetalData(lotId, dataLotId, metalInfo);
            }
        });
        
        // Force final chart update
        const chart = priceHistoryCharts.get(lotId);
        if (chart) {
            chart.update();
        }
    });
}

// Функция для отображения детальной информации о лоте

// Chart functions
let priceHistoryCharts = new Map(); // Store charts by lot ID

function createPriceHistoryChart(lotId, similarLots) {
    // Destroy existing chart for this lot if it exists
    if (priceHistoryCharts.has(lotId)) {
        priceHistoryCharts.get(lotId).destroy();
        priceHistoryCharts.delete(lotId);
    }
    
    // Prepare data for chart
    const chartData = prepareChartData(similarLots);
    
    if (!chartData || chartData.labels.length === 0) {
        return null;
    }
    
    const canvasId = `priceHistoryChart-${lotId}`;
    const canvas = document.getElementById(canvasId);
    if (!canvas) {
        console.error(`Canvas with ID ${canvasId} not found`);
        return null;
    }
    
    console.log(`Canvas found for lot ${lotId}, creating chart with ${chartData.labels.length} data points`);
    
    const ctx = canvas.getContext('2d');
    
    const chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: chartData.labels,
            lotIds: chartData.lotIds, // Store lot IDs for reference
            datasets: [
                {
                    label: 'Цена лота (₽)',
                    data: chartData.lotPrices,
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    borderWidth: 2,
                    fill: false,
                    tension: 0.1,
                    pointBackgroundColor: '#3b82f6',
                    pointBorderColor: '#ffffff',
                    pointBorderWidth: 2,
                    pointRadius: 6,
                    pointHoverRadius: 8
                },
                {
                    label: 'Цена золота (₽/г)',
                    data: chartData.goldPrices,
                    borderColor: '#f59e0b',
                    backgroundColor: 'rgba(245, 158, 11, 0.1)',
                    borderWidth: 2,
                    fill: false,
                    tension: 0.1,
                    spanGaps: true, // Connect points across null values
                    pointBackgroundColor: '#f59e0b',
                    pointBorderColor: '#ffffff',
                    pointBorderWidth: 2,
                    yAxisID: 'y1', // Use right Y axis
                    pointRadius: function(context) {
                        // Hide points with null value (not loaded yet)
                        return context.parsed.y === null ? 0 : 6;
                    },
                    pointHoverRadius: function(context) {
                        return context.parsed.y === null ? 0 : 8;
                    }
                },
                {
                    label: 'Нумизматическая наценка (₽)',
                    data: chartData.premiums,
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    borderWidth: 2,
                    fill: false,
                    tension: 0.1,
                    spanGaps: true, // Connect points across null values
                    pointBackgroundColor: '#10b981',
                    pointBorderColor: '#ffffff',
                    pointBorderWidth: 2,
                    yAxisID: 'y', // Use left Y axis (same as lot price)
                    pointRadius: function(context) {
                        // Hide points with null value (not loaded yet)
                        return context.parsed.y === null ? 0 : 6;
                    },
                    pointHoverRadius: function(context) {
                        return context.parsed.y === null ? 0 : 8;
                    }
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: {
                    display: true,
                    text: 'Динамика цен и нумизматической наценки',
                    font: {
                        size: 16,
                        weight: 'bold'
                    },
                    color: '#374151'
                },
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        usePointStyle: true,
                        padding: 20,
                        font: {
                            size: 12
                        },
                        generateLabels: function(chart) {
                            const original = Chart.defaults.plugins.legend.labels.generateLabels;
                            const labels = original.call(this, chart);
                            
                            // Add axis indicators to legend
                            labels.forEach((label, index) => {
                                if (index === 0 || index === 2) { // Lot price and premium on left axis
                                    label.text = '🔵 ' + label.text + ' (левая ось)';
                                } else { // Gold price on right axis
                                    label.text = '🟡 ' + label.text + ' (правая ось)';
                                }
                            });
                            
                            return labels;
                        }
                    }
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    titleColor: '#ffffff',
                    bodyColor: '#ffffff',
                    borderColor: '#e5e7eb',
                    borderWidth: 1,
                    callbacks: {
                        label: function(context) {
                            const label = context.dataset.label || '';
                            const value = context.parsed.y;
                            
                            // Don't show labels for unloaded data (value = null)
                            if (value === null && (label.includes('золота') || label.includes('наценка'))) {
                                return null;
                            }
                            
                            if (label.includes('Цена лота')) {
                                return `${label}: ${formatPrice(value)}`;
                            } else if (label.includes('Цена золота')) {
                                return `${label}: ${value.toFixed(2)} ₽/г`;
                            } else if (label.includes('наценка')) {
                                const color = value >= 0 ? '🟢' : '🔴';
                                return `${label}: ${color} ${formatPrice(Math.abs(value))}`;
                            }
                            return `${label}: ${value}`;
                        },
                        afterLabel: function(context) {
                            const label = context.dataset.label || '';
                            const value = context.parsed.y;
                            
                            // Add axis information for clarity
                            if (label.includes('золота')) {
                                return '📊 Правая ось';
                            } else if (label.includes('Цена лота') || label.includes('наценка')) {
                                return '📊 Левая ось';
                            }
                            return '';
                        },
                        footer: function(tooltipItems) {
                            // Show additional info if there are multiple lots on the same date
                            const label = tooltipItems[0].label;
                            if (label.includes('(2)') || label.includes('(3)') || label.includes('(4)') || label.includes('(5)')) {
                                return '📅 Несколько лотов в один день';
                            }
                            return '';
                        }
                    }
                }
            },
            scales: {
                x: {
                    display: true,
                    title: {
                        display: true,
                        text: 'Дата аукциона',
                        font: {
                            size: 12,
                            weight: 'bold'
                        },
                        color: '#6b7280'
                    },
                    grid: {
                        color: 'rgba(0, 0, 0, 0.1)'
                    },
                    ticks: {
                        color: '#6b7280',
                        maxRotation: 45,
                        minRotation: 0,
                        callback: function(value, index, ticks) {
                            const label = this.getLabelForValue(value);
                            // Truncate long labels to prevent overlap
                            return label.length > 12 ? label.substring(0, 12) + '...' : label;
                        }
                    }
                },
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    title: {
                        display: true,
                        text: 'Цена лота / Наценка (₽)',
                        font: {
                            size: 12,
                            weight: 'bold'
                        },
                        color: '#3b82f6'
                    },
                    grid: {
                        color: 'rgba(59, 130, 246, 0.1)'
                    },
                    ticks: {
                        color: '#3b82f6',
                        callback: function(value) {
                            return formatPrice(value);
                        }
                    }
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    title: {
                        display: true,
                        text: 'Цена золота (₽/г)',
                        font: {
                            size: 12,
                            weight: 'bold'
                        },
                        color: '#f59e0b'
                    },
                    grid: {
                        drawOnChartArea: false,
                        color: 'rgba(245, 158, 11, 0.1)'
                    },
                    ticks: {
                        color: '#f59e0b',
                        callback: function(value) {
                            return formatPrice(value);
                        }
                    },
                    // Limit the scale to reasonable gold price range
                    min: 0,
                    max: function(context) {
                        const chart = context.chart;
                        const goldData = chart.data.datasets[1].data.filter(val => val > 0);
                        if (goldData.length === 0) return 10000;
                        const maxGold = Math.max(...goldData);
                        return Math.ceil(maxGold * 1.1); // Add 10% padding
                    }
                },
                y2: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    title: {
                        display: true,
                        text: 'Наценка (₽)',
                        font: {
                            size: 12,
                            weight: 'bold'
                        },
                        color: '#10b981'
                    },
                    grid: {
                        drawOnChartArea: false,
                        color: 'rgba(16, 185, 129, 0.1)'
                    },
                    ticks: {
                        color: '#10b981',
                        callback: function(value) {
                            return formatPrice(value);
                        }
                    },
                    // Limit the scale to reasonable premium range
                    min: function(context) {
                        const chart = context.chart;
                        const premiumData = chart.data.datasets[2].data.filter(val => val !== 0);
                        if (premiumData.length === 0) return -50000;
                        const minPremium = Math.min(...premiumData);
                        return Math.floor(minPremium * 1.1); // Add 10% padding
                    },
                    max: function(context) {
                        const chart = context.chart;
                        const premiumData = chart.data.datasets[2].data.filter(val => val !== 0);
                        if (premiumData.length === 0) return 100000;
                        const maxPremium = Math.max(...premiumData);
                        return Math.ceil(maxPremium * 1.1); // Add 10% padding
                    }
                }
            },
            interaction: {
                mode: 'nearest',
                axis: 'x',
                intersect: false
            },
            elements: {
                point: {
                    hoverBackgroundColor: '#ffffff'
                }
            }
        }
    });
    
    // Store the chart for this lot
    priceHistoryCharts.set(lotId, chart);
    
    return chart;
}

function prepareChartData(similarLots) {
    if (!similarLots || similarLots.length === 0) {
        return null;
    }
    
    // Sort lots by auction date
    const sortedLots = similarLots
        .filter(lot => lot.auction_end_date && lot.winning_bid)
        .sort((a, b) => new Date(a.auction_end_date) - new Date(b.auction_end_date));
    
    if (sortedLots.length === 0) {
        return null;
    }
    
    const labels = [];
    const lotPrices = [];
    const goldPrices = [];
    const premiums = [];
    const lotIds = []; // Store lot IDs for later reference
    
    // Process each lot individually - keep it simple
    for (const lot of sortedLots) {
        const date = new Date(lot.auction_end_date);
        const dateStr = date.toLocaleDateString('ru-RU', { 
            day: '2-digit', 
            month: '2-digit', 
            year: '2-digit' 
        });
        
        labels.push(dateStr);
        lotPrices.push(lot.winning_bid);
        lotIds.push(lot.id);
        
        // Initialize with null - will be updated when metal data loads
        goldPrices.push(null);
        premiums.push(null);
    }
    
    return {
        labels,
        lotPrices,
        goldPrices,
        premiums,
        lotIds
    };
}

async function updateChartWithMetalData(currentLotId, lotId, metalData) {
    const chart = priceHistoryCharts.get(currentLotId);
    if (!chart || !metalData) {
        return;
    }
    
    // Find the lot in the chart data by lot ID
    const lotIndex = chart.data.lotIds ? 
        chart.data.lotIds.indexOf(lotId) : -1;
    
    if (lotIndex !== -1) {
        // Extract data from API response format
        const metalPrice = metalData.metal_price ? parseFloat(metalData.metal_price.price_per_gram) : null;
        const premium = metalData.numismatic_premium ? parseFloat(metalData.numismatic_premium.premium) : null;
        
        console.log(`Updating chart for lot ${lotId}:`, {
            lotIndex,
            metalPrice,
            premium,
            metalData
        });
        
        // Update gold price
        if (metalPrice !== null && metalPrice !== undefined) {
            chart.data.datasets[1].data[lotIndex] = metalPrice;
        }
        
        // Update premium
        if (premium !== null && premium !== undefined) {
            chart.data.datasets[2].data[lotIndex] = premium;
        }
        
        // Update the chart
        chart.update('none');
    }
}


// Analytics and Dashboard Functions
let allCurrentAuctionLots = []; // Store all lots for analytics
let allPredictions = new Map(); // Store predictions by lot ID
let bestDealsLots = []; // Store lots that are best deals
let alertsLots = []; // Store lots that are alerts

// View mode state for client-side rendering: 'all' | 'alerts' | 'best-deals'
let currentViewMode = 'all';
let hasShownDefaultAlerts = false; // ensure we auto-show alerts only once on first load

function readCurrentAuctionFiltersForClient() {
    return {
        country: document.getElementById('auction-country-filter')?.value || '',
        metal: document.getElementById('auction-metal-filter')?.value || '',
        rarity: document.getElementById('auction-rarity-filter')?.value || '',
        condition: document.getElementById('auction-condition-filter')?.value || '',
        category: document.getElementById('auction-category-filter')?.value || '',
        mint: document.getElementById('auction-mint-filter')?.value || '',
        yearFrom: document.getElementById('auction-year-from-filter')?.value || '',
        yearTo: document.getElementById('auction-year-to-filter')?.value || '',
        search: document.getElementById('auction-search-filter')?.value || '',
        priceFrom: document.getElementById('auction-price-from-filter')?.value || '',
        priceTo: document.getElementById('auction-price-to-filter')?.value || '',
        sort: document.getElementById('auction-sort-filter')?.value || 'premium-desc'
    };
}

function stringIncludesCI(haystack, needle) {
    if (!needle) return true;
    if (!haystack) return false;
    return haystack.toString().toLowerCase().includes(needle.toString().toLowerCase());
}

function applyLocalFilters(lots) {
    const filters = readCurrentAuctionFiltersForClient();
    let result = Array.isArray(lots) ? lots.slice() : [];

    // Equality filters
    if (filters.metal) result = result.filter(l => (l.metal || '') === filters.metal);
    if (filters.condition) result = result.filter(l => (l.condition || '') === filters.condition);
    if (filters.category) result = result.filter(l => (l.category || '') === filters.category);

    // Text-based filters against description
    if (filters.country) result = result.filter(l => stringIncludesCI(l.coin_description, filters.country));
    if (filters.rarity) result = result.filter(l => stringIncludesCI(l.coin_description, filters.rarity));
    if (filters.mint) result = result.filter(l => stringIncludesCI(l.coin_description, filters.mint));
    if (filters.search) result = result.filter(l => stringIncludesCI(l.coin_description, filters.search));

    // Year range
    const yearFromNum = filters.yearFrom ? parseInt(filters.yearFrom, 10) : null;
    const yearToNum = filters.yearTo ? parseInt(filters.yearTo, 10) : null;
    if (yearFromNum !== null) result = result.filter(l => (parseInt(l.year, 10) || 0) >= yearFromNum);
    if (yearToNum !== null) result = result.filter(l => (parseInt(l.year, 10) || 0) <= yearToNum);

    // Price range (use winning_bid when available)
    const priceFromNum = filters.priceFrom ? parseFloat(filters.priceFrom) : null;
    const priceToNum = filters.priceTo ? parseFloat(filters.priceTo) : null;
    if (priceFromNum !== null) result = result.filter(l => (parseFloat(l.winning_bid) || 0) >= priceFromNum);
    if (priceToNum !== null) result = result.filter(l => (parseFloat(l.winning_bid) || 0) <= priceToNum);

    // Sorting
    switch (filters.sort) {
        case 'premium-desc':
            result.sort((a, b) => (b.premium || 0) - (a.premium || 0));
            break;
        case 'premium-asc':
            result.sort((a, b) => (a.premium || 0) - (b.premium || 0));
            break;
        case 'price-desc':
            result.sort((a, b) => (parseFloat(b.winning_bid) || 0) - (parseFloat(a.winning_bid) || 0));
            break;
        case 'price-asc':
            result.sort((a, b) => (parseFloat(a.winning_bid) || 0) - (parseFloat(b.winning_bid) || 0));
            break;
        case 'year-desc':
            result.sort((a, b) => (parseInt(b.year, 10) || 0) - (parseInt(a.year, 10) || 0));
            break;
        case 'year-asc':
            result.sort((a, b) => (parseInt(a.year, 10) || 0) - (parseInt(b.year, 10) || 0));
            break;
        case 'weight-desc':
            result.sort((a, b) => (parseFloat(b.weight) || 0) - (parseFloat(a.weight) || 0));
            break;
        case 'weight-asc':
            result.sort((a, b) => (parseFloat(a.weight) || 0) - (parseFloat(b.weight) || 0));
            break;
        default:
            break;
    }

    return result;
}

// Function to analyze all lots in the auction and categorize them
async function analyzeAllAuctionLots(auctionNumber) {
    try {
        console.log('Analyzing all lots for auction:', auctionNumber);
        
        // Get all lots for the auction using the working API with large limit
        const response = await fetch(`/api/current-auction?page=1&limit=1000`);
        if (!response.ok) {
            throw new Error('Failed to fetch all lots');
        }
        
        const data = await response.json();
        const allLots = data.lots || [];
        
        console.log(`Found ${allLots.length} lots in auction ${auctionNumber}`);
        
        // Clear previous categories
        bestDealsLots = [];
        alertsLots = [];
        
        // Analyze each lot
        allLots.forEach(lot => {
            const prediction = allPredictions.get(lot.id);
            
            // Only analyze lots with both winning bid and prediction
            if (lot.winning_bid && lot.winning_bid > 0 && 
                prediction && prediction.predicted_price && prediction.predicted_price > 0) {
                
                const premium = ((lot.winning_bid - prediction.predicted_price) / prediction.predicted_price) * 100;
                
                // Categorize based on premium
                if (premium >= -10 && premium <= -1) {
                    // Best deals: 1% to 10% below predicted price
                    bestDealsLots.push({
                        ...lot,
                        premium: premium,
                        predicted_price: prediction.predicted_price
                    });
                } else if (premium < -10) {
                    // Alerts: more than 10% below predicted price
                    alertsLots.push({
                        ...lot,
                        premium: premium,
                        predicted_price: prediction.predicted_price
                    });
                }
            }
        });
        
        console.log(`Best deals: ${bestDealsLots.length}, Alerts: ${alertsLots.length}`);
        
        // Update analytics dashboard
        updateAnalyticsDashboard();
        
    } catch (error) {
        console.error('Error analyzing auction lots:', error);
    }
}

// Function to update analytics dashboard with counts
function updateAnalyticsDashboard() {
    try {
        // Update counts in the dashboard
        document.getElementById('best-deals').textContent = bestDealsLots.length;
        document.getElementById('alerts-count').textContent = alertsLots.length;
        
        console.log(`Dashboard updated: Best deals: ${bestDealsLots.length}, Alerts: ${alertsLots.length}`);
    } catch (error) {
        console.error('Error updating analytics dashboard:', error);
    }
}

// Function to update premium badge for filtered lots
function updatePremiumBadgeForFilteredLot(lotId, premium) {
    const premiumBadgeContainer = document.getElementById(`premium-badge-${lotId}`);
    if (!premiumBadgeContainer) return;
    
    let badgeClass = 'bg-gray-100 text-gray-800';
    let badgeIcon = 'fas fa-minus';
    let badgeText = 'Н/Д';
    
    if (premium !== undefined && premium !== null) {
        const premiumPercent = Math.abs(premium).toFixed(1);
        
        if (premium >= -10 && premium <= -1) {
            // Best deals: 1% to 10% below predicted
            badgeClass = 'bg-green-100 text-green-800';
            badgeIcon = 'fas fa-check-circle';
            badgeText = `-${premiumPercent}%`;
        } else if (premium < -10) {
            // Alerts: more than 10% below predicted
            badgeClass = 'bg-red-100 text-red-800';
            badgeIcon = 'fas fa-exclamation-triangle';
            badgeText = `-${premiumPercent}%`;
        } else if (premium > 0) {
            // Above predicted price
            badgeClass = 'bg-yellow-100 text-yellow-800';
            badgeIcon = 'fas fa-arrow-up';
            badgeText = `+${premiumPercent}%`;
        } else {
            // Close to predicted price
            badgeClass = 'bg-blue-100 text-blue-800';
            badgeIcon = 'fas fa-equals';
            badgeText = `${premiumPercent}%`;
        }
    }
    
    premiumBadgeContainer.innerHTML = `
        <div class="flex items-center space-x-1">
            <i class="${badgeIcon} text-xs"></i>
            <span class="px-2 py-1 rounded-full text-xs font-medium ${badgeClass}">
                ${badgeText}
            </span>
        </div>
    `;
}

// Simple analytics function that works with current page data
function updateSimpleAnalytics(response) {
    try {
        const lots = response.lots || [];
        
        // Get total lots from pagination info if available, otherwise use current page count
        const totalLots = response.pagination?.total || lots.length;
        
        // Update total lots count
        document.getElementById('total-lots').textContent = totalLots;
        
        if (lots.length === 0) {
            document.getElementById('avg-premium').textContent = '-';
            // Don't update best-deals and alerts-count here - they are managed by updateAnalyticsDashboard()
            return;
        }
        
        // Calculate basic statistics from current page
        const lotsWithBids = lots.filter(lot => lot.winning_bid && lot.winning_bid > 0);
        
        // Count lots with predictions from our global predictions map
        const lotsWithPredictions = lots.filter(lot => {
            const prediction = allPredictions.get(lot.id);
            return prediction && prediction.predicted_price && prediction.predicted_price > 0;
        });
        
        // Debug: log lot structure to see what fields are available
        if (lots.length > 0) {
            console.log('Sample lot structure:', lots[0]);
            console.log('Lots with bids:', lotsWithBids.length);
            console.log('Lots with predictions:', lotsWithPredictions.length);
            console.log('Total predictions in memory:', allPredictions.size);
        }
        
        // Calculate average premium (simplified)
        let totalPremium = 0;
        let premiumCount = 0;
        
        lotsWithBids.forEach(lot => {
            const prediction = allPredictions.get(lot.id);
            if (prediction && prediction.predicted_price && prediction.predicted_price > 0) {
                const premium = ((lot.winning_bid - prediction.predicted_price) / prediction.predicted_price) * 100;
                totalPremium += premium;
                premiumCount++;
            }
        });
        
        const avgPremium = premiumCount > 0 ? (totalPremium / premiumCount).toFixed(1) : '-';
        document.getElementById('avg-premium').textContent = avgPremium + (avgPremium !== '-' ? '%' : '');
        
        // Count best deals (lots with premium from 1% to 10% below predicted price)
        // Don't update best-deals and alerts-count here - they are managed by updateAnalyticsDashboard()
        // The counts are calculated from all auction lots, not just current page
        
    } catch (error) {
        console.error('Error updating simple analytics:', error);
        // Set default values on error
        document.getElementById('total-lots').textContent = '0';
        document.getElementById('avg-premium').textContent = '-';
        // Don't update best-deals and alerts-count here - they are managed by updateAnalyticsDashboard()
    }
}

async function updateAuctionAnalytics() {
    try {
        console.log('Loading analytics...');
        // Try to fetch all lots from current auction (no limits for analytics)
        const response = await fetch('/api/current-auction-all');
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        console.log('Analytics API response:', data);
        
        if (data.lots && data.lots.length > 0) {
            allCurrentAuctionLots = data.lots;
            const lots = data.lots;
            const totalLots = lots.length;
            
            document.getElementById('total-lots').textContent = totalLots;
            document.getElementById('avg-premium').textContent = 'Загрузка...';
            document.getElementById('best-deals').textContent = 'Загрузка...';
            document.getElementById('alerts-count').textContent = 'Загрузка...';
            
            const lotsWithBids = lots.filter(lot => lot.winning_bid && lot.winning_bid > 0);
            const lotsToProcess = lotsWithBids;
            
            let totalPriceDifference = 0;
            let predictionCount = 0;
            let bestDealsCount = 0;
            let alertsCount = 0;
            
            const predictionPromises = lotsToProcess.map(async (lot) => {
                try {
                    const predictionResponse = await fetch(`/api/prediction/${lot.id}`);
                    if (predictionResponse.ok) {
                        const predictionData = await predictionResponse.json();
                        if (predictionData.predicted_price && predictionData.predicted_price > 0) {
                            const currentPrice = parseFloat(lot.winning_bid);
                            const predictedPrice = parseFloat(predictionData.predicted_price);
                            const priceDifference = ((currentPrice - predictedPrice) / predictedPrice) * 100;
                            return {
                                priceDifference,
                                isBestDeal: priceDifference <= 0 && priceDifference >= -10,
                                isAlert: priceDifference < -10
                            };
                        }
                    }
                } catch (error) {
                    console.log(`Could not get prediction for lot ${lot.id}:`, error);
                }
                return null;
            });
            
            const predictionResults = await Promise.all(predictionPromises);
            predictionResults.forEach(result => {
                if (result) {
                    totalPriceDifference += result.priceDifference;
                    predictionCount++;
                    if (result.isBestDeal) bestDealsCount++;
                    if (result.isAlert) alertsCount++;
                }
            });
            
            const avgPriceDifference = predictionCount > 0 ? totalPriceDifference / predictionCount : 0;
            document.getElementById('avg-premium').textContent = `${avgPriceDifference.toFixed(1)}%`;
            document.getElementById('best-deals').textContent = bestDealsCount;
            document.getElementById('alerts-count').textContent = alertsCount;

            // Auto-show Alerts once on first analytics load
            if (!hasShownDefaultAlerts) {
                hasShownDefaultAlerts = true;
                currentViewMode = 'alerts';
                await showAlerts();
            }
        } else {
            document.getElementById('total-lots').textContent = '0';
            document.getElementById('avg-premium').textContent = '-';
            document.getElementById('best-deals').textContent = '0';
            document.getElementById('alerts-count').textContent = '0';
        }
    } catch (error) {
        console.error('Error updating analytics:', error);
        console.log('Setting analytics to error state');
        document.getElementById('total-lots').textContent = '0';
        document.getElementById('avg-premium').textContent = '-';
        document.getElementById('best-deals').textContent = '0';
        document.getElementById('alerts-count').textContent = '0';
    }
}

function updateAnalyticsFromPageData() {
    // Use allCurrentAuctionLots if available, otherwise fall back to displayed lots
    let lotsToAnalyze = allCurrentAuctionLots.length > 0 ? allCurrentAuctionLots : [];
    
    if (lotsToAnalyze.length === 0) {
        // Fallback to displayed lots
        const lotElements = document.querySelectorAll('#currentAuctionLotsList > div');
        lotsToAnalyze = Array.from(lotElements).map(element => {
            // Try to extract lot data from the element
            const lotId = element.id.replace('lot-', '');
            const titleElement = element.querySelector('h3');
            const priceElement = element.querySelector('.text-2xl');
            const metalElement = element.querySelector('.metal-badge');
            
            return {
                id: lotId,
                title: titleElement ? titleElement.textContent : '',
                winning_bid: priceElement ? parseFloat(priceElement.textContent.replace(/[^\d]/g, '')) : 0,
                metal: metalElement ? metalElement.textContent.toLowerCase() : ''
            };
        });
    }
    
    const totalLots = lotsToAnalyze.length;
    
    if (totalLots > 0) {
        document.getElementById('total-lots').textContent = totalLots;
        
        // Try to get premium data from displayed lots (if we're using fallback)
        if (allCurrentAuctionLots.length === 0) {
            let premiumCount = 0;
            let totalPremium = 0;
            let bestDealsCount = 0;
            let alertsCount = 0;
            
            // Check for premium badges in displayed lots
            const premiumBadges = document.querySelectorAll('[id^="premium-badge-"]');
            premiumBadges.forEach(badge => {
                const badgeText = badge.textContent;
                if (badgeText && badgeText.includes('₽')) {
                    // Extract premium value from badge text
                    const premiumMatch = badgeText.match(/([+-]?\d+(?:,\d{3})*(?:\.\d{2})?)\s*₽/);
                    if (premiumMatch) {
                        const premium = parseFloat(premiumMatch[1].replace(/,/g, ''));
                        if (!isNaN(premium)) {
                            totalPremium += premium;
                            premiumCount++;
                            
                            // Note: Best deals and alerts calculation is now handled with prediction-based logic
                            // Note: Alert calculation is handled in updateAuctionAnalytics() with API data
                        }
                    }
                }
            });
            
            const avgPremium = premiumCount > 0 ? totalPremium / premiumCount : 0;
            
            document.getElementById('avg-premium').textContent = formatPrice(avgPremium);
            document.getElementById('best-deals').textContent = bestDealsCount;
            document.getElementById('alerts-count').textContent = alertsCount;
        } else {
            // We have allCurrentAuctionLots, show loading state for premium data
            document.getElementById('avg-premium').textContent = 'Загрузка...';
            document.getElementById('best-deals').textContent = 'Загрузка...';
            document.getElementById('alerts-count').textContent = 'Загрузка...';
        }
    } else {
        // No data available
        document.getElementById('total-lots').textContent = '0';
        document.getElementById('avg-premium').textContent = '-';
        document.getElementById('best-deals').textContent = '0';
        document.getElementById('alerts-count').textContent = '0';
    }
}

function applyCurrentFilters() {
    if (allCurrentAuctionLots.length === 0) {
        console.log('No lots available for filtering');
        return;
    }
    
    const metalFilter = document.getElementById('metal-filter')?.value || 'all';
    const sortFilter = document.getElementById('sort-filter')?.value || 'lot-number';
    
    const filteredLots = applyFiltersAndSort(allCurrentAuctionLots, metalFilter, sortFilter);
    
    // Update the display with filtered results
    displayCurrentAuctionResults({
        lots: filteredLots,
        currentAuctionNumber: allCurrentAuctionLots.length > 0 ? allCurrentAuctionLots[0].auction_number : null,
        pagination: {
            page: 1,
            limit: 12,
            total: filteredLots.length,
            pages: 1
        }
    });
    
    // Update analytics for filtered results
    updateAnalyticsForFilteredLots(filteredLots);
}

async function updateAnalyticsForFilteredLots(filteredLots) {
    // Don't update analytics here - it's managed by updateAnalyticsDashboard()
}

function applyFiltersAndSort(lots, metalFilter, sortFilter) {
    let filteredLots = [...lots];
    
    // Apply metal filter
    if (metalFilter && metalFilter !== 'all') {
        filteredLots = filteredLots.filter(lot => 
            lot.metal && lot.metal.toLowerCase().includes(metalFilter.toLowerCase())
        );
    }
    
    // Apply sorting
    switch (sortFilter) {
        case 'lot-number':
            filteredLots.sort((a, b) => (a.lot_number || 0) - (b.lot_number || 0));
            break;
        case 'price-asc':
            filteredLots.sort((a, b) => (a.winning_bid || 0) - (b.winning_bid || 0));
            break;
        case 'price-desc':
            filteredLots.sort((a, b) => (b.winning_bid || 0) - (a.winning_bid || 0));
            break;
        case 'premium-asc':
            // Sort by premium (ascending - best deals first)
            filteredLots.sort((a, b) => {
                const premiumA = a.numismatic_premium || 0;
                const premiumB = b.numismatic_premium || 0;
                return premiumA - premiumB;
            });
            break;
        case 'premium-desc':
            // Sort by premium (descending - highest premium first)
            filteredLots.sort((a, b) => {
                const premiumA = a.numismatic_premium || 0;
                const premiumB = b.numismatic_premium || 0;
                return premiumB - premiumA;
            });
            break;
        case 'weight-asc':
            filteredLots.sort((a, b) => (a.weight || 0) - (b.weight || 0));
            break;
        case 'weight-desc':
            filteredLots.sort((a, b) => (b.weight || 0) - (a.weight || 0));
            break;
    }
    
    return filteredLots;
}

async function showBestDeals() {
    try {
        console.log('showBestDeals called');
        currentViewMode = 'best-deals';
        if (bestDealsLots.length === 0) {
            console.log('No best deals found');
            showNotification('Лучшие предложения не найдены', 'info');
            return;
        }

        const filtered = applyLocalFilters(bestDealsLots);
        console.log(`Showing ${filtered.length} best deals (filtered)`);

        // Clear current display
        elements.currentAuctionLotsList.innerHTML = '';

        // Display filtered best deals
        filtered.forEach(lot => {
            const lotElement = createCurrentAuctionLotElement(lot);
            elements.currentAuctionLotsList.appendChild(lotElement);

            const fullPrediction = allPredictions.get(lot.id);
            if (fullPrediction && fullPrediction.predicted_price) {
                displayLotPrediction(lot.id, {
                    ...fullPrediction,
                    current_bid_amount: lot.current_bid_amount,
                    winning_bid: lot.winning_bid
                });
                updatePremiumBadgeForFilteredLot(lot.id, lot.premium);
            }
        });

        document.getElementById('currentAuctionResultsCount').textContent = `Найдено ${filtered.length} лучших предложений`;
        elements.currentAuctionPagination.classList.add('hidden');
        showNotification(`Показано ${filtered.length} лучших предложений`, 'success');
    } catch (error) {
        console.error('Error showing best deals:', error);
        showNotification('Ошибка при загрузке лучших предложений', 'error');
    }
}

async function showAlerts() {
    try {
        console.log('showAlerts called');
        currentViewMode = 'alerts';
        if (alertsLots.length === 0) {
            console.log('No alerts found');
            showNotification('Алерты не найдены', 'info');
            return;
        }

        const filtered = applyLocalFilters(alertsLots);
        console.log(`Showing ${filtered.length} alerts (filtered)`);

        elements.currentAuctionLotsList.innerHTML = '';

        filtered.forEach(lot => {
            const lotElement = createCurrentAuctionLotElement(lot);
            elements.currentAuctionLotsList.appendChild(lotElement);

            const fullPrediction = allPredictions.get(lot.id);
            if (fullPrediction && fullPrediction.predicted_price) {
                displayLotPrediction(lot.id, {
                    ...fullPrediction,
                    current_bid_amount: lot.current_bid_amount,
                    winning_bid: lot.winning_bid
                });
                updatePremiumBadgeForFilteredLot(lot.id, lot.premium);
            }
        });

        document.getElementById('currentAuctionResultsCount').textContent = `Найдено ${filtered.length} алертов`;
        elements.currentAuctionPagination.classList.add('hidden');
        showNotification(`Показано ${filtered.length} алертов`, 'success');
    } catch (error) {
        console.error('Error showing alerts:', error);
        showNotification('Ошибка при загрузке алертов', 'error');
    }
}

function isInWatchlist(lotId) {
    const watchlist = JSON.parse(localStorage.getItem('watchlist') || '[]');
    return watchlist.includes(lotId);
}

async function addToWatchlist(lotId) {
    try {
        // Check if already in watchlist
        if (isInWatchlist(lotId)) {
            showNotification('Лот уже в избранном', 'info');
            return;
        }
        
        // Add to localStorage watchlist
        let watchlist = JSON.parse(localStorage.getItem('watchlist') || '[]');
        watchlist.push(lotId);
        localStorage.setItem('watchlist', JSON.stringify(watchlist));
        
        // Update watchlist count
        updateWatchlistCount();
        
        // Update button appearance
        updateWatchlistButton(lotId, true);
        
        // Add to database watchlist
        const token = localStorage.getItem('token');
        if (token) {
            try {
                const response = await fetch('/api/watchlist', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({ lotId: lotId })
                });
                
                if (response.ok) {
                    const result = await response.json();
                    console.log('✅ Лот добавлен в БД избранное:', result);
                } else {
                    console.error('❌ Ошибка добавления в БД избранное:', response.status);
                }
            } catch (error) {
                console.error('❌ Ошибка API добавления в избранное:', error);
            }
        }
        
        // Show notification
        showNotification('Лот добавлен в избранное', 'success');
    } catch (error) {
        console.error('❌ Ошибка добавления в избранное:', error);
        showNotification('Ошибка добавления в избранное', 'error');
    }
}

function updateWatchlistButton(lotId, isInWatchlist) {
    const lotElement = document.querySelector(`[data-lot-id="${lotId}"]`);
    if (!lotElement) return;
    
    const watchlistButton = lotElement.querySelector('button[onclick*="addToWatchlist"]');
    if (!watchlistButton) return;
    
    if (isInWatchlist) {
        watchlistButton.innerHTML = '<i class="fas fa-star mr-1"></i>В избранном';
        watchlistButton.className = 'bg-green-500 hover:bg-green-600 text-white px-3 py-2 rounded-lg transition-colors text-sm flex items-center';
        watchlistButton.onclick = () => showNotification('Лот уже в избранном', 'info');
    } else {
        watchlistButton.innerHTML = '<i class="fas fa-star mr-1"></i>В избранное';
        watchlistButton.className = 'bg-yellow-500 hover:bg-yellow-600 text-white px-3 py-2 rounded-lg transition-colors text-sm flex items-center';
        watchlistButton.onclick = () => addToWatchlist(lotId);
    }
}

async function removeFromWatchlist(lotId) {
    try {
        // Remove from localStorage watchlist
        let watchlist = JSON.parse(localStorage.getItem('watchlist') || '[]');
        watchlist = watchlist.filter(id => id !== lotId);
        localStorage.setItem('watchlist', JSON.stringify(watchlist));
        
        // Update watchlist count
        updateWatchlistCount();
        
        // Remove from database watchlist
        const token = localStorage.getItem('token');
        if (token) {
            try {
                const response = await fetch(`/api/watchlist/${lotId}`, {
                    method: 'DELETE',
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });
                
                if (response.ok) {
                    const result = await response.json();
                    console.log('✅ Лот удален из БД избранного:', result);
                } else {
                    console.error('❌ Ошибка удаления из БД избранного:', response.status);
                }
            } catch (error) {
                console.error('❌ Ошибка API удаления из избранного:', error);
            }
        }
        
        // Show notification
        showNotification('Лот удален из избранного', 'info');
        
        // Always refresh watchlist if currently viewing
        if (document.getElementById('watchlistSection').classList.contains('active')) {
            loadWatchlist();
        }
    } catch (error) {
        console.error('❌ Ошибка удаления из избранного:', error);
        showNotification('Ошибка удаления из избранного', 'error');
    }
}

function updateWatchlistCount() {
    const watchlist = JSON.parse(localStorage.getItem('watchlist') || '[]');
    const countElement = document.getElementById('watchlistCount');
    if (countElement) {
        countElement.textContent = watchlist.length;
        countElement.style.display = watchlist.length > 0 ? 'inline' : 'none';
    }
}

async function loadWatchlist() {
    console.log('Loading watchlist...');
    const watchlistSection = document.getElementById('watchlistSection');
    const watchlistEmpty = document.getElementById('watchlistEmpty');
    const watchlistLoading = document.getElementById('watchlistLoading');
    const watchlistLots = document.getElementById('watchlistLots');
    
    // Show loading state
    watchlistLoading.classList.remove('hidden');
    watchlistEmpty.classList.add('hidden');
    watchlistLots.classList.add('hidden');
    
    try {
        // Check if user is authenticated
        const token = localStorage.getItem('token');
        if (!token) {
            console.log('❌ Пользователь не авторизован, загружаем из localStorage');
            // Fallback to localStorage
            const watchlist = JSON.parse(localStorage.getItem('watchlist') || '[]');
            await loadWatchlistFromLocalStorage(watchlist);
            return;
        }
        
        // Load from database
        console.log('📊 Загружаем избранное из БД...');
        console.log('🔑 Токен для запроса:', token ? `${token.substring(0, 20)}...` : 'отсутствует');
        
        const response = await fetch('/api/watchlist', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        console.log('📥 Ответ сервера:', response.status, response.statusText);
        console.log('📥 Content-Type:', response.headers.get('content-type'));
        
        if (response.ok) {
            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
                console.error('❌ Сервер вернул не JSON:', contentType);
                const text = await response.text();
                console.error('❌ Содержимое ответа:', text.substring(0, 200));
                throw new Error('Сервер вернул не JSON ответ');
            }
            
            const data = await response.json();
            const lots = data.lots || [];
            
            console.log(`📊 Загружено ${lots.length} лотов из БД`);
            
            if (lots.length === 0) {
                // Show empty state
                watchlistLoading.classList.add('hidden');
                watchlistEmpty.classList.remove('hidden');
                return;
            }
            
            // Display lots
            watchlistLots.innerHTML = '';
            lots.forEach(lot => {
                const lotCard = createWatchlistLotCard(lot);
                watchlistLots.appendChild(lotCard);
            });
            
            // Show results
            watchlistLoading.classList.add('hidden');
            watchlistLots.classList.remove('hidden');
            
            // Sync localStorage with database
            const lotIds = lots.map(lot => lot.id);
            localStorage.setItem('watchlist', JSON.stringify(lotIds));
            updateWatchlistCount();
            
            // Автоматически загружаем прогнозы и рискованность для всех лотов из избранного
            console.log('🔄 Автоматически загружаем прогнозы для лотов из избранного (БД)...');
            updateWatchlistPredictions(lotIds).then(results => {
                const successful = results.filter(r => r.success).length;
                console.log(`✅ Загружено ${successful} прогнозов для лотов из избранного (БД)`);
            });
            
            console.log('🔄 Автоматически загружаем рискованность для лотов из избранного (БД)...');
            updateWatchlistRisks(lotIds).then(results => {
                const successful = results.filter(r => r.success).length;
                console.log(`✅ Загружена рискованность для ${successful} лотов из избранного (БД)`);
            });
            
        } else {
            console.error('❌ Ошибка загрузки из БД:', response.status);
            // Fallback to localStorage
            const watchlist = JSON.parse(localStorage.getItem('watchlist') || '[]');
            await loadWatchlistFromLocalStorage(watchlist);
        }
        
    } catch (error) {
        console.error('❌ Ошибка загрузки избранного:', error);
        // Fallback to localStorage
        const watchlist = JSON.parse(localStorage.getItem('watchlist') || '[]');
        await loadWatchlistFromLocalStorage(watchlist);
    }
}

async function loadWatchlistFromLocalStorage(watchlist) {
    const watchlistEmpty = document.getElementById('watchlistEmpty');
    const watchlistLoading = document.getElementById('watchlistLoading');
    const watchlistLots = document.getElementById('watchlistLots');
    
    console.log('📊 Загружаем избранное из localStorage:', watchlist);
    
    if (watchlist.length === 0) {
        // Show empty state
        watchlistLoading.classList.add('hidden');
        watchlistEmpty.classList.remove('hidden');
        return;
    }
    
    // Load lot details for each watchlist item
    try {
        const responses = await Promise.all(watchlist.map(lotId => fetch(`/api/lots/${lotId}`)));
        const lots = await Promise.all(responses.map(res => res.json()));
        
        // Filter out any failed requests
        const validLots = lots.filter(lot => lot && lot.id);
        
        if (validLots.length === 0) {
            watchlistLoading.classList.add('hidden');
            watchlistEmpty.classList.remove('hidden');
            return;
        }
        
        // Display lots
        watchlistLots.innerHTML = '';
        validLots.forEach(lot => {
            const lotCard = createWatchlistLotCard(lot);
            watchlistLots.appendChild(lotCard);
        });
        
        // Show results
        watchlistLoading.classList.add('hidden');
        watchlistLots.classList.remove('hidden');
        
        // Автоматически загружаем прогнозы и рискованность для всех лотов из избранного
        console.log('🔄 Автоматически загружаем прогнозы для лотов из избранного...');
        const lotIds = validLots.map(lot => lot.id);
        updateWatchlistPredictions(lotIds).then(results => {
            const successful = results.filter(r => r.success).length;
            console.log(`✅ Загружено ${successful} прогнозов для лотов из избранного`);
        });
        
        console.log('🔄 Автоматически загружаем рискованность для лотов из избранного...');
        updateWatchlistRisks(lotIds).then(results => {
            const successful = results.filter(r => r.success).length;
            console.log(`✅ Загружена рискованность для ${successful} лотов из избранного`);
        });
        
    } catch (error) {
        console.error('Error loading watchlist from localStorage:', error);
        watchlistLoading.classList.add('hidden');
        watchlistEmpty.classList.remove('hidden');
        showNotification('Ошибка загрузки избранного', 'error');
    }
}

function createWatchlistLotCard(lot) {
    // Используем точно ту же функцию, что и для аукционных лотов
    const lotElement = createCurrentAuctionLotElement(lot);
    
    // Добавляем кнопки в секцию кнопок
    const actionButtons = lotElement.querySelector('.flex.items-center.justify-center.pt-4.border-t');
    if (actionButtons) {
        const leftButtons = actionButtons.querySelector('.flex.space-x-2');
        
        // Добавляем кнопку "Моя ставка"
        const bidButton = document.createElement('button');
        bidButton.innerHTML = '<i class="fas fa-gavel"></i>';
        bidButton.className = 'bg-green-500 hover:bg-green-600 text-white px-3 py-2 rounded-lg transition-colors text-sm';
        bidButton.title = 'Моя ставка';
        bidButton.onclick = () => showBidModal(lot);
        
        // Добавляем кнопку удаления из избранного
        const removeButton = document.createElement('button');
        removeButton.innerHTML = '<i class="fas fa-times"></i>';
        removeButton.className = 'bg-red-500 hover:bg-red-600 text-white px-3 py-2 rounded-lg transition-colors text-sm';
        removeButton.title = 'Удалить из избранного';
        removeButton.onclick = () => removeFromWatchlist(lot.id);
        
        // Добавляем кнопки в начало секции кнопок
        leftButtons.prepend(bidButton);
        leftButtons.prepend(removeButton);
    }
    
    return lotElement;
}

function clearWatchlist() {
    if (confirm('Вы уверены, что хотите очистить все избранное?')) {
        localStorage.removeItem('watchlist');
        updateWatchlistCount();
        loadWatchlist();
        showNotification('Избранное очищено', 'info');
    }
}

// Полное обновление данных лотов из избранного (ставки + прогнозы + цвета)
async function updateWatchlistData() {
    try {
        console.log('🔄 Полное обновление данных лотов из избранного...');
        
        const watchlist = JSON.parse(localStorage.getItem('watchlist') || '[]');
        console.log('📊 Избранное из localStorage:', watchlist);
        
        if (watchlist.length === 0) {
            console.log('❌ Избранное пусто');
            showNotification('Избранное пусто', 'info');
            return;
        }
        
        console.log(`📊 Найдено ${watchlist.length} лотов в избранном для обновления`);
        
        // Проверяем токен
        const token = localStorage.getItem('token');
        console.log('🔑 Токен авторизации:', token ? 'есть' : 'отсутствует');
        
        if (!token) {
            console.log('❌ Токен авторизации отсутствует');
            showNotification('Необходимо войти в систему', 'error');
            return;
        }
        
        // Показываем уведомление о начале обновления
        showNotification(`Полное обновление ${watchlist.length} лотов из избранного...`, 'info');
        
        // Шаг 1: Обновляем ставки (фоновый режим)
        console.log('📤 Шаг 1: Обновляем ставки...');
        const bidsResponse = await fetch('/api/watchlist/update-lots', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                lotIds: watchlist
            })
        });
        
        if (!bidsResponse.ok) {
            throw new Error(`Ошибка обновления ставок: ${bidsResponse.status}`);
        }
        
        // Шаг 2: Пересчитываем прогнозы для всех лотов
        console.log('📤 Шаг 2: Пересчитываем прогнозы...');
        const predictionsResponse = await fetch('/api/watchlist/recalculate-predictions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                lotIds: watchlist
            })
        });
        
        if (!predictionsResponse.ok) {
            console.log('⚠️ Ошибка пересчета прогнозов, загружаем существующие...');
            await updateWatchlistPredictions(watchlist);
        } else {
            console.log('✅ Пересчет прогнозов запущен в фоновом режиме');
        }
        
        // Шаг 3: Загружаем рискованность для всех лотов
        console.log('📤 Шаг 3: Загружаем рискованность лотов...');
        await updateWatchlistRisks(watchlist);
        
        // Шаг 4: Перезагружаем избранное с обновленными данными
        console.log('📤 Шаг 4: Перезагружаем избранное...');
        await loadWatchlist();
        
        showNotification('Данные избранного обновлены!', 'success');
        
    } catch (error) {
        console.error('Ошибка полного обновления избранного:', error);
        showNotification(`Ошибка обновления: ${error.message}`, 'error');
    }
}

// Обновление рискованности для лотов из избранного
async function updateWatchlistRisks(lotIds) {
    console.log(`🔄 Обновляем рискованность для ${lotIds.length} лотов...`);
    
    const riskPromises = lotIds.map(async (lotId) => {
        try {
            const riskData = await loadLotRisk(lotId);
            if (riskData) {
                renderRiskIndicator(lotId, riskData);
                return { lotId, success: true, riskData };
            } else {
                return { lotId, success: false, error: 'Нет данных' };
            }
        } catch (error) {
            console.error(`❌ Ошибка загрузки рискованности для лота ${lotId}:`, error);
            return { lotId, success: false, error: error.message };
        }
    });
    
    const results = await Promise.all(riskPromises);
    const successful = results.filter(r => r.success).length;
    console.log(`📊 Загружена рискованность для ${successful} из ${lotIds.length} лотов`);
    
    return results;
}

// Обновление прогнозов для лотов из избранного
async function updateWatchlistPredictions(lotIds) {
    console.log(`🔄 Обновляем прогнозы для ${lotIds.length} лотов...`);
    
    const predictionPromises = lotIds.map(async (lotId) => {
        try {
            console.log(`📊 Загружаем прогноз для лота ${lotId}...`);
            const response = await fetch(`/api/prediction/${lotId}`);
            
            if (response.ok) {
                const prediction = await response.json();
                console.log(`✅ Прогноз для лота ${lotId}:`, prediction.predicted_price);
                
                // Обновляем цветовую схему плашки
                updateBidStatusColors(lotId, prediction);
                
                return { lotId, success: true, prediction };
            } else {
                console.log(`❌ Ошибка загрузки прогноза для лота ${lotId}:`, response.status);
                return { lotId, success: false, error: response.status };
            }
        } catch (error) {
            console.error(`❌ Ошибка прогноза для лота ${lotId}:`, error);
            return { lotId, success: false, error: error.message };
        }
    });
    
    const results = await Promise.all(predictionPromises);
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    
    console.log(`📊 Результаты обновления прогнозов: ${successful} успешно, ${failed} с ошибками`);
    
    return results;
}

// Обновление данных лотов из избранного (старая функция для совместимости)
async function updateWatchlistLots() {
    // Перенаправляем на новую функцию полного обновления
    await updateWatchlistData();
}

function getMetalColor(metal) {
    const metalColors = {
        'Au': '#FFD700', // Gold
        'Ag': '#C0C0C0', // Silver
        'Pt': '#E5E4E2', // Platinum
        'Pd': '#B4B4B4'  // Palladium
    };
    return metalColors[metal] || '#6B7280'; // Default gray
}

function shareLot(lotId) {
    const url = `${window.location.origin}${window.location.pathname}#lot-${lotId}`;
    if (navigator.share) {
        navigator.share({
            title: `Лот ${lotId}`,
            text: 'Посмотрите этот интересный лот на аукционе',
            url: url
        });
    } else {
        navigator.clipboard.writeText(url).then(() => {
            showNotification('Ссылка скопирована в буфер обмена', 'success');
        });
    }
}

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `fixed top-4 right-4 z-50 p-4 rounded-lg shadow-lg transition-all duration-300 ${
        type === 'success' ? 'bg-green-500 text-white' :
        type === 'error' ? 'bg-red-500 text-white' :
        type === 'warning' ? 'bg-yellow-500 text-white' :
        'bg-blue-500 text-white'
    }`;
    
    notification.innerHTML = `
        <div class="flex items-center">
            <i class="fas fa-${type === 'success' ? 'check' : type === 'error' ? 'times' : type === 'warning' ? 'exclamation' : 'info'}-circle mr-2"></i>
            <span>${message}</span>
        </div>
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transform = 'translateX(100%)';
        setTimeout(() => {
            document.body.removeChild(notification);
        }, 300);
    }, 3000);
}

// Event listeners for new functionality
document.addEventListener('DOMContentLoaded', function() {
    // Filter and sort event listeners
    const metalFilter = document.getElementById('metal-filter');
    const sortFilter = document.getElementById('sort-filter');
    const showBestDealsBtn = document.getElementById('show-best-deals');
    const showAlertsBtn = document.getElementById('show-alerts');
    const clearFiltersBtn = document.getElementById('clear-filters');
    const refreshAuctionBtn = document.getElementById('refresh-auction');
    const exportAuctionBtn = document.getElementById('export-auction');
    
    // Auction page filters (current auction)
    const auctionFilterIds = [
        'auction-country-filter',
        'auction-metal-filter',
        'auction-rarity-filter',
        'auction-condition-filter',
        'auction-category-filter',
        'auction-mint-filter',
        'auction-year-from-filter',
        'auction-year-to-filter',
        'auction-search-filter',
        'auction-price-from-filter',
        'auction-price-to-filter',
        'auction-sort-filter'
    ];

    function maybeRerenderActiveView() {
        if (currentViewMode === 'alerts') {
            showAlerts();
        } else if (currentViewMode === 'best-deals') {
            showBestDeals();
        } else {
            // default server-driven load
            applyAuctionFilters();
        }
    }

    auctionFilterIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            const handler = () => {
                // debounce could be added if needed
                maybeRerenderActiveView();
            };
            el.addEventListener('change', handler);
            if (id === 'auction-search-filter') {
                el.addEventListener('input', handler);
            }
        }
    });

    if (metalFilter) {
        metalFilter.addEventListener('change', function() {
            applyCurrentFilters();
        });
    }

    if (sortFilter) {
        sortFilter.addEventListener('change', function() {
            applyCurrentFilters();
        });
    }

    if (showBestDealsBtn) {
        showBestDealsBtn.addEventListener('click', async function() {
            this.disabled = true;
            this.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Загрузка...';
            try {
                await showBestDeals();
            } catch (error) {
                console.error('Error showing best deals:', error);
                showNotification('Ошибка при загрузке лучших предложений', 'error');
            } finally {
                this.disabled = false;
                this.innerHTML = '<i class="fas fa-star mr-1"></i>Лучшие предложения';
            }
        });
    }

    if (showAlertsBtn) {
        showAlertsBtn.addEventListener('click', async function() {
            this.disabled = true;
            this.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Загрузка...';
            try {
                await showAlerts();
            } catch (error) {
                console.error('Error showing alerts:', error);
                showNotification('Ошибка при загрузке алертов', 'error');
            } finally {
                this.disabled = false;
                this.innerHTML = '<i class="fas fa-exclamation-triangle mr-1"></i>Алерты';
            }
        });
    }

    if (clearFiltersBtn) {
        clearFiltersBtn.addEventListener('click', function() {
            clearFilters();
        });
    }

    if (refreshAuctionBtn) {
        refreshAuctionBtn.addEventListener('click', function() {
            updateAuctionAnalytics();
        });
    }

    if (exportAuctionBtn) {
        exportAuctionBtn.addEventListener('click', function() {
            exportCurrentAuctionData();
        });
    }
});

// Функция для загрузки рискованности лота
async function loadLotRisk(lotId) {
    try {
        const response = await fetch(`/api/lots/${lotId}/risk`);
        if (!response.ok) {
            console.error(`Ошибка загрузки рискованности для лота ${lotId}:`, response.status);
            return null;
        }
        const riskData = await response.json();
        return riskData;
    } catch (error) {
        console.error(`Ошибка загрузки рискованности для лота ${lotId}:`, error);
        return null;
    }
}

// Функция для отображения индикатора рискованности
function renderRiskIndicator(lotId, riskData) {
    const container = document.getElementById(`risk-indicator-${lotId}`);
    if (!container || !riskData) return;
    
    const getRiskColors = (riskLevel) => {
        switch(riskLevel) {
            case 'КРИТИЧЕСКИЙ РИСК':
                return {
                    bg: 'bg-red-50',
                    border: 'border-red-300',
                    text: 'text-red-800',
                    icon: 'fa-exclamation-triangle',
                    iconColor: 'text-red-600'
                };
            case 'ВЫСОКИЙ РИСК':
                return {
                    bg: 'bg-orange-50',
                    border: 'border-orange-300',
                    text: 'text-orange-800',
                    icon: 'fa-exclamation-circle',
                    iconColor: 'text-orange-600'
                };
            case 'СРЕДНИЙ РИСК':
                return {
                    bg: 'bg-yellow-50',
                    border: 'border-yellow-300',
                    text: 'text-yellow-800',
                    icon: 'fa-question-circle',
                    iconColor: 'text-yellow-600'
                };
            case 'НИЗКИЙ РИСК':
                return {
                    bg: 'bg-blue-50',
                    border: 'border-blue-300',
                    text: 'text-blue-800',
                    icon: 'fa-info-circle',
                    iconColor: 'text-blue-600'
                };
            default:
                return null; // БЕЗ РИСКА - не показываем индикатор
        }
    };
    
    const colors = getRiskColors(riskData.risk_level);
    if (!colors) return; // Не показываем индикатор для "БЕЗ РИСКА"
    
    container.innerHTML = `
        <div class="${colors.bg} border ${colors.border} rounded-lg p-3 cursor-pointer hover:shadow-md transition-shadow" 
             onclick="showRiskDetails(${lotId})">
            <div class="flex items-center justify-between">
                <div class="flex items-center">
                    <i class="fas ${colors.icon} ${colors.iconColor} text-xl mr-3"></i>
                    <div>
                        <p class="font-semibold ${colors.text}">Рискованность лота: ${riskData.risk_level}</p>
                        <p class="text-xs ${colors.text} opacity-75">
                            ${riskData.suspicious_count} из ${riskData.total_participants} подозрительных участников 
                            (${riskData.suspicious_percentage}%)
                        </p>
                    </div>
                </div>
                <i class="fas fa-chevron-right ${colors.text} opacity-50"></i>
            </div>
        </div>
    `;
}

// Функция для показа детализации рискованности
async function showRiskDetails(lotId) {
    const riskData = await loadLotRisk(lotId);
    if (!riskData) {
        showNotification('Не удалось загрузить данные о рискованности', 'error');
        return;
    }
    
    // Создаем модальное окно
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4';
    modal.onclick = (e) => {
        if (e.target === modal) {
            document.body.removeChild(modal);
        }
    };
    
    const getRiskLevelClass = (level) => {
        switch(level) {
            case 'КРИТИЧЕСКИЙ РИСК': return 'bg-red-100 text-red-800 border-red-300';
            case 'ВЫСОКИЙ РИСК': return 'bg-orange-100 text-orange-800 border-orange-300';
            case 'ПОДОЗРИТЕЛЬНО': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
            case 'ВНИМАНИЕ': return 'bg-blue-100 text-blue-800 border-blue-300';
            default: return 'bg-gray-100 text-gray-800 border-gray-300';
        }
    };
    
    modal.innerHTML = `
        <div class="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden">
            <div class="flex items-center justify-between p-6 border-b">
                <h3 class="text-xl font-semibold text-gray-800">Рискованность лота</h3>
                <button onclick="this.closest('.fixed').remove()" class="text-gray-400 hover:text-gray-600">
                    <i class="fas fa-times text-xl"></i>
                </button>
            </div>
            <div class="p-6 overflow-y-auto max-h-[calc(90vh-120px)]">
                <div class="mb-6">
                    <div class="grid grid-cols-2 gap-4 mb-4">
                        <div class="bg-gray-50 rounded-lg p-4">
                            <p class="text-sm text-gray-600 mb-1">Уровень риска</p>
                            <p class="text-lg font-bold ${getRiskLevelClass(riskData.risk_level).split(' ')[1]}">${riskData.risk_level}</p>
                        </div>
                        <div class="bg-gray-50 rounded-lg p-4">
                            <p class="text-sm text-gray-600 mb-1">Всего участников</p>
                            <p class="text-lg font-bold text-gray-800">${riskData.total_participants}</p>
                        </div>
                    </div>
                    <div class="bg-gray-50 rounded-lg p-4">
                        <p class="text-sm text-gray-600 mb-1">Подозрительных участников</p>
                        <p class="text-2xl font-bold text-red-600">${riskData.suspicious_count}</p>
                        <p class="text-xs text-gray-500 mt-1">${riskData.suspicious_percentage}% от общего числа</p>
                    </div>
                </div>
                
                <div>
                    <h4 class="font-semibold text-gray-800 mb-3">Участники торгов</h4>
                    <div class="space-y-2">
                        ${riskData.participants.map(p => `
                            <div class="flex items-center justify-between p-3 border rounded-lg ${p.suspicious_score > 0 ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'}">
                                <div class="flex items-center">
                                    <i class="fas fa-user ${p.suspicious_score > 0 ? 'text-red-600' : 'text-gray-400'} mr-3"></i>
                                    <div>
                                        <p class="font-medium text-gray-800">${p.bidder_login}</p>
                                        ${p.suspicious_score > 0 ? `
                                            <p class="text-xs text-gray-600">Балл подозрительности: ${p.suspicious_score}</p>
                                        ` : '<p class="text-xs text-gray-500">Нет данных о подозрительности</p>'}
                                    </div>
                                </div>
                                ${p.suspicious_score > 0 ? `
                                    <span class="px-2 py-1 text-xs font-semibold rounded-full border cursor-pointer hover:opacity-80 transition-opacity ${getRiskLevelClass(p.risk_level)}" 
                                          onclick="event.stopPropagation(); showUserScoringDetails('${p.bidder_login}')" 
                                          title="Кликните для расшифровки скоринга">
                                        ${p.risk_level}
                                    </span>
                                ` : ''}
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
}

// Функция для загрузки детальной расшифровки скоринга пользователя
async function loadUserScoringDetails(winnerLogin) {
    try {
        const response = await fetch(`/api/analytics/user-scoring/${encodeURIComponent(winnerLogin)}`);
        if (response.ok) {
            const result = await response.json();
            if (result.success) {
                return result.data;
            }
        }
        return null;
    } catch (error) {
        console.error(`Ошибка загрузки расшифровки скоринга для ${winnerLogin}:`, error);
        return null;
    }
}

// Функция для отображения модального окна с расшифровкой скоринга
async function showUserScoringDetails(winnerLogin) {
    const scoringData = await loadUserScoringDetails(winnerLogin);
    
    if (!scoringData) {
        alert('Не удалось загрузить данные о скоринге пользователя');
        return;
    }
    
    // Создаем модальное окно
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4';
    modal.onclick = (e) => {
        if (e.target === modal) {
            modal.remove();
        }
    };
    
    const getRiskLevelClass = (level) => {
        switch(level) {
            case 'КРИТИЧЕСКИЙ РИСК':
                return 'bg-red-50 border-red-300 text-red-800';
            case 'ВЫСОКИЙ РИСК':
                return 'bg-orange-50 border-orange-300 text-orange-800';
            case 'ПОДОЗРИТЕЛЬНО':
                return 'bg-yellow-50 border-yellow-300 text-yellow-800';
            case 'ВНИМАНИЕ':
                return 'bg-blue-50 border-blue-300 text-blue-800';
            default:
                return 'bg-gray-50 border-gray-300 text-gray-800';
        }
    };
    
    const getScoreColor = (score, maxScore) => {
        const percentage = (score / maxScore) * 100;
        if (percentage >= 80) return 'text-red-600';
        if (percentage >= 50) return 'text-orange-600';
        if (percentage >= 30) return 'text-yellow-600';
        return 'text-blue-600';
    };
    
    modal.innerHTML = `
        <div class="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-hidden" onclick="event.stopPropagation()">
            <div class="flex items-center justify-between p-6 border-b bg-gray-50">
                <div>
                    <h3 class="text-xl font-semibold text-gray-800">Расшифровка скоринга подозрительности</h3>
                    <p class="text-sm text-gray-600 mt-1">Пользователь: <span class="font-medium">${scoringData.winner_login}</span></p>
                </div>
                <button onclick="this.closest('.fixed').remove()" class="text-gray-400 hover:text-gray-600">
                    <i class="fas fa-times text-xl"></i>
                </button>
            </div>
            <div class="p-6 overflow-y-auto max-h-[calc(90vh-180px)]">
                <!-- Общая информация -->
                <div class="mb-6 grid grid-cols-2 gap-4">
                    <div class="bg-gray-50 rounded-lg p-4">
                        <p class="text-sm text-gray-600 mb-1">Общий балл подозрительности</p>
                        <p class="text-2xl font-bold text-gray-800">${scoringData.suspicious_score}</p>
                    </div>
                    <div class="${getRiskLevelClass(scoringData.risk_level)} rounded-lg p-4 border">
                        <p class="text-sm text-gray-600 mb-1">Уровень риска</p>
                        <p class="text-lg font-bold">${scoringData.risk_level}</p>
                    </div>
                </div>
                
                ${scoringData.rating ? `
                <div class="mb-6 bg-gray-50 rounded-lg p-4">
                    <p class="text-sm text-gray-600 mb-1">Рейтинг пользователя</p>
                    <p class="text-lg font-semibold text-gray-800">${scoringData.rating} (${scoringData.category || 'не указана'})</p>
                </div>
                ` : ''}
                
                <!-- Детальная расшифровка -->
                <div class="mb-4">
                    <h4 class="font-semibold text-gray-800 mb-3">Детальная расшифровка по категориям</h4>
                    ${scoringData.scoring_details.length > 0 ? `
                        <div class="space-y-3">
                            ${scoringData.scoring_details.map(item => `
                                <div class="border rounded-lg p-4 hover:shadow-md transition-shadow">
                                    <div class="flex items-start justify-between mb-2">
                                        <div class="flex-1">
                                            <h5 class="font-medium text-gray-800 mb-1">${item.name}</h5>
                                            <p class="text-xs text-gray-600">${item.description}</p>
                                        </div>
                                        <div class="text-right ml-4">
                                            <p class="text-sm font-semibold ${getScoreColor(item.score, item.maxScore)}">
                                                ${item.score} / ${item.maxScore}
                                            </p>
                                            <p class="text-xs text-gray-500">× ${item.weight}</p>
                                        </div>
                                    </div>
                                    <div class="mt-2">
                                        <div class="flex items-center justify-between text-xs text-gray-600 mb-1">
                                            <span>Взвешенный вклад</span>
                                            <span class="font-semibold">${item.weightedScore.toFixed(1)}</span>
                                        </div>
                                        <div class="w-full bg-gray-200 rounded-full h-2">
                                            <div class="bg-blue-600 h-2 rounded-full" style="width: ${Math.min((item.score / item.maxScore) * 100, 100)}%"></div>
                                        </div>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    ` : `
                        <div class="text-center py-8 text-gray-500">
                            <i class="fas fa-info-circle text-3xl mb-2"></i>
                            <p>Нет активных баллов подозрительности</p>
                        </div>
                    `}
                </div>
                
                <!-- Статистика -->
                ${scoringData.total_lots > 0 ? `
                <div class="mt-6 pt-6 border-t grid grid-cols-2 gap-4">
                    <div class="bg-gray-50 rounded-lg p-4">
                        <p class="text-sm text-gray-600 mb-1">Всего лотов</p>
                        <p class="text-lg font-semibold text-gray-800">${scoringData.total_lots}</p>
                    </div>
                    <div class="bg-gray-50 rounded-lg p-4">
                        <p class="text-sm text-gray-600 mb-1">Общая сумма</p>
                        <p class="text-lg font-semibold text-gray-800">${formatPrice(scoringData.total_spent)}</p>
                    </div>
                </div>
                ` : ''}
                
                ${scoringData.last_analysis_date ? `
                <div class="mt-4 text-xs text-gray-500 text-center">
                    Последний анализ: ${new Date(scoringData.last_analysis_date).toLocaleString('ru-RU')}
                </div>
                ` : ''}
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
}

// Функция для загрузки прогноза цены лота
async function loadLotPrediction(lotId) {
    try {
        const response = await fetch(`/api/prediction/${lotId}`);
        if (!response.ok) {
            throw new Error('Прогноз не найден');
        }
        
        const prediction = await response.json();
        displayLotPrediction(lotId, prediction);
    } catch (error) {
        console.error('Ошибка загрузки прогноза:', error);
        // Скрываем секцию прогноза если нет данных
        const predictionElement = document.getElementById(`prediction-${lotId}`);
        if (predictionElement) {
            predictionElement.style.display = 'none';
        }
    }
}

// Функция для получения читаемого текста метода прогнозирования
function getPredictionMethodText(method) {
    const methodTexts = {
        'no_similar_lots': 'Нет аналогов',
        'single_similar_lot': '1 аналог',
        'statistical_model': 'Стат. модель',
        'calibrated': 'Калиброванная',
        'simple': 'Упрощенная',
        'simplified_model': 'Упрощенная'
    };
    return methodTexts[method] || method || 'Неизвестно';
}

// Функция для обновления цветовой схемы плашки с текущей ставкой
function updateBidStatusColors(lotId, prediction) {
    // Находим плашку с текущей ставкой для этого лота
    const lotElement = document.querySelector(`[data-lot-id="${lotId}"]`) || 
                      document.querySelector(`#prediction-${lotId}`)?.closest('.bg-white');
    
    if (!lotElement) {
        console.log(`Не найден элемент лота ${lotId} для обновления цветов`);
        return;
    }
    
    const bidSection = lotElement.querySelector('.bg-gradient-to-r');
    if (!bidSection) {
        console.log(`Не найдена плашка с текущей ставкой для лота ${lotId}`);
        return;
    }
    
    // Получаем текущую ставку из плашки
    const bidText = bidSection.querySelector('.text-2xl.font-bold');
    if (!bidText) return;
    
    const bidAmount = parseFloat(bidText.textContent.replace(/[^\d]/g, ''));
    const predictedPrice = prediction.predicted_price;
    
    if (!bidAmount || !predictedPrice || predictedPrice <= 0) {
        return;
    }
    
    // Определяем новую цветовую схему
    const getBidStatusColors = (currentBid, predictedPrice) => {
        const ratio = currentBid / predictedPrice;
        
        if (ratio >= 1.05) {
            return { 
                bg: 'from-green-50 to-green-100', 
                border: 'border-green-200', 
                icon: 'text-green-600', 
                badge: 'bg-green-100 text-green-800',
                status: 'high',
                statusText: 'Высокая цена'
            };
        } else if (ratio <= 0.90) {
            return { 
                bg: 'from-red-50 to-red-100', 
                border: 'border-red-200', 
                icon: 'text-red-600', 
                badge: 'bg-red-100 text-red-800',
                status: 'low',
                statusText: 'Внимание!'
            };
        } else {
            const progress = (ratio - 0.90) / (1.05 - 0.90);
            if (progress < 0.5) {
                return { 
                    bg: 'from-red-50 to-yellow-100', 
                    border: 'border-orange-200', 
                    icon: 'text-orange-600', 
                    badge: 'bg-orange-100 text-orange-800',
                    status: 'medium-low',
                    statusText: 'Средняя'
                };
            } else {
                return { 
                    bg: 'from-yellow-50 to-green-100', 
                    border: 'border-yellow-200', 
                    icon: 'text-yellow-600', 
                    badge: 'bg-yellow-100 text-yellow-800',
                    status: 'medium-high',
                    statusText: 'Приемлемая'
                };
            }
        }
    };
    
    const colors = getBidStatusColors(bidAmount, predictedPrice);
    
    // Обновляем классы плашки
    bidSection.className = bidSection.className.replace(/from-\w+-\d+ to-\w+-\d+/, colors.bg);
    bidSection.className = bidSection.className.replace(/border-\w+-\d+/, colors.border);
    
    // Обновляем бейдж статуса
    const statusBadge = bidSection.querySelector('[class*="bg-"][class*="-100"]');
    if (statusBadge) {
        statusBadge.className = `text-xs ${colors.badge} px-2 py-1 rounded-full`;
        statusBadge.textContent = colors.statusText;
    }
    
    console.log(`Обновлены цвета для лота ${lotId}: ${colors.statusText} (${(bidAmount/predictedPrice*100).toFixed(1)}%)`);
}

// Функция для отображения прогноза цены лота
function displayLotPrediction(lotId, prediction) {
    const predictionElement = document.getElementById(`prediction-${lotId}`);
    if (!predictionElement) {
        return;
    }
    
    // Обновляем цветовую схему плашки с текущей ставкой на основе прогноза
    updateBidStatusColors(lotId, prediction);
    
    // Если прогнозная цена null (нет аналогичных лотов), показываем соответствующее сообщение
    if (prediction.predicted_price === null) {
        predictionElement.innerHTML = `
            <div class="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <div class="flex items-center justify-between mb-3">
                    <div class="flex items-center">
                        <i class="fas fa-question-circle text-gray-500 mr-2"></i>
                        <h5 class="font-semibold text-gray-700">Прогнозная цена</h5>
                    </div>
                    <span class="px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                        Недостаточно данных
                    </span>
                </div>
                <div class="text-center">
                    <p class="text-sm text-gray-600 mb-2">Аналогичные лоты не найдены</p>
                    <p class="text-xs text-gray-500">
                        <i class="fas fa-info-circle mr-1"></i>
                        Для точного прогноза нужны исторические данные аналогичных монет
                    </p>
                </div>
            </div>
        `;
        return;
    }
    
    // Если прогнозная цена равна 0 или undefined, скрываем блок
    if (!prediction.predicted_price || prediction.predicted_price <= 0) {
        predictionElement.style.display = 'none';
        return;
    }
    
    // Получаем актуальную текущую ставку из элемента лота
    const lotElement = document.querySelector(`[data-lot-id="${lotId}"]`);
    let currentBid = 0;
    
    if (lotElement) {
        // Извлекаем current_bid_amount из текста плашки "Текущая ставка"
        const currentBidElement = lotElement.querySelector('.text-2xl.font-bold.text-gray-800');
        if (currentBidElement) {
            const bidText = currentBidElement.textContent;
            // Парсим цену из текста (убираем пробелы и ₽)
            const bidMatch = bidText.match(/[\d\s]+/);
            if (bidMatch) {
                currentBid = parseInt(bidMatch[0].replace(/\s/g, ''));
            }
        }
    }
    
    // Fallback к переданным данным
    if (currentBid === 0) {
        currentBid = prediction.current_bid_amount || prediction.winning_bid || 0;
    }
    
    console.log(`🔍 Отладка displayLotPrediction для лота ${lotId}:`);
    console.log(`  - current_bid_amount: ${prediction.current_bid_amount}`);
    console.log(`  - winning_bid: ${prediction.winning_bid}`);
    console.log(`  - currentBid (используется): ${currentBid}`);
    console.log(`  - predicted_price: ${prediction.predicted_price}`);
    
    const predictedPrice = prediction.predicted_price;
    const confidence = Math.round((prediction.confidence_score || 0) * 100);
    
    // Рассчитываем разность между прогнозом и актуальной текущей ставкой
    const difference = predictedPrice - currentBid;
    const differencePercent = currentBid > 0 ? Math.round((difference / currentBid) * 100) : 0;
    
    // Определяем цветовую схему на основе разности
    let bgColor, textColor, iconColor, borderColor;
    if (difference > 0) {
        // Прогноз выше текущей ставки - хорошая возможность
        bgColor = 'bg-green-50';
        textColor = 'text-green-800';
        iconColor = 'text-green-600';
        borderColor = 'border-green-200';
    } else if (difference < 0) {
        // Прогноз ниже текущей ставки - переплата
        bgColor = 'bg-red-50';
        textColor = 'text-red-800';
        iconColor = 'text-red-600';
        borderColor = 'border-red-200';
    } else {
        // Прогноз равен текущей ставке
        bgColor = 'bg-blue-50';
        textColor = 'text-blue-800';
        iconColor = 'text-blue-600';
        borderColor = 'border-blue-200';
    }
    
    // Определяем уровень уверенности
    let confidenceLevel, confidenceText;
    if (confidence >= 80) {
        confidenceLevel = 'bg-green-100 text-green-800';
        confidenceText = 'Высокая';
    } else if (confidence >= 60) {
        confidenceLevel = 'bg-yellow-100 text-yellow-800';
        confidenceText = 'Средняя';
    } else {
        confidenceLevel = 'bg-red-100 text-red-800';
        confidenceText = 'Низкая';
    }
    
    predictionElement.innerHTML = `
        <div class="bg-gradient-to-r ${bgColor} border ${borderColor} rounded-lg p-4">
            <div class="flex items-center justify-between mb-3">
                <div class="flex items-center">
                    <i class="fas fa-crystal-ball ${iconColor} mr-2"></i>
                    <h5 class="font-semibold ${textColor}">Прогнозная цена</h5>
                </div>
                <div class="flex items-center space-x-2">
                    <span class="px-2 py-1 rounded-full text-xs font-medium ${confidenceLevel}">
                        ${confidenceText} (${confidence}%)
                    </span>
                    <span class="text-xs ${textColor}">
                        ${getPredictionMethodText(prediction.prediction_method)}${prediction.sample_size ? ` (${prediction.sample_size})` : ''}
                    </span>
                </div>
            </div>
            
            ${prediction.prediction_created_at ? `
                <div class="mb-3 text-center">
                    <p class="text-xs ${textColor} opacity-75">
                        <i class="fas fa-clock mr-1"></i>
                        Последний перерасчет: ${formatPredictionDate(prediction.prediction_created_at)}
                    </p>
                </div>
            ` : ''}
            
            <div class="grid grid-cols-2 gap-4">
                <div class="text-center">
                    <p class="text-sm ${textColor} mb-1">Прогнозная цена</p>
                    <p class="text-xl font-bold ${textColor}">${formatPrice(predictedPrice)}</p>
                </div>
                <div class="text-center">
                    <p class="text-sm ${textColor} mb-1">Разность</p>
                    <div class="flex items-center justify-center">
                        <i class="fas ${difference > 0 ? 'fa-arrow-up' : difference < 0 ? 'fa-arrow-down' : 'fa-minus'} ${iconColor} mr-1"></i>
                        <span class="text-lg font-bold ${textColor}">
                            ${difference > 0 ? '+' : ''}${formatPrice(Math.abs(difference))}
                        </span>
                    </div>
                    <p class="text-xs ${textColor}">
                        ${differencePercent > 0 ? '+' : ''}${differencePercent}%
                    </p>
                </div>
            </div>
            
            ${prediction.metal_value > 0 ? `
                <div class="mt-3 pt-3 border-t ${borderColor}">
                    <div class="grid grid-cols-2 gap-4 text-sm">
                        <div class="text-center">
                            <p class="${textColor} mb-1">Стоимость металла</p>
                            <p class="font-semibold ${textColor}">${formatPrice(prediction.metal_value)}</p>
                        </div>
                        <div class="text-center">
                            <p class="${textColor} mb-1">Нумизматическая наценка</p>
                            <p class="font-semibold ${textColor}">${formatPrice(prediction.numismatic_premium)}</p>
                        </div>
                    </div>
                </div>
            ` : ''}
            
            <div class="mt-3 pt-3 border-t ${borderColor}">
                <p class="text-xs ${textColor} text-center">
                    <i class="fas fa-info-circle mr-1"></i>
                    Прогноз основан на исторических данных аналогичных лотов
                </p>
            </div>
        </div>
    `;
}

// Функция для загрузки всех прогнозов для текущего аукциона
async function loadAllPredictions(auctionNumber) {
    try {
        const response = await fetch(`/api/predictions/${auctionNumber}`);
        if (!response.ok) {
            throw new Error('Прогнозы не найдены');
        }
        
        const predictions = await response.json();
        
        console.log(`🔍 Отладка loadAllPredictions: получено ${predictions.length} прогнозов`);
        if (predictions.length > 0) {
            console.log(`🔍 Первый прогноз:`, predictions[0]);
        }
        
        // Сохраняем прогнозы в глобальной переменной для аналитики
        allPredictions.clear();
        predictions.forEach(prediction => {
            allPredictions.set(prediction.id, prediction);
            console.log(`🔍 Вызываем displayLotPrediction для лота ${prediction.id} с current_bid_amount: ${prediction.current_bid_amount}`);
            displayLotPrediction(prediction.id, prediction);
        });
        
        console.log(`Загружено ${predictions.length} прогнозов для аукциона ${auctionNumber}`);
        
        // Analyze all lots in the auction after loading predictions
        await analyzeAllAuctionLots(auctionNumber);
        
        // Analytics are updated by analyzeAllAuctionLots() above
    } catch (error) {
        console.error('Ошибка загрузки прогнозов:', error);
    }
}

// Make functions globally accessible
window.loadPriceHistory = loadPriceHistory;
window.createPriceHistoryChart = createPriceHistoryChart;
window.updateChartWithMetalData = updateChartWithMetalData;
window.addToWatchlist = addToWatchlist;
window.shareLot = shareLot;
window.showBestDeals = showBestDeals;
window.showAlerts = showAlerts;
window.updateAuctionAnalytics = updateAuctionAnalytics;
window.updateAnalyticsFromPageData = updateAnalyticsFromPageData;
window.loadLotPrediction = loadLotPrediction;
window.loadAllPredictions = loadAllPredictions;
window.applyCurrentFilters = applyCurrentFilters;
window.updateAnalyticsForFilteredLots = updateAnalyticsForFilteredLots;

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

// Auction filters functions
async function applyAuctionFilters() {
    console.log('🔍 Применяем фильтры аукциона...');
    
    const filters = {
        country: document.getElementById('auction-country-filter')?.value || '',
        metal: document.getElementById('auction-metal-filter')?.value || '',
        rarity: document.getElementById('auction-rarity-filter')?.value || '',
        condition: document.getElementById('auction-condition-filter')?.value || '',
        category: document.getElementById('auction-category-filter')?.value || '',
        mint: document.getElementById('auction-mint-filter')?.value || '',
        yearFrom: document.getElementById('auction-year-from-filter')?.value || '',
        yearTo: document.getElementById('auction-year-to-filter')?.value || '',
        search: document.getElementById('auction-search-filter')?.value || '',
        priceFrom: document.getElementById('auction-price-from-filter')?.value || '',
        priceTo: document.getElementById('auction-price-to-filter')?.value || '',
        sort: document.getElementById('auction-sort-filter')?.value || 'premium-desc'
    };
    
    console.log('📋 Фильтры аукциона:', filters);
    console.log('🔍 Элемент mint-filter:', document.getElementById('auction-mint-filter'));
    console.log('🔍 Значение mint-filter:', document.getElementById('auction-mint-filter')?.value);
    
    // Сохраняем фильтры в глобальном состоянии
    currentFilters = filters;
    currentAuctionPage = 1;
    
    // Загружаем отфильтрованные лоты
    if (currentAuction) {
        await loadLots(currentAuction, 1);
    } else {
        await loadCurrentAuctionLots(1, filters);
    }
}

function clearAuctionFilters() {
    console.log('🗑️ Очищаем фильтры аукциона...');
    
    // Сбрасываем все поля фильтров
    document.getElementById('auction-country-filter').value = '';
    document.getElementById('auction-metal-filter').value = '';
    document.getElementById('auction-rarity-filter').value = '';
    document.getElementById('auction-condition-filter').value = '';
    document.getElementById('auction-category-filter').value = '';
    document.getElementById('auction-mint-filter').value = '';
    document.getElementById('auction-year-from-filter').value = '';
    document.getElementById('auction-year-to-filter').value = '';
    document.getElementById('auction-search-filter').value = '';
    document.getElementById('auction-price-from-filter').value = '';
    document.getElementById('auction-price-to-filter').value = '';
    document.getElementById('auction-sort-filter').value = 'premium-desc';
    
    // Сбрасываем глобальное состояние
    currentFilters = {};
    currentAuctionPage = 1;
    
    // Загружаем все лоты без фильтров
    if (currentAuction) {
        loadLots(currentAuction, 1);
    } else {
        loadCurrentAuctionLots(1, {});
    }
}

async function loadCurrentAuctionLots(page = 1, filters = {}) {
    console.log('📡 Загружаем лоты аукциона...', { page, filters });
    
    try {
        // Показываем индикатор загрузки
        const loadingElement = document.getElementById('currentAuctionLoading');
        const errorElement = document.getElementById('currentAuctionError');
        const lotsList = document.getElementById('currentAuctionLotsList');
        
        if (loadingElement) loadingElement.classList.remove('hidden');
        if (errorElement) errorElement.classList.add('hidden');
        if (lotsList) lotsList.innerHTML = '';
        
        // Строим параметры запроса
        const params = new URLSearchParams({
            page: page,
            limit: 20,
            ...filters
        });
        
        console.log('📡 Параметры запроса:', params.toString());
        
        const response = await fetch(`/api/current-auction?${params}`);
        
        console.log('📡 Ответ сервера:', response.status, response.statusText);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ Ошибка ответа сервера:', errorText);
            throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
        }
        
        const data = await response.json();
        console.log('📡 Ответ сервера:', data);
        
        // Скрываем индикатор загрузки
        if (loadingElement) loadingElement.classList.add('hidden');
        
        // Обновляем счетчик результатов
        const countElement = document.getElementById('currentAuctionResultsCount');
        if (countElement) {
            countElement.textContent = `Найдено: ${data.total || 0} лотов`;
        }
        
        // Отображаем лоты
        if (lotsList && data.lots) {
            lotsList.innerHTML = '';
            data.lots.forEach(lot => {
                const lotCard = createAuctionLotCard(lot);
                lotsList.appendChild(lotCard);
            });
        }
        
        // Обновляем пагинацию
        updateAuctionPagination(data.pagination, filters);
        
    } catch (error) {
        console.error('❌ Ошибка загрузки лотов аукциона:', error);
        
        const loadingElement = document.getElementById('currentAuctionLoading');
        const errorElement = document.getElementById('currentAuctionError');
        
        if (loadingElement) loadingElement.classList.add('hidden');
        if (errorElement) errorElement.classList.remove('hidden');
    }
}

function createAuctionLotCard(lot) {
    // Используем точно ту же функцию, что и для обычного отображения
    return createCurrentAuctionLotElement(lot);
}

function updateAuctionPagination(pagination, filters) {
    const paginationElement = document.getElementById('currentAuctionPagination');
    if (!paginationElement || !pagination) return;
    
    const { page, pages, total } = pagination;
    
    if (pages <= 1) {
        paginationElement.innerHTML = '';
        return;
    }
    
    let paginationHTML = '<div class="flex justify-center items-center space-x-2">';
    
    // Previous button
    if (page > 1) {
        paginationHTML += `
            <button onclick="loadCurrentAuctionLots(${page - 1}, currentFilters)" 
                    class="px-3 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300">
                ← Предыдущая
            </button>
        `;
    }
    
    // Page numbers
    const startPage = Math.max(1, page - 2);
    const endPage = Math.min(pages, page + 2);
    
    for (let i = startPage; i <= endPage; i++) {
        const isActive = i === page;
        paginationHTML += `
            <button onclick="loadCurrentAuctionLots(${i}, currentFilters)" 
                    class="px-3 py-2 ${isActive ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'} rounded">
                ${i}
            </button>
        `;
    }
    
    // Next button
    if (page < pages) {
        paginationHTML += `
            <button onclick="loadCurrentAuctionLots(${page + 1}, currentFilters)" 
                    class="px-3 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300">
                Следующая →
            </button>
        `;
    }
    
    paginationHTML += '</div>';
    paginationElement.innerHTML = paginationHTML;
}

// Load filter options when current auction tab is opened
async function loadAuctionFilterOptions() {
    console.log('📋 Загружаем опции фильтров аукциона...');
    
    try {
        const response = await fetch('/api/filters');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const filters = await response.json();
        console.log('📋 Опции фильтров аукциона:', filters);
        
        // Заполняем выпадающие списки для страницы "Лоты аукциона"
        populateSelect('metalFilter', filters.metals || []);
        populateSelect('conditionFilter', filters.conditions || []);
        populateSelect('categoryFilter', filters.categories || []);
        
        // Заполняем выпадающие списки для страницы "Текущий аукцион"
        populateSelect('auction-metal-filter', filters.metals || []);
        populateSelect('auction-condition-filter', filters.conditions || []);
        populateSelect('auction-category-filter', filters.categories || []);
        
        // Заполняем уникальные фильтры для текущего аукциона
        await loadCurrentAuctionUniqueFilters();
        
    } catch (error) {
        console.error('❌ Ошибка загрузки опций фильтров:', error);
    }
}

// Загружаем уникальные фильтры для текущего аукциона
async function loadCurrentAuctionUniqueFilters() {
    try {
        console.log('📋 Загружаем уникальные фильтры из справочной таблицы...');
        
        // Загружаем опции фильтров из новой таблицы
        const [countriesResponse, raritiesResponse, mintsResponse] = await Promise.all([
            fetch('/api/auction-filter-options?type=country'),
            fetch('/api/auction-filter-options?type=rarity'), 
            fetch('/api/auction-filter-options?type=mint')
        ]);
        
        if (!countriesResponse.ok || !raritiesResponse.ok || !mintsResponse.ok) {
            throw new Error('Ошибка загрузки данных фильтров');
        }
        
        const countries = await countriesResponse.json();
        const rarities = await raritiesResponse.json();
        const mints = await mintsResponse.json();
        
        // Заполняем фильтры
        populateSelect('auction-country-filter', countries.map(item => item.display_name));
        populateSelect('auction-rarity-filter', rarities.map(item => item.display_name));
        populateSelect('auction-mint-filter', mints.map(item => item.display_name));
        
        console.log('📋 Уникальные фильтры загружены:', { 
            countries: countries.length, 
            rarities: rarities.length, 
            mints: mints.length 
        });
        
    } catch (error) {
        console.error('❌ Ошибка загрузки уникальных фильтров:', error);
    }
}

function populateSelect(selectId, options) {
    const select = document.getElementById(selectId);
    if (!select) return;
    
    // Сохраняем текущее значение
    const currentValue = select.value;
    
    // Очищаем опции (кроме первой "Все")
    while (select.children.length > 1) {
        select.removeChild(select.lastChild);
    }
    
    // Добавляем новые опции
    options.forEach(option => {
        const optionElement = document.createElement('option');
        optionElement.value = option;
        optionElement.textContent = option;
        select.appendChild(optionElement);
    });
    
    // Восстанавливаем значение
    select.value = currentValue;
}

// ===== ФУНКЦИИ ДЛЯ МОДАЛЬНОГО ОКНА ИСТОРИИ СТАВОК =====

// Показать модальное окно с историей ставок
async function showBidsModal(lotId) {
    const modal = document.getElementById('bidsModal');
    const loading = document.getElementById('bidsLoading');
    const content = document.getElementById('bidsContent');
    const empty = document.getElementById('bidsEmpty');
    
    // Показываем модальное окно
    modal.classList.remove('hidden');
    
    // Показываем загрузку
    loading.classList.remove('hidden');
    content.classList.add('hidden');
    empty.classList.add('hidden');
    
    try {
        // Загружаем историю ставок
        const response = await fetch(`/api/lots/${lotId}/bids`);
        const data = await response.json();
        
        if (data.success && data.bids.length > 0) {
            // Показываем ставки
            displayBids(data.bids);
            loading.classList.add('hidden');
            content.classList.remove('hidden');
        } else {
            // Показываем пустое состояние
            loading.classList.add('hidden');
            empty.classList.remove('hidden');
        }
    } catch (error) {
        console.error('Ошибка загрузки истории ставок:', error);
        loading.classList.add('hidden');
        empty.classList.remove('hidden');
    }
}

// Отобразить ставки в таблице
function displayBids(bids) {
    const countElement = document.getElementById('bidsCount');
    const tableBody = document.getElementById('bidsTableBody');
    
    // Обновляем счетчик
    countElement.textContent = bids.length;
    
    // Очищаем таблицу
    tableBody.innerHTML = '';
    
    // Добавляем ставки
    bids.forEach((bid, index) => {
        const row = document.createElement('tr');
        row.className = index % 2 === 0 ? 'bg-white' : 'bg-gray-50';
        
        const autoBidIcon = bid.is_auto_bid ? 
            '<i class="fas fa-robot text-blue-500" title="Автобид"></i>' : 
            '<i class="fas fa-hand-paper text-gray-400" title="Ручная ставка"></i>';
        
        const autoBidText = bid.is_auto_bid ? 'Автобид' : 'Ручная';
        
        row.innerHTML = `
            <td class="px-4 py-3 font-medium text-gray-900">${formatPrice(bid.bid_amount)}</td>
            <td class="px-4 py-3 text-gray-700" id="bidder-${index}"></td>
            <td class="px-4 py-3 text-gray-600">${formatDateTime(bid.bid_timestamp)}</td>
            <td class="px-4 py-3 text-center">
                <span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${bid.is_auto_bid ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'}">
                    ${autoBidIcon}
                    <span class="ml-1">${autoBidText}</span>
                </span>
            </td>
        `;
        
        // Добавляем кликабельный логин ставщика
        const bidderContainer = row.querySelector(`#bidder-${index}`);
        if (bid.bidder_login) {
            const bidderLink = createWinnerLink(bid.bidder_login);
            bidderContainer.appendChild(bidderLink);
        } else {
            bidderContainer.textContent = 'Не указан';
        }
        
        tableBody.appendChild(row);
    });
}

// Закрыть модальное окно
function closeBidsModal() {
    const modal = document.getElementById('bidsModal');
    modal.classList.add('hidden');
}

// Форматирование даты и времени
function formatDateTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleString('ru-RU', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

// Инициализация обработчиков событий для модального окна
function initializeBidsModal() {
    // Обработчик закрытия модального окна
    document.getElementById('closeBidsModal').addEventListener('click', closeBidsModal);
    
    // Закрытие по клику на фон
    document.getElementById('bidsModal').addEventListener('click', (e) => {
        if (e.target.id === 'bidsModal') {
            closeBidsModal();
        }
    });
    
    // Закрытие по Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeBidsModal();
        }
    });
}

// Инициализируем модальное окно при загрузке страницы
document.addEventListener('DOMContentLoaded', initializeBidsModal);

// ===== ФУНКЦИИ ДЛЯ ПОСТАНОВКИ СТАВОК =====

let currentBidLot = null;

function showBidModal(lot) {
    console.log('🎯 Функция showBidModal вызвана с лотом:', lot);
    currentBidLot = lot;
    
    // Заполняем информацию о лоте
    document.getElementById('bidLotTitle').textContent = `Лот #${lot.lot_number}`;
    document.getElementById('bidLotDescription').textContent = lot.coin_description ? 
        lot.coin_description.substring(0, 100) + (lot.coin_description.length > 100 ? '...' : '') : 
        'Описание отсутствует';
    
    const currentBid = lot.current_bid_amount || lot.winning_bid || 0;
    document.getElementById('bidCurrentBid').textContent = currentBid > 0 ? formatPrice(currentBid) : 'Нет ставок';
    
    // Очищаем поле ввода и ошибки
    document.getElementById('bidAmount').value = '';
    document.getElementById('bidAmountError').classList.add('hidden');
    
    // Показываем модальное окно
    document.getElementById('bidModal').classList.remove('hidden');
    console.log('✅ Модальное окно показано');
    
    // Фокусируемся на поле ввода
    setTimeout(() => {
        document.getElementById('bidAmount').focus();
    }, 100);
}

function closeBidModal() {
    document.getElementById('bidModal').classList.add('hidden');
    currentBidLot = null;
}

function validateBidAmount(amount) {
    const errors = [];
    
    if (!amount || amount <= 0) {
        errors.push('Сумма должна быть больше 0');
    }
    
    if (amount < 1) {
        errors.push('Минимальная ставка: 1 рубль');
    }
    
    if (amount > 1000000) {
        errors.push('⚠️ Сумма слишком большая! Максимум: 1,000,000 рублей');
    }
    
    // Проверяем, что ставка больше текущей
    if (currentBidLot) {
        const currentBid = currentBidLot.current_bid_amount || currentBidLot.winning_bid || 0;
        if (amount <= currentBid) {
            errors.push(`Ставка должна быть больше текущей (${formatPrice(currentBid)})`);
        }
    }
    
    return errors;
}

async function placeBid() {
    console.log('🎯 Функция placeBid вызвана');
    
    if (!currentBidLot) {
        console.log('❌ currentBidLot не определен');
        showNotification('Ошибка: лот не выбран', 'error');
        return;
    }
    
    console.log('✅ currentBidLot определен:', currentBidLot);
    
    const amount = parseInt(document.getElementById('bidAmount').value);
    const useAutoBid = document.getElementById('bidAutoBid').checked;
    console.log('💰 Введенная сумма:', amount);
    console.log('🤖 Автобид включен:', useAutoBid);
    
    const errors = validateBidAmount(amount);
    console.log('🔍 Ошибки валидации:', errors);
    
    if (errors.length > 0) {
        console.log('❌ Есть ошибки валидации, прерываем');
        const errorElement = document.getElementById('bidAmountError');
        errorElement.textContent = errors[0];
        errorElement.classList.remove('hidden');
        return;
    }
    
    // Скрываем ошибки
    document.getElementById('bidAmountError').classList.add('hidden');
    
    // Показываем подтверждение
    const autoBidText = useAutoBid ? ' с автобидом' : '';
    const confirmMessage = `Вы собираетесь поставить ставку${autoBidText} ${formatPrice(amount)} рублей на лот #${currentBidLot.lot_number} в аукционе ${currentBidLot.auction_number}. Продолжить?`;
    console.log('❓ Показываем подтверждение:', confirmMessage);
    
    if (!confirm(confirmMessage)) {
        console.log('❌ Пользователь отменил ставку');
        return;
    }
    
    console.log('✅ Пользователь подтвердил ставку, продолжаем...');
    
    // Сохраняем оригинальный текст кнопки
    const confirmButton = document.getElementById('confirmBid');
    const originalText = confirmButton.innerHTML;
    
    try {
        console.log('🚀 Входим в блок try...');
        
        // Показываем индикатор загрузки
        confirmButton.innerHTML = '<i class="fas fa-spinner loading mr-2"></i>Отправляем...';
        confirmButton.disabled = true;
        console.log('✅ Кнопка обновлена');
        
        console.log('📤 Отправляем запрос к API...');
        const token = localStorage.getItem('token');
        console.log('🔐 Токен авторизации:', token ? 'есть' : 'отсутствует');
        
        const requestData = {
            lotId: parseInt(currentBidLot.id),
            amount: amount,
            useAutoBid: useAutoBid
        };
        console.log('📤 Данные запроса:', requestData);
        
        // Отправляем ставку через API
        console.log('🌐 Отправляем fetch запрос на:', '/api/place-bid');
        console.log('🌐 Метод:', 'POST');
        console.log('🌐 Заголовки:', {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('token')}`
        });
        console.log('🌐 Тело запроса:', JSON.stringify(requestData));
        
        const response = await fetch('/api/place-bid', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify(requestData)
        });
        
        console.log('🌐 Получен response объект:', response);
        console.log('🌐 Response status:', response.status);
        console.log('🌐 Response statusText:', response.statusText);
        console.log('🌐 Response headers:', response.headers);
        
        console.log('📥 Получен ответ:', response.status, response.statusText);
        
        if (response.ok) {
            const result = await response.json();
            console.log('📥 Результат:', result);
            console.log('🔍 Проверяем, откуда пришел ответ...');
            
            // Проверяем, содержит ли ответ наши поля
            if (result.success && result.message && result.data) {
                console.log('✅ Ответ пришел от нашего API endpoint');
                showNotification(`Ставка ${formatPrice(amount)} рублей успешно поставлена!`, 'success');
            } else {
                console.log('❌ Ответ НЕ от нашего API endpoint!');
                console.log('❌ Структура ответа:', Object.keys(result));
                showNotification(`Ошибка: получен неожиданный ответ от сервера`, 'error');
                return;
            }
            
            // Закрываем модальное окно
            closeBidModal();
            
            // Обновляем данные лота
            await updateWatchlistData();
            
        } else {
            const error = await response.json();
            console.log('❌ Ошибка API:', error);
            throw new Error(error.message || 'Ошибка постановки ставки');
        }
        
    } catch (error) {
        console.error('❌ Ошибка постановки ставки:', error);
        console.error('❌ Stack trace:', error.stack);
        showNotification(`Ошибка постановки ставки: ${error.message}`, 'error');
    } finally {
        console.log('🔄 Входим в блок finally...');
        // Восстанавливаем кнопку
        const confirmButton = document.getElementById('confirmBid');
        confirmButton.innerHTML = originalText;
        confirmButton.disabled = false;
    }
}

function initializeBidModal() {
    // Обработчики закрытия модального окна
    document.getElementById('closeBidModal').addEventListener('click', closeBidModal);
    document.getElementById('cancelBid').addEventListener('click', closeBidModal);
    
    // Обработчик подтверждения ставки
    document.getElementById('confirmBid').addEventListener('click', placeBid);
    
    // Обработчик Enter в поле ввода
    document.getElementById('bidAmount').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            placeBid();
        }
    });
    
    // Валидация в реальном времени
    document.getElementById('bidAmount').addEventListener('input', (e) => {
        const amount = parseInt(e.target.value);
        const errors = validateBidAmount(amount);
        
        const errorElement = document.getElementById('bidAmountError');
        if (errors.length > 0) {
            errorElement.textContent = errors[0];
            errorElement.classList.remove('hidden');
        } else {
            errorElement.classList.add('hidden');
        }
    });
    
    // Закрытие по Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !document.getElementById('bidModal').classList.contains('hidden')) {
            closeBidModal();
        }
    });
}

// Инициализируем модальное окно ставок при загрузке страницы
document.addEventListener('DOMContentLoaded', initializeBidModal);

// ============================================
// Функции для работы с пользователями
// ============================================

let usersCurrentPage = 1;
let usersSortBy = 'suspicious_score';
let usersSortOrder = 'DESC';

async function loadUsers(page = 1) {
    console.log('loadUsers вызвана, страница:', page);
    try {
        usersCurrentPage = page;
        
        const params = new URLSearchParams({
            page: page,
            limit: 50,
            sort_by: usersSortBy,
            sort_order: usersSortOrder
        });
        
        if (elements.usersSearch && elements.usersSearch.value) {
            params.append('search', elements.usersSearch.value);
        }
        if (elements.usersStatusFilter && elements.usersStatusFilter.value !== 'all') {
            params.append('status', elements.usersStatusFilter.value);
        }
        if (elements.usersRiskFilter && elements.usersRiskFilter.value !== 'all') {
            params.append('risk_level', elements.usersRiskFilter.value);
        }
        if (elements.usersRatingFilter && elements.usersRatingFilter.value !== 'all') {
            params.append('rating_category', elements.usersRatingFilter.value);
        }
        
        console.log('Запрос к API:', `/api/users?${params.toString()}`);
        const response = await fetch(`/api/users?${params.toString()}`);
        if (!response.ok) {
            const errorText = await response.text();
            console.error('Ошибка ответа API:', response.status, errorText);
            throw new Error(`Ошибка загрузки пользователей: ${response.status}`);
        }
        
        const data = await response.json();
        console.log('Данные получены:', data);
        console.log('Первые 3 пользователя:', data.data?.slice(0, 3));
        
        // Проверяем пользователей с ВЫСОКИЙ РИСК
        const highRiskUsers = data.data?.filter(u => u.risk_level === 'ВЫСОКИЙ РИСК') || [];
        if (highRiskUsers.length > 0) {
            console.log('Пользователи с ВЫСОКИЙ РИСК:', highRiskUsers.slice(0, 3).map(u => ({
                login: u.login,
                risk_level: u.risk_level,
                suspicious_score: u.suspicious_score,
                suspicious_score_type: typeof u.suspicious_score,
                suspicious_score_raw: u.suspicious_score
            })));
        }
        
        if (data.data && data.data.length > 0) {
            console.log('Пример пользователя:', {
                login: data.data[0].login,
                risk_level: data.data[0].risk_level,
                suspicious_score: data.data[0].suspicious_score,
                suspicious_score_type: typeof data.data[0].suspicious_score,
                rating: data.data[0].rating
            });
        }
        displayUsers(data.data, data.pagination);
        
    } catch (error) {
        console.error('Ошибка загрузки пользователей:', error);
        if (elements.usersTableBody) {
            elements.usersTableBody.innerHTML = `
                <tr>
                    <td colspan="8" class="px-6 py-4 text-center text-red-500">
                        <i class="fas fa-exclamation-triangle mr-2"></i>Ошибка загрузки данных
                    </td>
                </tr>
            `;
        }
    }
}

function displayUsers(users, pagination) {
    if (!elements.usersTableBody) {
        console.error('usersTableBody не найден');
        return;
    }
    
    if (!users || users.length === 0) {
        elements.usersTableBody.innerHTML = `
            <tr>
                <td colspan="8" class="px-6 py-4 text-center text-gray-500">
                    Пользователи не найдены
                </td>
            </tr>
        `;
        return;
    }
    
    // Создаем HTML для всех пользователей
    const usersHTML = users.map(user => {
        // Нормализуем risk_level: убираем возможные пробелы в начале/конце и проверяем точное совпадение
        let riskLevel = (user.risk_level || 'НОРМА').trim();
        
        // Проверяем все возможные варианты написания "ВЫСОКИЙ РИСК"
        const highRiskVariants = ['ВЫСОКИЙ РИСК', 'ВЫСОКИЙ  РИСК', 'ВЫСОКИЙ\u00A0РИСК']; // обычный пробел, двойной пробел, неразрывный пробел
        if (highRiskVariants.includes(riskLevel)) {
            riskLevel = 'ВЫСОКИЙ РИСК'; // Нормализуем к стандартному виду
        }
        
        // Отладочная информация для пользователей с ВЫСОКИЙ РИСК
        if (riskLevel === 'ВЫСОКИЙ РИСК' || (user.risk_level && user.risk_level.includes('ВЫСОКИЙ'))) {
            console.log('Обработка пользователя с ВЫСОКИЙ РИСК:', {
                login: user.login,
                risk_level_original: user.risk_level,
                risk_level_normalized: riskLevel,
                risk_level_type: typeof user.risk_level,
                risk_level_length: user.risk_level ? user.risk_level.length : 0,
                risk_level_charcodes: user.risk_level ? Array.from(user.risk_level).map(c => `${c}(${c.charCodeAt(0)})`).join(' ') : [],
                normalized_length: riskLevel.length,
                normalized_charcodes: Array.from(riskLevel).map(c => `${c}(${c.charCodeAt(0)})`).join(' '),
                suspicious_score: user.suspicious_score,
                exact_match: riskLevel === 'ВЫСОКИЙ РИСК'
            });
        }
        
        const riskColors = {
            'КРИТИЧЕСКИЙ РИСК': 'bg-red-600',
            'ВЫСОКИЙ РИСК': 'bg-orange-600',
            'ПОДОЗРИТЕЛЬНО': 'bg-yellow-600',
            'ВНИМАНИЕ': 'bg-blue-600',
            'НОРМА': 'bg-gray-500'
        };
        const riskColor = riskColors[riskLevel] || 'bg-gray-500';
        
        // Отладка для ВЫСОКИЙ РИСК - проверяем, что цвет правильно определяется
        if (riskLevel === 'ВЫСОКИЙ РИСК') {
            console.log('Проверка цвета для ВЫСОКИЙ РИСК:', {
                riskLevel: riskLevel,
                riskColor: riskColor,
                riskColorFromMap: riskColors[riskLevel],
                allRiskColors: riskColors
            });
        }
        
        const ratingBadge = user.rating ? `
            <span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                ${user.rating} (${user.category || 'N/A'})
            </span>
        ` : '<span class="text-gray-400">N/A</span>';
        
        // Показываем уровень риска и счет
        // Преобразуем suspicious_score в число, обрабатываем null/undefined
        let suspiciousScore = 0;
        if (user.suspicious_score !== null && user.suspicious_score !== undefined) {
            suspiciousScore = Number(user.suspicious_score);
            if (isNaN(suspiciousScore)) {
                suspiciousScore = 0;
            }
        }
        
        let suspiciousBadge = '';
        
        // Упрощенная логика: если есть уровень риска (не НОРМА), показываем его
        // Используем ТОЧНО ТОТ ЖЕ подход, что и для других уровней риска
        const loginEscaped = user.login.replace(/'/g, "\\'").replace(/"/g, '&quot;');
        
        if (riskLevel !== 'НОРМА') {
            // Для пользователей с риском всегда показываем уровень риска
            // Для ВЫСОКИЙ РИСК используем короткую версию без пробела в тексте
            let displayText = riskLevel;
            if (riskLevel === 'ВЫСОКИЙ РИСК') {
                displayText = 'ВЫСОКИЙ';
            }
            
            // ВРЕМЕННО: убираем число в скобках для диагностики
            // Показываем только уровень риска без числа
            suspiciousBadge = `<span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium text-white cursor-pointer hover:opacity-80 transition-opacity ${riskColor}" onclick="event.stopPropagation(); showUserProfile('${loginEscaped}')" title="Кликните для расшифровки">${displayText}</span>`;
        } else if (suspiciousScore > 0) {
            // Для НОРМА, но с ненулевым счетом (на всякий случай)
            suspiciousBadge = `<span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium text-white cursor-pointer hover:opacity-80 transition-opacity ${riskColor}" onclick="event.stopPropagation(); showUserProfile('${loginEscaped}')" title="Кликните для расшифровки">${suspiciousScore}</span>`;
        } else {
            // Нулевой счет и НОРМА
            suspiciousBadge = '<span class="text-gray-400">0</span>';
        }
        
        // Дополнительная отладка для ВЫСОКИЙ РИСК
        if (riskLevel === 'ВЫСОКИЙ РИСК') {
            console.log('Созданный бейдж для ВЫСОКИЙ РИСК:', {
                login: user.login,
                suspiciousBadge: suspiciousBadge,
                suspiciousBadgeLength: suspiciousBadge.length,
                riskColor: riskColor,
                suspiciousScore: suspiciousScore,
                riskLevel: riskLevel,
                riskLevelCheck: riskLevel !== 'НОРМА'
            });
        }
        
        // Проверяем, что suspiciousBadge не пустой для ВЫСОКИЙ РИСК
        if (riskLevel === 'ВЫСОКИЙ РИСК' && (!suspiciousBadge || suspiciousBadge.trim() === '')) {
            console.error('ОШИБКА: suspiciousBadge пустой для ВЫСОКИЙ РИСК!', {
                login: user.login,
                riskLevel: riskLevel,
                suspiciousScore: suspiciousScore,
                suspiciousBadge: suspiciousBadge
            });
            // Принудительно создаем бейдж
            const loginEscaped = user.login.replace(/'/g, "\\'").replace(/"/g, '&quot;');
            suspiciousBadge = `<span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium text-white cursor-pointer hover:opacity-80 transition-opacity ${riskColor}" onclick="event.stopPropagation(); showUserProfile('${loginEscaped}')" title="Кликните для расшифровки">ВЫСОКИЙ</span>`;
        }
        
        // Для ВЫСОКИЙ РИСК добавляем дополнительную проверку перед вставкой
        if (riskLevel === 'ВЫСОКИЙ РИСК') {
            console.log('Перед вставкой в HTML для ВЫСОКИЙ РИСК:', {
                login: user.login,
                suspiciousBadge: suspiciousBadge,
                willBeInserted: suspiciousBadge ? 'ДА' : 'НЕТ'
            });
        }
        
        return `
            <tr class="hover:bg-gray-50 cursor-pointer" onclick="showUserProfile('${user.login.replace(/'/g, "\\'")}')">
                <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    ${user.login}
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    <span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                        user.status === 'Победитель' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                    }">
                        ${user.status}
                    </span>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    ${ratingBadge}
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900" data-risk-level="${riskLevel}" data-suspicious-score="${suspiciousScore}">
                    ${suspiciousBadge || '<span class="text-red-500">ОШИБКА</span>'}
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    ${user.total_lots || 0}
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    ${formatPrice(user.total_spent || 0)}
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    ${user.total_bids || 0}
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    <button onclick="event.stopPropagation(); showUserProfile('${user.login.replace(/'/g, "\\'")}')" 
                            class="text-blue-600 hover:text-blue-800 font-medium">
                        <i class="fas fa-eye mr-1"></i>Профиль
                    </button>
                </td>
            </tr>
        `;
    }).join('');
    
    // Вставляем HTML в таблицу
    elements.usersTableBody.innerHTML = usersHTML;
    
    // Исправляем бейджи для ВЫСОКИЙ РИСК после вставки через DOM API
    // Используем более надежный подход: проверяем все ячейки с data-risk-level
    setTimeout(() => {
        const allRows = elements.usersTableBody.querySelectorAll('tr');
        console.log('Всего строк в таблице после вставки:', allRows.length);
        
        allRows.forEach((row, rowIndex) => {
            if (rowIndex < users.length) {
                const user = users[rowIndex];
                const userRiskLevel = user.risk_level || 'НОРМА';
                
                // Ищем все ячейки с data-risk-level в этой строке
                const riskLevelCells = row.querySelectorAll('td[data-risk-level]');
                riskLevelCells.forEach(cell => {
                    const cellRiskLevel = cell.getAttribute('data-risk-level');
                    
                    // Проверяем точное совпадение (включая пробелы)
                    if (cellRiskLevel === 'ВЫСОКИЙ РИСК' && userRiskLevel === 'ВЫСОКИЙ РИСК') {
                        console.log(`Найдена ячейка с ВЫСОКИЙ РИСК для пользователя ${user.login}:`, {
                            cellRiskLevel: cellRiskLevel,
                            userRiskLevel: userRiskLevel,
                            currentInnerHTML: cell.innerHTML,
                            currentInnerHTMLLength: cell.innerHTML.length,
                            currentTextContent: cell.textContent.trim(),
                            hasChildren: cell.children.length,
                            firstChildTag: cell.firstElementChild ? cell.firstElementChild.tagName : 'НЕТ',
                            firstChildText: cell.firstElementChild ? cell.firstElementChild.textContent : 'НЕТ'
                        });
                        
                        // Всегда пересоздаем бейдж через DOM API для надежности
                        cell.innerHTML = '';
                        
                        const badge = document.createElement('span');
                        badge.className = 'inline-flex items-center px-2 py-1 rounded-full text-xs font-medium text-white cursor-pointer hover:opacity-80 transition-opacity bg-orange-600';
                        // ВРЕМЕННО: убираем число в скобках для диагностики
                        badge.textContent = 'ВЫСОКИЙ';
                        badge.title = 'Кликните для расшифровки';
                        badge.onclick = (e) => {
                            e.stopPropagation();
                            showUserProfile(user.login);
                        };
                        
                        cell.appendChild(badge);
                        console.log(`✅ Бейдж создан через DOM API для ${user.login}, текст: "${badge.textContent}"`);
                    }
                });
            }
        });
    }, 100);
    
    // Пагинация
    if (pagination && pagination.totalPages > 1) {
        let paginationHTML = '<div class="flex items-center justify-between"><div class="text-sm text-gray-700">';
        paginationHTML += `Показано ${(pagination.page - 1) * pagination.limit + 1} - ${Math.min(pagination.page * pagination.limit, pagination.total)} из ${pagination.total}`;
        paginationHTML += '</div><div class="flex space-x-2">';
        
        if (pagination.page > 1) {
            paginationHTML += `<button onclick="loadUsers(${pagination.page - 1})" class="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">Предыдущая</button>`;
        }
        
        for (let i = Math.max(1, pagination.page - 2); i <= Math.min(pagination.totalPages, pagination.page + 2); i++) {
            paginationHTML += `<button onclick="loadUsers(${i})" class="px-4 py-2 border border-gray-300 rounded-lg ${
                i === pagination.page ? 'bg-blue-500 text-white' : 'hover:bg-gray-50'
            }">${i}</button>`;
        }
        
        if (pagination.page < pagination.totalPages) {
            paginationHTML += `<button onclick="loadUsers(${pagination.page + 1})" class="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">Следующая</button>`;
        }
        
        paginationHTML += '</div></div>';
        if (elements.usersPagination) {
            elements.usersPagination.innerHTML = paginationHTML;
        }
    } else {
        if (elements.usersPagination) {
            elements.usersPagination.innerHTML = '';
        }
    }
}

function sortUsersTable(field) {
    if (usersSortBy === field) {
        usersSortOrder = usersSortOrder === 'ASC' ? 'DESC' : 'ASC';
    } else {
        usersSortBy = field;
        usersSortOrder = 'DESC';
    }
    loadUsers(usersCurrentPage);
}

async function showUserProfile(login) {
    if (!elements.userProfileModal || !elements.userProfileLoading || !elements.userProfileContent) {
        console.error('Элементы модального окна профиля не найдены');
        return;
    }
    
    elements.userProfileModal.classList.remove('hidden');
    elements.userProfileLoading.classList.remove('hidden');
    elements.userProfileContent.classList.add('hidden');
    
    try {
        const response = await fetch(`/api/users/${encodeURIComponent(login)}`);
        if (!response.ok) throw new Error('Ошибка загрузки профиля');
        
        const user = await response.json();
        displayUserProfile(user);
        
    } catch (error) {
        console.error('Ошибка загрузки профиля пользователя:', error);
        if (elements.userProfileContent) {
            elements.userProfileContent.innerHTML = `
                <div class="text-center py-8 text-red-500">
                    <i class="fas fa-exclamation-triangle text-3xl mb-2"></i>
                    <p>Ошибка загрузки профиля</p>
                </div>
            `;
        }
        if (elements.userProfileLoading) {
            elements.userProfileLoading.classList.add('hidden');
        }
        if (elements.userProfileContent) {
            elements.userProfileContent.classList.remove('hidden');
        }
    }
}

function displayUserProfile(user) {
    // Нормализуем risk_level: убираем возможные пробелы в начале/конце
    let riskLevel = (user.risk_profile?.risk_level || 'НОРМА').trim();
    
    // Проверяем все возможные варианты написания "ВЫСОКИЙ РИСК"
    const highRiskVariants = ['ВЫСОКИЙ РИСК', 'ВЫСОКИЙ  РИСК', 'ВЫСОКИЙ\u00A0РИСК'];
    if (highRiskVariants.includes(riskLevel)) {
        riskLevel = 'ВЫСОКИЙ РИСК'; // Нормализуем к стандартному виду
    }
    
    const riskColors = {
        'КРИТИЧЕСКИЙ РИСК': 'bg-red-600',
        'ВЫСОКИЙ РИСК': 'bg-orange-600',
        'ПОДОЗРИТЕЛЬНО': 'bg-yellow-600',
        'ВНИМАНИЕ': 'bg-blue-600',
        'НОРМА': 'bg-gray-500'
    };
    const riskColor = riskColors[riskLevel] || 'bg-gray-500';
    
    // Отладка для ВЫСОКИЙ РИСК
    if (riskLevel === 'ВЫСОКИЙ РИСК' || (user.risk_profile?.risk_level && user.risk_profile.risk_level.includes('ВЫСОКИЙ'))) {
        console.log('displayUserProfile - ВЫСОКИЙ РИСК:', {
            riskLevel_original: user.risk_profile?.risk_level,
            riskLevel_normalized: riskLevel,
            riskLevelLength: riskLevel.length,
            riskLevelCharCodes: Array.from(riskLevel).map(c => `${c}(${c.charCodeAt(0)})`).join(' '),
            riskColor: riskColor,
            riskColorFromMap: riskColors[riskLevel],
            exact_match: riskLevel === 'ВЫСОКИЙ РИСК',
            userRiskProfile: user.risk_profile
        });
    }
    
    // Формируем текст для бейджа риска
    // ВРЕМЕННО: убираем число в скобках для диагностики
    let riskBadgeText = '';
    if (user.risk_profile) {
        // Показываем только уровень риска без числа
        if (riskLevel === 'ВЫСОКИЙ РИСК') {
            riskBadgeText = `ВЫСОКИЙ`;
        } else {
            riskBadgeText = riskLevel;
        }
    }
    
    let html = `
        <div class="space-y-6">
            <!-- Header -->
            <div class="flex items-center justify-between border-b pb-4">
                <div>
                    <h3 class="text-2xl font-bold text-gray-800">${user.login}</h3>
                    <p class="text-sm text-gray-500 mt-1">${user.status}</p>
                </div>
                <div class="flex space-x-2">
                    ${user.rating ? `
                        <span class="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800">
                            Рейтинг: ${user.rating.rating} (${user.rating.category})
                        </span>
                    ` : ''}
                    ${user.risk_profile ? `
                        <span class="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium text-white cursor-pointer hover:opacity-80 transition-opacity ${riskColor}" 
                              onclick="showUserScoringDetails('${user.login}')" 
                              title="Кликните для расшифровки">
                            ${riskBadgeText}
                        </span>
                    ` : ''}
                </div>
            </div>
            
            <!-- Financial Stats -->
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div class="bg-blue-50 rounded-lg p-4 cursor-pointer hover:bg-blue-100 transition-colors" 
                     onclick="searchUserLots('${user.login}')" 
                     title="Кликните для поиска лотов пользователя">
                    <p class="text-sm text-gray-600">Выиграно лотов</p>
                    <p class="text-2xl font-bold text-gray-800">${user.stats.financial.total_lots}</p>
                    <p class="text-xs text-gray-500 mt-1"><i class="fas fa-search mr-1"></i>Найти лоты</p>
                </div>
                <div class="bg-green-50 rounded-lg p-4 cursor-pointer hover:bg-green-100 transition-colors" 
                     onclick="searchUserLots('${user.login}')" 
                     title="Кликните для поиска лотов пользователя">
                    <p class="text-sm text-gray-600">Потрачено</p>
                    <p class="text-2xl font-bold text-gray-800">${formatPrice(user.stats.financial.total_spent)}</p>
                    <p class="text-xs text-gray-500 mt-1"><i class="fas fa-search mr-1"></i>Найти лоты</p>
                </div>
                <div class="bg-yellow-50 rounded-lg p-4">
                    <p class="text-sm text-gray-600">Средняя цена</p>
                    <p class="text-2xl font-bold text-gray-800">${formatPrice(user.stats.financial.avg_lot_price)}</p>
                </div>
            </div>
            
            <!-- Activity Stats -->
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div class="bg-gray-50 rounded-lg p-4 cursor-pointer hover:bg-gray-100 transition-colors" 
                     onclick="searchUserLots('${user.login}')" 
                     title="Кликните для поиска лотов пользователя">
                    <p class="text-sm text-gray-600">Всего ставок</p>
                    <p class="text-xl font-bold text-gray-800">${user.stats.activity.total_bids}</p>
                    <p class="text-xs text-gray-500 mt-1">Выигрышных: ${user.stats.activity.winning_bids}</p>
                    <p class="text-xs text-gray-500 mt-1"><i class="fas fa-search mr-1"></i>Найти лоты</p>
                </div>
                <div class="bg-gray-50 rounded-lg p-4">
                    <p class="text-sm text-gray-600">Уникальных аукционов</p>
                    <p class="text-xl font-bold text-gray-800">${user.stats.activity.unique_auctions}</p>
                </div>
            </div>
    `;
    
    // Risk Profile
    if (user.risk_profile) {
        // Маппинг ключей на русские названия, точно соответствующие названиям в аналитических отчетах
        const scoreNameMap = {
            'linked_accounts_score': 'Связанные аккаунты',
            'carousel_score': 'Карусель перепродаж',
            'self_boost_score': 'Саморазгон/Самовыкуп',
            'decoy_tactics_score': 'Тактики приманки',
            'pricing_strategies_score': 'Стратегии разгона',
            'circular_buyers_score': 'Круговые покупки',
            'fast_bids_score': 'Быстрые ставки',
            'autobid_traps_score': 'Ловушки автобида',
            'abandonment_score': 'Замирание торгов',
            'technical_bidders_score': 'Технические пользователи'
        };
        
        html += `
            <div class="border-t pt-4">
                <h4 class="text-lg font-semibold text-gray-800 mb-3">Риск-профиль</h4>
                <div class="grid grid-cols-2 md:grid-cols-5 gap-2">
                    ${Object.entries(user.risk_profile.scores).map(([key, value]) => {
                        const displayName = scoreNameMap[key] || key.replace('_score', '').replace(/_/g, ' ');
                        return `
                        <div class="bg-gray-50 rounded p-2 text-center">
                            <p class="text-xs text-gray-600">${displayName}</p>
                            <p class="text-sm font-bold ${value > 0 ? 'text-red-600' : 'text-gray-400'}">${value || 0}</p>
                        </div>
                    `;
                    }).join('')}
                </div>
            </div>
        `;
    }
    
    html += '</div>';
    
        if (elements.userProfileContent) {
            elements.userProfileContent.innerHTML = html;
        }
        if (elements.userProfileLoading) {
            elements.userProfileLoading.classList.add('hidden');
        }
        if (elements.userProfileContent) {
            elements.userProfileContent.classList.remove('hidden');
        }
}

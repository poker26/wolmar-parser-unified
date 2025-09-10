// Global state
let currentFilters = {};
let currentPage = 1;
const COINS_PER_PAGE = 20;

// Cache for API requests
const apiCache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// DOM elements
const elements = {
    // Statistics
    totalCoins: document.getElementById('totalCoins'),
    denominationsCount: document.getElementById('denominationsCount'),
    yearRange: document.getElementById('yearRange'),
    metalsCount: document.getElementById('metalsCount'),
    
    // Filters
    searchInput: document.getElementById('searchInput'),
    denominationFilter: document.getElementById('denominationFilter'),
    metalFilter: document.getElementById('metalFilter'),
    rarityFilter: document.getElementById('rarityFilter'),
    yearInput: document.getElementById('yearInput'),
    mintFilter: document.getElementById('mintFilter'),
    minMintage: document.getElementById('minMintage'),
    maxMintage: document.getElementById('maxMintage'),
    applyFilters: document.getElementById('applyFilters'),
    clearFilters: document.getElementById('clearFilters'),
    exportBtn: document.getElementById('exportBtn'),
    
    // Results
    coinsList: document.getElementById('coinsList'),
    pagination: document.getElementById('pagination'),
    resultsCount: document.getElementById('resultsCount'),
    loading: document.getElementById('loading'),
    error: document.getElementById('error'),
    
    // Modal
    coinModal: document.getElementById('coinModal'),
    modalTitle: document.getElementById('modalTitle'),
    modalContent: document.getElementById('modalContent'),
    closeModal: document.getElementById('closeModal')
};

// Initialize app
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
});

function initializeApp() {
    setupEventListeners();
    loadStatistics();
    loadFilters();
    loadCoins();
}

function setupEventListeners() {
    // Filters
    elements.applyFilters.addEventListener('click', applyFilters);
    elements.clearFilters.addEventListener('click', clearFilters);
    elements.exportBtn.addEventListener('click', exportCatalog);
    
    // Search input
    elements.searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            applyFilters();
        }
    });
    
    // Modal
    elements.closeModal.addEventListener('click', closeModal);
    elements.coinModal.addEventListener('click', (e) => {
        if (e.target === elements.coinModal) {
            closeModal();
        }
    });
}

// API functions
async function cachedFetch(url, options = {}) {
    const cacheKey = `${url}_${JSON.stringify(options)}`;
    const cached = apiCache.get(cacheKey);
    
    // Don't cache filtered requests
    const hasFilters = url.includes('?') && (url.includes('search=') || url.includes('denomination=') || url.includes('metal=') || url.includes('rarity=') || url.includes('year=') || url.includes('mint=') || url.includes('minMintage=') || url.includes('maxMintage='));
    
    // But allow caching for filter data requests
    const isFilterDataRequest = url.includes('/api/catalog/filters') || url.includes('/api/catalog/stats');
    
    if ((!hasFilters || isFilterDataRequest) && cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        console.log('Using cached data for:', url);
        return cached.data;
    }
    
    try {
        const response = await fetch(url, options);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusMessage}`);
        }
        const data = await response.json();
        
        // Cache the response
        apiCache.set(cacheKey, {
            data: data,
            timestamp: Date.now()
        });
        
        return data;
    } catch (error) {
        console.error('API request failed:', error);
        throw error;
    }
}

// Load statistics
async function loadStatistics() {
    try {
        const stats = await cachedFetch('/api/catalog/stats');
        
        elements.totalCoins.textContent = stats.total_coins || 0;
        elements.denominationsCount.textContent = stats.denominations_count || 0;
        elements.metalsCount.textContent = stats.metals_count || 0;
        
        if (stats.earliest_year && stats.latest_year) {
            elements.yearRange.textContent = `${stats.earliest_year} - ${stats.latest_year}`;
        } else {
            elements.yearRange.textContent = '-';
        }
        
    } catch (error) {
        console.error('Ошибка загрузки статистики:', error);
    }
}

// Load filter options
async function loadFilters() {
    try {
        const filters = await cachedFetch('/api/catalog/filters');
        
        // Populate denomination filter
        elements.denominationFilter.innerHTML = '<option value="">Все номиналы</option>';
        filters.denominations.forEach(denomination => {
            const option = document.createElement('option');
            option.value = denomination.denomination;
            option.textContent = `${denomination.denomination} (${denomination.count})`;
            elements.denominationFilter.appendChild(option);
        });
        
        // Populate metal filter
        elements.metalFilter.innerHTML = '<option value="">Все металлы</option>';
        filters.metals.forEach(metal => {
            const option = document.createElement('option');
            option.value = metal.metal;
            option.textContent = `${metal.metal} (${metal.count})`;
            elements.metalFilter.appendChild(option);
        });
        
        // Populate rarity filter
        elements.rarityFilter.innerHTML = '<option value="">Все редкости</option>';
        filters.rarities.forEach(rarity => {
            const option = document.createElement('option');
            option.value = rarity.rarity;
            option.textContent = `${rarity.rarity} (${rarity.count})`;
            elements.rarityFilter.appendChild(option);
        });
        
        // Populate mint filter
        elements.mintFilter.innerHTML = '<option value="">Все дворы</option>';
        filters.mints.forEach(mint => {
            const option = document.createElement('option');
            option.value = mint.mint;
            option.textContent = `${mint.mint} (${mint.count})`;
            elements.mintFilter.appendChild(option);
        });
        
    } catch (error) {
        console.error('Ошибка загрузки фильтров:', error);
    }
}

// Apply filters
async function applyFilters() {
    try {
        // Show loading state
        elements.loading.classList.remove('hidden');
        elements.error.classList.add('hidden');
        elements.coinsList.classList.add('hidden');
        elements.pagination.classList.add('hidden');
        
        // Collect filter values
        currentFilters = {
            search: elements.searchInput.value.trim(),
            denomination: elements.denominationFilter.value,
            metal: elements.metalFilter.value,
            rarity: elements.rarityFilter.value,
            year: elements.yearInput.value,
            mint: elements.mintFilter.value,
            minMintage: elements.minMintage.value,
            maxMintage: elements.maxMintage.value
        };
        
        // Reset to first page
        currentPage = 1;
        
        // Clear cache for filtered requests
        apiCache.clear();
        
        // Load coins
        await loadCoins();
        
    } catch (error) {
        console.error('Ошибка применения фильтров:', error);
        elements.loading.classList.add('hidden');
        elements.error.classList.remove('hidden');
    }
}

// Clear filters
function clearFilters() {
    elements.searchInput.value = '';
    elements.denominationFilter.value = '';
    elements.metalFilter.value = '';
    elements.rarityFilter.value = '';
    elements.yearInput.value = '';
    elements.mintFilter.value = '';
    elements.minMintage.value = '';
    elements.maxMintage.value = '';
    
    currentFilters = {};
    currentPage = 1;
    
    elements.coinsList.classList.add('hidden');
    elements.pagination.classList.add('hidden');
    elements.resultsCount.textContent = '';
    
    // Load all coins
    loadCoins();
}

// Load coins
async function loadCoins() {
    try {
        const params = new URLSearchParams({
            page: currentPage,
            limit: COINS_PER_PAGE,
            ...Object.fromEntries(
                Object.entries(currentFilters).filter(([_, value]) => value)
            )
        });
        
        const response = await cachedFetch(`/api/catalog/coins?${params}`);
        
        // Hide loading state
        elements.loading.classList.add('hidden');
        
        // Display results
        displayCoins(response);
        
    } catch (error) {
        console.error('Ошибка загрузки монет:', error);
        elements.loading.classList.add('hidden');
        elements.error.classList.remove('hidden');
    }
}

// Display coins
function displayCoins(data) {
    const { coins, pagination } = data;
    
    // Update results count
    elements.resultsCount.textContent = `Найдено: ${pagination.total} монет`;
    
    // Display coins
    if (coins.length === 0) {
        elements.coinsList.innerHTML = '<p class="text-gray-600 col-span-full text-center py-8">Монеты не найдены</p>';
    } else {
        elements.coinsList.innerHTML = '';
        coins.forEach(coin => {
            const coinCard = createCoinCard(coin);
            elements.coinsList.appendChild(coinCard);
        });
    }
    
    // Show results and pagination
    elements.coinsList.classList.remove('hidden');
    displayPagination(pagination);
}

// Create coin card
function createCoinCard(coin) {
    const card = document.createElement('div');
    card.className = 'coin-card bg-white rounded-lg shadow-sm p-4 cursor-pointer';
    card.onclick = () => showCoinModal(coin.id);
    
    const rarityColor = getRarityColor(coin.rarity);
    const rarityBadge = coin.rarity ? `<span class="px-2 py-1 text-xs font-semibold rounded-full ${rarityColor}">${coin.rarity}</span>` : '';
    
    const images = [];
    if (coin.avers_image_path) {
        images.push(`<img src="/images/${coin.avers_image_path.split('/').pop()}" alt="Аверс" class="catalog-image w-full h-32 object-contain bg-gray-100 rounded">`);
    }
    if (coin.revers_image_path) {
        images.push(`<img src="/images/${coin.revers_image_path.split('/').pop()}" alt="Реверс" class="catalog-image w-full h-32 object-contain bg-gray-100 rounded">`);
    }
    
    const imageHtml = images.length > 0 ? images.join('') : '<div class="w-full h-32 bg-gray-100 rounded flex items-center justify-center"><i class="fas fa-image text-gray-400 text-2xl"></i></div>';
    
    card.innerHTML = `
        <div class="mb-3">
            ${imageHtml}
        </div>
        
        <div class="space-y-2">
            <div class="flex items-center justify-between">
                <h3 class="font-semibold text-gray-800">${coin.denomination} ${coin.coin_name}</h3>
                ${rarityBadge}
            </div>
            
            <div class="text-sm text-gray-600 space-y-1">
                <div class="flex items-center">
                    <i class="fas fa-calendar w-4 mr-2"></i>
                    <span>${coin.year || 'Не указан'}</span>
                </div>
                
                <div class="flex items-center">
                    <i class="fas fa-gem w-4 mr-2"></i>
                    <span>${coin.metal || 'Не указан'}</span>
                </div>
                
                ${coin.mint ? `
                <div class="flex items-center">
                    <i class="fas fa-building w-4 mr-2"></i>
                    <span class="truncate">${coin.mint}</span>
                </div>
                ` : ''}
                
                ${coin.mintage ? `
                <div class="flex items-center">
                    <i class="fas fa-hashtag w-4 mr-2"></i>
                    <span>Тираж: ${coin.mintage.toLocaleString()}</span>
                </div>
                ` : ''}
            </div>
            
            <div class="text-xs text-gray-500">
                Аукцион ${coin.auction_number}, лот ${coin.lot_number}
            </div>
        </div>
    `;
    
    return card;
}

// Get rarity color
function getRarityColor(rarity) {
    switch (rarity) {
        case 'R': return 'bg-yellow-100 text-yellow-800';
        case 'RR': return 'bg-orange-100 text-orange-800';
        case 'RRR': return 'bg-red-100 text-red-800';
        default: return 'bg-gray-100 text-gray-800';
    }
}

// Display pagination
function displayPagination(pagination) {
    if (pagination.pages <= 1) {
        elements.pagination.classList.add('hidden');
        return;
    }
    
    elements.pagination.classList.remove('hidden');
    
    let paginationHTML = '<div class="flex items-center space-x-2">';
    
    // Previous button
    if (pagination.page > 1) {
        paginationHTML += `
            <button onclick="changePage(${pagination.page - 1})" 
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
            <button onclick="changePage(${i})" 
                    class="px-3 py-2 text-sm font-medium ${isActive ? 'text-white bg-blue-600' : 'text-gray-500 bg-white border border-gray-300'} rounded-md hover:bg-gray-50">
                ${i}
            </button>
        `;
    }
    
    // Next button
    if (pagination.page < pagination.pages) {
        paginationHTML += `
            <button onclick="changePage(${pagination.page + 1})" 
                    class="px-3 py-2 text-sm font-medium text-gray-500 bg-white border border-gray-300 rounded-md hover:bg-gray-50">
                Следующая
            </button>
        `;
    }
    
    paginationHTML += '</div>';
    elements.pagination.innerHTML = paginationHTML;
}

// Change page
function changePage(page) {
    currentPage = page;
    loadCoins();
}

// Show coin modal
async function showCoinModal(coinId) {
    try {
        const coin = await cachedFetch(`/api/catalog/coins/${coinId}`);
        
        elements.modalTitle.textContent = `${coin.denomination} ${coin.coin_name}`;
        
        const rarityColor = getRarityColor(coin.rarity);
        const rarityBadge = coin.rarity ? `<span class="px-3 py-1 text-sm font-semibold rounded-full ${rarityColor}">${coin.rarity}</span>` : '';
        
        const images = [];
        if (coin.avers_image_path) {
            images.push(`
                <div class="text-center">
                    <h4 class="font-semibold text-gray-800 mb-2">Аверс</h4>
                    <img src="/images/${coin.avers_image_path.split('/').pop()}" alt="Аверс" class="max-w-full h-64 object-contain bg-gray-100 rounded mx-auto">
                </div>
            `);
        }
        if (coin.revers_image_path) {
            images.push(`
                <div class="text-center">
                    <h4 class="font-semibold text-gray-800 mb-2">Реверс</h4>
                    <img src="/images/${coin.revers_image_path.split('/').pop()}" alt="Реверс" class="max-w-full h-64 object-contain bg-gray-100 rounded mx-auto">
                </div>
            `);
        }
        
        const catalogInfo = [];
        if (coin.bitkin_info) catalogInfo.push(`<div><strong>Биткин:</strong> ${coin.bitkin_info}</div>`);
        if (coin.uzdenikov_info) catalogInfo.push(`<div><strong>Уздеников:</strong> ${coin.uzdenikov_info}</div>`);
        if (coin.ilyin_info) catalogInfo.push(`<div><strong>Ильин:</strong> ${coin.ilyin_info}</div>`);
        if (coin.petrov_info) catalogInfo.push(`<div><strong>Петров:</strong> ${coin.petrov_info}</div>`);
        if (coin.severin_info) catalogInfo.push(`<div><strong>Северин:</strong> ${coin.severin_info}</div>`);
        if (coin.dyakov_info) catalogInfo.push(`<div><strong>Дьяков:</strong> ${coin.dyakov_info}</div>`);
        
        elements.modalContent.innerHTML = `
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <!-- Images -->
                <div class="space-y-4">
                    ${images.length > 0 ? images.join('') : '<div class="text-center text-gray-500">Изображения недоступны</div>'}
                </div>
                
                <!-- Details -->
                <div class="space-y-4">
                    <div class="flex items-center justify-between">
                        <h3 class="text-lg font-semibold text-gray-800">Основная информация</h3>
                        ${rarityBadge}
                    </div>
                    
                    <div class="space-y-3">
                        <div class="flex justify-between">
                            <span class="text-gray-600">Номинал:</span>
                            <span class="font-medium">${coin.denomination}</span>
                        </div>
                        
                        <div class="flex justify-between">
                            <span class="text-gray-600">Название:</span>
                            <span class="font-medium">${coin.coin_name || 'Не указано'}</span>
                        </div>
                        
                        <div class="flex justify-between">
                            <span class="text-gray-600">Год:</span>
                            <span class="font-medium">${coin.year || 'Не указан'}</span>
                        </div>
                        
                        <div class="flex justify-between">
                            <span class="text-gray-600">Металл:</span>
                            <span class="font-medium">${coin.metal || 'Не указан'}</span>
                        </div>
                        
                        ${coin.mint ? `
                        <div class="flex justify-between">
                            <span class="text-gray-600">Монетный двор:</span>
                            <span class="font-medium">${coin.mint}</span>
                        </div>
                        ` : ''}
                        
                        ${coin.mintage ? `
                        <div class="flex justify-between">
                            <span class="text-gray-600">Тираж:</span>
                            <span class="font-medium">${coin.mintage.toLocaleString()}</span>
                        </div>
                        ` : ''}
                        
                        ${coin.condition ? `
                        <div class="flex justify-between">
                            <span class="text-gray-600">Состояние:</span>
                            <span class="font-medium">${coin.condition}</span>
                        </div>
                        ` : ''}
                        
                        <div class="flex justify-between">
                            <span class="text-gray-600">Аукцион:</span>
                            <span class="font-medium">${coin.auction_number}, лот ${coin.lot_number}</span>
                        </div>
                    </div>
                    
                    ${catalogInfo.length > 0 ? `
                    <div>
                        <h4 class="font-semibold text-gray-800 mb-2">Каталоги</h4>
                        <div class="space-y-1 text-sm">
                            ${catalogInfo.join('')}
                        </div>
                    </div>
                    ` : ''}
                    
                    ${coin.original_description ? `
                    <div>
                        <h4 class="font-semibold text-gray-800 mb-2">Оригинальное описание</h4>
                        <p class="text-sm text-gray-600 bg-gray-50 p-3 rounded">${coin.original_description}</p>
                    </div>
                    ` : ''}
                </div>
            </div>
        `;
        
        elements.coinModal.classList.remove('hidden');
        
    } catch (error) {
        console.error('Ошибка загрузки монеты:', error);
        alert('Ошибка загрузки информации о монете');
    }
}

// Close modal
function closeModal() {
    elements.coinModal.classList.add('hidden');
}

// Export catalog
function exportCatalog() {
    window.open('/api/catalog/export/csv', '_blank');
}

// Make functions globally accessible
window.changePage = changePage;

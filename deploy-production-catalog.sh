#!/bin/bash

# Развертывание продуктивного интерфейса каталога
# Заменяет тестовый интерфейс на полноценный каталог монет

echo "🚀 РАЗВЕРТЫВАНИЕ ПРОДУКТИВНОГО КАТАЛОГА..."
echo "====================================="

cd /var/www/catalog-interface

echo "📊 ЭТАП 1: Проверка текущего состояния каталога..."
echo "=============================================="

echo "🔍 Статус PM2:"
pm2 status

echo ""
echo "📊 ЭТАП 2: Остановка каталога..."
echo "=============================="

pm2 stop catalog-interface 2>/dev/null || true
pm2 delete catalog-interface 2>/dev/null || true

echo "✅ Каталог остановлен"

echo ""
echo "📊 ЭТАП 3: Создание продуктивного интерфейса..."
echo "==========================================="

# Создаем директорию public если её нет
mkdir -p public

echo "📋 Создание продуктивного index.html..."
cat > public/index.html << 'EOF'
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Каталог монет Wolmar</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://unpkg.com/alpinejs@3.x.x/dist/cdn.min.js" defer></script>
    <style>
        .coin-image {
            transition: transform 0.3s ease;
        }
        .coin-image:hover {
            transform: scale(1.05);
        }
        .loading {
            animation: spin 1s linear infinite;
        }
        @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }
    </style>
</head>
<body class="bg-gray-50">
    <div x-data="catalogApp()" class="min-h-screen">
        <!-- Header -->
        <header class="bg-white shadow-sm border-b">
            <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div class="flex justify-between items-center py-4">
                    <div class="flex items-center">
                        <h1 class="text-2xl font-bold text-gray-900">🏛️ Каталог монет Wolmar</h1>
                    </div>
                    <div class="flex items-center space-x-4">
                        <button @click="loadAuctions()" 
                                class="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors">
                            🔄 Обновить
                        </button>
                    </div>
                </div>
            </div>
        </header>

        <!-- Main Content -->
        <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <!-- Loading State -->
            <div x-show="loading" class="text-center py-8">
                <div class="loading inline-block w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full"></div>
                <p class="mt-2 text-gray-600">Загрузка каталога...</p>
            </div>

            <!-- Error State -->
            <div x-show="error" class="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
                <div class="flex">
                    <div class="flex-shrink-0">
                        <span class="text-red-400">❌</span>
                    </div>
                    <div class="ml-3">
                        <h3 class="text-sm font-medium text-red-800">Ошибка загрузки</h3>
                        <div class="mt-2 text-sm text-red-700" x-text="error"></div>
                    </div>
                </div>
            </div>

            <!-- Auctions List -->
            <div x-show="!loading && !error" class="space-y-6">
                <div class="bg-white rounded-lg shadow-sm border p-6">
                    <h2 class="text-xl font-semibold text-gray-900 mb-4">📊 Аукционы</h2>
                    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        <template x-for="auction in auctions" :key="auction.auction_number">
                            <div class="border rounded-lg p-4 hover:shadow-md transition-shadow cursor-pointer"
                                 @click="selectAuction(auction)">
                                <div class="flex justify-between items-start mb-2">
                                    <h3 class="font-semibold text-gray-900" x-text="'Аукцион ' + auction.auction_number"></h3>
                                    <span class="text-sm text-gray-500" x-text="auction.lots_count + ' лотов'"></span>
                                </div>
                                <div class="text-sm text-gray-600 space-y-1">
                                    <p x-text="'Общая стоимость: ' + formatPrice(auction.total_value)"></p>
                                    <p x-text="'Средняя цена: ' + formatPrice(auction.avg_bid)"></p>
                                    <p x-text="'Макс. цена: ' + formatPrice(auction.max_bid)"></p>
                                </div>
                            </div>
                        </template>
                    </div>
                </div>

                <!-- Selected Auction Lots -->
                <div x-show="selectedAuction" class="bg-white rounded-lg shadow-sm border p-6">
                    <div class="flex justify-between items-center mb-4">
                        <h2 class="text-xl font-semibold text-gray-900" 
                            x-text="'Лоты аукциона ' + selectedAuction.auction_number"></h2>
                        <button @click="selectedAuction = null" 
                                class="text-gray-500 hover:text-gray-700">
                            ✕ Закрыть
                        </button>
                    </div>

                    <!-- Filters -->
                    <div class="mb-6 p-4 bg-gray-50 rounded-lg">
                        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div>
                                <label class="block text-sm font-medium text-gray-700 mb-1">Поиск</label>
                                <input type="text" x-model="searchQuery" @input="filterLots()"
                                       placeholder="Поиск по описанию..."
                                       class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500">
                            </div>
                            <div>
                                <label class="block text-sm font-medium text-gray-700 mb-1">Металл</label>
                                <select x-model="selectedMetal" @change="filterLots()"
                                        class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500">
                                    <option value="">Все металлы</option>
                                    <template x-for="metal in metals" :key="metal">
                                        <option :value="metal" x-text="metal"></option>
                                    </template>
                                </select>
                            </div>
                            <div>
                                <label class="block text-sm font-medium text-gray-700 mb-1">Состояние</label>
                                <select x-model="selectedCondition" @change="filterLots()"
                                        class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500">
                                    <option value="">Все состояния</option>
                                    <template x-for="condition in conditions" :key="condition">
                                        <option :value="condition" x-text="condition"></option>
                                    </template>
                                </select>
                            </div>
                        </div>
                    </div>

                    <!-- Lots Grid -->
                    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        <template x-for="lot in filteredLots" :key="lot.id">
                            <div class="border rounded-lg p-4 hover:shadow-md transition-shadow cursor-pointer"
                                 @click="selectLot(lot)">
                                <div class="aspect-square mb-3 bg-gray-100 rounded-lg overflow-hidden">
                                    <img :src="lot.avers_image_url || '/placeholder-coin.png'" 
                                         :alt="lot.coin_description"
                                         class="w-full h-full object-cover coin-image"
                                         @error="$el.src='/placeholder-coin.png'">
                                </div>
                                <div class="space-y-2">
                                    <h4 class="font-medium text-gray-900 text-sm" x-text="lot.lot_number + '. ' + (lot.coin_description || 'Без описания')"></h4>
                                    <div class="text-sm text-gray-600">
                                        <p x-text="'Металл: ' + (lot.metal || 'Не указан')"></p>
                                        <p x-text="'Состояние: ' + (lot.condition || 'Не указано')"></p>
                                        <p x-text="'Год: ' + (lot.year || 'Не указан')"></p>
                                    </div>
                                    <div class="flex justify-between items-center">
                                        <span class="font-semibold text-green-600" x-text="formatPrice(lot.winning_bid)"></span>
                                        <span class="text-xs text-gray-500" x-text="lot.bids_count + ' ставок'"></span>
                                    </div>
                                </div>
                            </div>
                        </template>
                    </div>

                    <!-- Pagination -->
                    <div x-show="totalPages > 1" class="mt-6 flex justify-center">
                        <nav class="flex space-x-2">
                            <button @click="currentPage = Math.max(1, currentPage - 1)" 
                                    :disabled="currentPage === 1"
                                    class="px-3 py-2 text-sm border rounded-md hover:bg-gray-50 disabled:opacity-50">
                                ← Предыдущая
                            </button>
                            <span class="px-3 py-2 text-sm text-gray-600" 
                                  x-text="'Страница ' + currentPage + ' из ' + totalPages"></span>
                            <button @click="currentPage = Math.min(totalPages, currentPage + 1)" 
                                    :disabled="currentPage === totalPages"
                                    class="px-3 py-2 text-sm border rounded-md hover:bg-gray-50 disabled:opacity-50">
                                Следующая →
                            </button>
                        </nav>
                    </div>
                </div>

                <!-- Selected Lot Modal -->
                <div x-show="selectedLot" x-transition class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
                    <div class="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                        <div class="p-6">
                            <div class="flex justify-between items-center mb-4">
                                <h3 class="text-lg font-semibold text-gray-900" 
                                    x-text="'Лот ' + selectedLot.lot_number"></h3>
                                <button @click="selectedLot = null" 
                                        class="text-gray-500 hover:text-gray-700">
                                    ✕ Закрыть
                                </button>
                            </div>
                            
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div class="space-y-4">
                                    <div class="aspect-square bg-gray-100 rounded-lg overflow-hidden">
                                        <img :src="selectedLot.avers_image_url || '/placeholder-coin.png'" 
                                             :alt="selectedLot.coin_description"
                                             class="w-full h-full object-cover">
                                    </div>
                                    <div x-show="selectedLot.revers_image_url" class="aspect-square bg-gray-100 rounded-lg overflow-hidden">
                                        <img :src="selectedLot.revers_image_url" 
                                             :alt="selectedLot.coin_description + ' (реверс)'"
                                             class="w-full h-full object-cover">
                                    </div>
                                </div>
                                
                                <div class="space-y-4">
                                    <div>
                                        <h4 class="font-medium text-gray-900 mb-2">Описание</h4>
                                        <p class="text-gray-600" x-text="selectedLot.coin_description || 'Описание отсутствует'"></p>
                                    </div>
                                    
                                    <div class="grid grid-cols-2 gap-4">
                                        <div>
                                            <h5 class="font-medium text-gray-900 mb-1">Металл</h5>
                                            <p class="text-gray-600" x-text="selectedLot.metal || 'Не указан'"></p>
                                        </div>
                                        <div>
                                            <h5 class="font-medium text-gray-900 mb-1">Состояние</h5>
                                            <p class="text-gray-600" x-text="selectedLot.condition || 'Не указано'"></p>
                                        </div>
                                        <div>
                                            <h5 class="font-medium text-gray-900 mb-1">Год</h5>
                                            <p class="text-gray-600" x-text="selectedLot.year || 'Не указан'"></p>
                                        </div>
                                        <div>
                                            <h5 class="font-medium text-gray-900 mb-1">Ставок</h5>
                                            <p class="text-gray-600" x-text="selectedLot.bids_count || '0'"></p>
                                        </div>
                                    </div>
                                    
                                    <div class="border-t pt-4">
                                        <div class="flex justify-between items-center">
                                            <span class="text-lg font-semibold text-gray-900">Цена продажи</span>
                                            <span class="text-2xl font-bold text-green-600" x-text="formatPrice(selectedLot.winning_bid)"></span>
                                        </div>
                                        <div class="text-sm text-gray-500 mt-1">
                                            <p x-text="'Победитель: ' + (selectedLot.winner_login || 'Не указан')"></p>
                                            <p x-text="'Дата аукциона: ' + formatDate(selectedLot.auction_end_date)"></p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </main>
    </div>

    <script>
        function catalogApp() {
            return {
                loading: true,
                error: null,
                auctions: [],
                selectedAuction: null,
                lots: [],
                filteredLots: [],
                selectedLot: null,
                searchQuery: '',
                selectedMetal: '',
                selectedCondition: '',
                metals: [],
                conditions: [],
                currentPage: 1,
                itemsPerPage: 20,
                totalPages: 1,

                async init() {
                    await this.loadAuctions();
                },

                async loadAuctions() {
                    try {
                        this.loading = true;
                        this.error = null;
                        
                        const response = await fetch('/api/auctions');
                        if (!response.ok) throw new Error('Ошибка загрузки аукционов');
                        
                        this.auctions = await response.json();
                    } catch (error) {
                        this.error = error.message;
                    } finally {
                        this.loading = false;
                    }
                },

                async selectAuction(auction) {
                    try {
                        this.loading = true;
                        this.selectedAuction = auction;
                        this.selectedLot = null;
                        
                        const response = await fetch(`/api/auctions/${auction.auction_number}/lots`);
                        if (!response.ok) throw new Error('Ошибка загрузки лотов');
                        
                        this.lots = await response.json();
                        this.filteredLots = [...this.lots];
                        this.currentPage = 1;
                        this.updatePagination();
                        
                        // Загружаем фильтры
                        await this.loadFilters();
                    } catch (error) {
                        this.error = error.message;
                    } finally {
                        this.loading = false;
                    }
                },

                async loadFilters() {
                    try {
                        const response = await fetch(`/api/filters?auctionNumber=${this.selectedAuction.auction_number}`);
                        if (!response.ok) throw new Error('Ошибка загрузки фильтров');
                        
                        const filters = await response.json();
                        this.metals = filters.metals || [];
                        this.conditions = filters.conditions || [];
                    } catch (error) {
                        console.error('Ошибка загрузки фильтров:', error);
                    }
                },

                filterLots() {
                    let filtered = [...this.lots];
                    
                    if (this.searchQuery) {
                        filtered = filtered.filter(lot => 
                            lot.coin_description?.toLowerCase().includes(this.searchQuery.toLowerCase())
                        );
                    }
                    
                    if (this.selectedMetal) {
                        filtered = filtered.filter(lot => lot.metal === this.selectedMetal);
                    }
                    
                    if (this.selectedCondition) {
                        filtered = filtered.filter(lot => lot.condition === this.selectedCondition);
                    }
                    
                    this.filteredLots = filtered;
                    this.currentPage = 1;
                    this.updatePagination();
                },

                updatePagination() {
                    this.totalPages = Math.ceil(this.filteredLots.length / this.itemsPerPage);
                    const start = (this.currentPage - 1) * this.itemsPerPage;
                    const end = start + this.itemsPerPage;
                    this.filteredLots = this.filteredLots.slice(start, end);
                },

                selectLot(lot) {
                    this.selectedLot = lot;
                },

                formatPrice(price) {
                    if (!price) return 'Не указано';
                    return new Intl.NumberFormat('ru-RU', {
                        style: 'currency',
                        currency: 'RUB',
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 0
                    }).format(price);
                },

                formatDate(dateString) {
                    if (!dateString) return 'Не указано';
                    return new Date(dateString).toLocaleDateString('ru-RU');
                }
            }
        }
    </script>
</body>
</html>
EOF

echo "✅ Продуктивный index.html создан"

echo ""
echo "📊 ЭТАП 4: Создание placeholder изображения..."
echo "============================================="

# Создаем простое placeholder изображение
cat > public/placeholder-coin.png << 'EOF'
data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgdmlld0JveD0iMCAwIDIwMCAyMDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIyMDAiIGhlaWdodD0iMjAwIiBmaWxsPSIjRjNGNEY2Ii8+CjxjaXJjbGUgY3g9IjEwMCIgY3k9IjEwMCIgcj0iODAiIGZpbGw9IiNFNUU3RUIiLz4KPGNpcmNsZSBjeD0iMTAwIiBjeT0iMTAwIiByPSI2MCIgZmlsbD0iI0QxRDVEQyIvPgo8dGV4dCB4PSIxMDAiIHk9IjExMCIgZm9udC1mYW1pbHk9IkFyaWFsLCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjE0IiBmaWxsPSIjNkI3MjgwIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIj7wn5GAPC90ZXh0Pgo8L3N2Zz4K
EOF

echo "✅ Placeholder изображение создано"

echo ""
echo "📊 ЭТАП 5: Проверка синтаксиса server.js..."
echo "========================================="

echo "📋 Проверка синтаксиса server.js:"
node -c server.js 2>&1

if [ $? -eq 0 ]; then
    echo "✅ server.js синтаксически корректен"
else
    echo "❌ Ошибка синтаксиса в server.js"
    exit 1
fi

echo ""
echo "📊 ЭТАП 6: Запуск продуктивного каталога..."
echo "========================================"

pm2 start server.js --name "catalog-interface"

if [ $? -eq 0 ]; then
    echo "✅ Продуктивный каталог запущен"
else
    echo "❌ Ошибка запуска продуктивного каталога"
    exit 1
fi

echo ""
echo "⏳ ЭТАП 7: Ожидание запуска..."
echo "============================="

sleep 5

echo ""
echo "📊 ЭТАП 8: Проверка работы продуктивного каталога..."
echo "================================================"

echo "🔍 Статус PM2:"
pm2 status

echo ""
echo "🧪 Тестирование API каталога:"
curl -s http://localhost:3000/api/test | jq . 2>/dev/null || curl -s http://localhost:3000/api/test

echo ""
echo "🌐 Тестирование внешнего доступа:"
curl -s http://46.173.19.68:3000/api/test | jq . 2>/dev/null || curl -s http://46.173.19.68:3000/api/test

echo ""
echo "📊 ЭТАП 9: Проверка веб-интерфейса..."
echo "==================================="

echo "🌐 Проверка главной страницы каталога:"
curl -s http://46.173.19.68:3000 | grep -o '<title>.*</title>' || echo "Заголовок не найден"

echo ""
echo "📋 Логи каталога:"
pm2 logs catalog-interface --lines 10

echo ""
echo "✅ РАЗВЕРТЫВАНИЕ ПРОДУКТИВНОГО КАТАЛОГА ЗАВЕРШЕНО!"
echo "==============================================="
echo "🌐 Каталог монет: http://46.173.19.68:3000"
echo "🧪 Тестовый API: http://46.173.19.68:3000/api/test"
echo "📊 API аукционов: http://46.173.19.68:3000/api/auctions"
echo "📊 Мониторинг: pm2 status"
echo "📋 Логи каталога: pm2 logs catalog-interface"

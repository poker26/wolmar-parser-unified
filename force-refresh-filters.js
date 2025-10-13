// Скрипт для принудительного обновления фильтров в браузере
// Запустите этот код в консоли браузера (F12 -> Console)

console.log('🔄 Принудительное обновление фильтров...');

// Очищаем кэш API
if (typeof apiCache !== 'undefined') {
    apiCache.clear();
    console.log('✅ Кэш API очищен');
}

// Принудительно загружаем фильтры
if (typeof loadGlobalFilters !== 'undefined') {
    loadGlobalFilters().then(() => {
        console.log('✅ Фильтры перезагружены');
    }).catch(error => {
        console.error('❌ Ошибка загрузки фильтров:', error);
    });
} else {
    console.log('⚠️ Функция loadGlobalFilters не найдена');
}

// Альтернативный способ - прямой запрос к API
fetch('/api/filters', {
    cache: 'no-cache',
    headers: {
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
    }
})
.then(response => response.json())
.then(data => {
    console.log('📊 Новые данные фильтров:', data);
    if (data.categories && data.categories.length > 0) {
        console.log(`✅ Найдено ${data.categories.length} категорий:`, data.categories);
    } else {
        console.log('⚠️ Категории все еще пусты');
    }
})
.catch(error => {
    console.error('❌ Ошибка запроса к API:', error);
});

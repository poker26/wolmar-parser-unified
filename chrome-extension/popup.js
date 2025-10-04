// Popup script for Meshok Parser Extension
document.addEventListener('DOMContentLoaded', () => {
    console.log('Popup loaded');
    
    const statusDiv = document.getElementById('status');
    const statusText = document.getElementById('statusText');
    const pageStatus = document.getElementById('pageStatus');
    const itemCount = document.getElementById('itemCount');
    const priceCount = document.getElementById('priceCount');
    
    const bypassBtn = document.getElementById('bypassBtn');
    const extractBtn = document.getElementById('extractBtn');
    const refreshBtn = document.getElementById('refreshBtn');
    
    // Обновление статуса
    function updateStatus(message, type = 'success') {
        statusText.textContent = message;
        statusDiv.className = `status ${type}`;
    }
    
    // Получение информации о странице
    function getPageInfo() {
        chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, {action: 'getPageInfo'}, (response) => {
                    if (response) {
                        pageStatus.textContent = response.readyState;
                        updateStatus(`Connected to: ${response.title}`, 'success');
                    } else {
                        updateStatus('Not connected to meshok.net', 'error');
                    }
                });
            }
        });
    }
    
    // Обход защиты
    bypassBtn.addEventListener('click', () => {
        updateStatus('Attempting to bypass protection...', 'success');
        
        chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, {action: 'bypassProtection'}, (response) => {
                    if (response && response.success) {
                        updateStatus('Protection bypassed successfully!', 'success');
                    } else {
                        updateStatus('Failed to bypass protection', 'error');
                    }
                });
            }
        });
    });
    
    // Извлечение данных
    extractBtn.addEventListener('click', () => {
        updateStatus('Extracting data...', 'success');
        
        chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, {action: 'extractData'}, (response) => {
                    if (response) {
                        itemCount.textContent = response.items.length;
                        priceCount.textContent = response.prices.length;
                        updateStatus(`Extracted ${response.items.length} items, ${response.prices.length} prices`, 'success');
                        
                        // Сохранение данных
                        chrome.storage.local.set({
                            'lastExtraction': response,
                            'extractionTime': Date.now()
                        });
                    } else {
                        updateStatus('Failed to extract data', 'error');
                    }
                });
            }
        });
    });
    
    // Обновление страницы
    refreshBtn.addEventListener('click', () => {
        chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
            if (tabs[0]) {
                chrome.tabs.reload(tabs[0].id);
                updateStatus('Page refreshed', 'success');
            }
        });
    });
    
    // Инициализация
    getPageInfo();
    
    // Обновление каждые 5 секунд
    setInterval(() => {
        getPageInfo();
    }, 5000);
});

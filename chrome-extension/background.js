// Background script for Meshok Parser Extension
console.log('Meshok Parser Extension: Background script loaded');

// Обработка сообщений от content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('Background received message:', request);
    
    if (request.action === 'bypassProtection') {
        // Логика обхода защиты
        console.log('Attempting to bypass protection...');
        
        // Имитация человеческого поведения
        setTimeout(() => {
            sendResponse({success: true, message: 'Protection bypassed'});
        }, 1000);
        
        return true; // Асинхронный ответ
    }
    
    if (request.action === 'getPageData') {
        // Получение данных страницы
        chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, {action: 'extractData'}, (response) => {
                    sendResponse(response);
                });
            }
        });
        
        return true; // Асинхронный ответ
    }
});

// Обработка установки расширения
chrome.runtime.onInstalled.addListener((details) => {
    console.log('Meshok Parser Extension installed:', details.reason);
    
    // Установка начальных настроек
    chrome.storage.local.set({
        'bypassEnabled': true,
        'lastUpdate': Date.now()
    });
});

// Обработка обновления расширения
chrome.runtime.onUpdateAvailable.addListener((details) => {
    console.log('Update available:', details);
    chrome.runtime.reload();
});

// Обработка ошибок
chrome.runtime.onSuspend.addListener(() => {
    console.log('Extension suspended');
});

// Обработка подключения к расширению
chrome.runtime.onConnect.addListener((port) => {
    console.log('Port connected:', port.name);
    
    port.onMessage.addListener((msg) => {
        console.log('Port message:', msg);
        
        if (msg.action === 'keepAlive') {
            // Поддержание соединения
            setTimeout(() => {
                port.postMessage({action: 'pong'});
            }, 1000);
        }
    });
    
    port.onDisconnect.addListener(() => {
        console.log('Port disconnected');
    });
});

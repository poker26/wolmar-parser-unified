// Background script for Meshok Parser Extension based on Habr article
console.log('Meshok Parser Extension: Background script loaded');

// Обработка сообщений от content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('Background received message:', request);
    
    if (request.action === 'bypassProtection') {
        // Логика обхода защиты на основе статьи
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

// Обработка подключения к расширению (из статьи)
chrome.runtime.onConnect.addListener((port) => {
    console.log('Port connected:', port.name);
    
    if (port.name === 'keepAlive') {
        // Поддержание соединения как в статье
        setTimeout(() => port.disconnect(), 250e3);
        port.onDisconnect.addListener(ensurePersistentTabOpen);
    }
    
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

// Функция для поддержания persistent tab (из статьи)
async function ensurePersistentTabOpen(){
    var url = chrome.runtime.getURL("persistent.html")
    var tabs = await chrome.tabs.query({});
    var persistentTab = tabs.find(t => t.url == url);
    if (!persistentTab){
        persistentTab = await chrome.tabs.create({ 
            url: url, 
            active: false 
        });
    }
    return persistentTab;
}

// Обработка подключения к DevTools Protocol
chrome.runtime.onConnectExternal.addListener((port) => {
    console.log('External connection:', port.name);
    
    if (port.name === 'devtools') {
        // Подключение к Chrome DevTools Protocol
        port.onMessage.addListener((message) => {
            console.log('DevTools message:', message);
            
            // Обработка команд от сервера
            if (message.action === 'navigate') {
                chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
                    if (tabs[0]) {
                        chrome.tabs.update(tabs[0].id, {url: message.url});
                    }
                });
            }
            
            if (message.action === 'extractData') {
                chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
                    if (tabs[0]) {
                        chrome.tabs.sendMessage(tabs[0].id, {action: 'extractData'}, (response) => {
                            port.postMessage(response);
                        });
                    }
                });
            }
        });
    }
});
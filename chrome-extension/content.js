// Content script for Meshok Parser Extension
console.log('Meshok Parser Extension: Content script loaded');

// Функция обхода защиты от ботов
function bypassBotProtection() {
    console.log('Attempting to bypass bot protection...');
    
    // Имитация человеческого поведения
    const humanBehavior = {
        // Случайные движения мыши
        simulateMouseMovement: () => {
            const event = new MouseEvent('mousemove', {
                clientX: Math.random() * window.innerWidth,
                clientY: Math.random() * window.innerHeight,
                bubbles: true
            });
            document.dispatchEvent(event);
        },
        
        // Случайные клики
        simulateClicks: () => {
            const event = new MouseEvent('click', {
                clientX: Math.random() * window.innerWidth,
                clientY: Math.random() * window.innerHeight,
                bubbles: true
            });
            document.dispatchEvent(event);
        },
        
        // Имитация скроллинга
        simulateScroll: () => {
            window.scrollBy(0, Math.random() * 100);
        },
        
        // Имитация фокуса
        simulateFocus: () => {
            const elements = document.querySelectorAll('input, button, a');
            if (elements.length > 0) {
                const randomElement = elements[Math.floor(Math.random() * elements.length)];
                randomElement.focus();
            }
        }
    };
    
    // Выполняем человеческие действия
    setTimeout(() => humanBehavior.simulateMouseMovement(), 100);
    setTimeout(() => humanBehavior.simulateClicks(), 200);
    setTimeout(() => humanBehavior.simulateScroll(), 300);
    setTimeout(() => humanBehavior.simulateFocus(), 400);
    
    return true;
}

// Функция извлечения данных со страницы
function extractPageData() {
    console.log('Extracting page data...');
    
    const data = {
        title: document.title,
        url: window.location.href,
        timestamp: Date.now(),
        items: [],
        prices: [],
        tables: [],
        forms: [],
        jsonData: []
    };
    
    // Извлечение ссылок на лоты
    const itemLinks = document.querySelectorAll('a[href*="/item/"]');
    itemLinks.forEach(link => {
        data.items.push({
            href: link.href,
            text: link.textContent.trim(),
            title: link.title || ''
        });
    });
    
    // Извлечение цен
    const priceRegex = /[0-9,]+[ ]*₽|[0-9,]+[ ]*руб/g;
    const pageText = document.body.textContent;
    const priceMatches = pageText.match(priceRegex);
    if (priceMatches) {
        data.prices = priceMatches;
    }
    
    // Извлечение таблиц
    const tables = document.querySelectorAll('table');
    tables.forEach((table, index) => {
        data.tables.push({
            index: index,
            rows: table.rows.length,
            cells: table.cells.length
        });
    });
    
    // Извлечение форм
    const forms = document.querySelectorAll('form');
    forms.forEach((form, index) => {
        data.forms.push({
            index: index,
            action: form.action,
            method: form.method,
            inputs: form.querySelectorAll('input').length
        });
    });
    
    // Извлечение JSON данных из script тегов
    const scripts = document.querySelectorAll('script');
    scripts.forEach(script => {
        const content = script.textContent;
        const jsonMatches = content.match(/\{[^{}]*"[^"]*"[^{}]*\}/g);
        if (jsonMatches) {
            data.jsonData.push(...jsonMatches);
        }
    });
    
    return data;
}

// Обработка сообщений от background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('Content script received message:', request);
    
    if (request.action === 'bypassProtection') {
        const result = bypassBotProtection();
        sendResponse({success: result});
    }
    
    if (request.action === 'extractData') {
        const data = extractPageData();
        sendResponse(data);
    }
    
    if (request.action === 'getPageInfo') {
        const info = {
            title: document.title,
            url: window.location.href,
            readyState: document.readyState,
            userAgent: navigator.userAgent,
            timestamp: Date.now()
        };
        sendResponse(info);
    }
    
    return true;
});

// Автоматический обход защиты при загрузке страницы
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        console.log('DOM loaded, attempting bypass...');
        bypassBotProtection();
    });
} else {
    console.log('DOM already loaded, attempting bypass...');
    bypassBotProtection();
}

// Обработка изменений в DOM
const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
        if (mutation.type === 'childList') {
            // Проверяем на появление элементов защиты
            const protectionElements = document.querySelectorAll('[class*="cloudflare"], [class*="challenge"], [class*="bot"]');
            if (protectionElements.length > 0) {
                console.log('Protection elements detected, attempting bypass...');
                bypassBotProtection();
            }
        }
    });
});

observer.observe(document.body, {
    childList: true,
    subtree: true
});

// Обработка ошибок
window.addEventListener('error', (event) => {
    console.log('Page error:', event.error);
});

// Обработка unhandledrejection
window.addEventListener('unhandledrejection', (event) => {
    console.log('Unhandled promise rejection:', event.reason);
});

console.log('Meshok Parser Extension: Content script ready');

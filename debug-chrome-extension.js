const puppeteer = require('puppeteer');

async function debugChromeExtension() {
    try {
        console.log('🔍 Подключаемся к Chrome с расширением...');
        
        const browser = await puppeteer.connect({
            browserURL: 'http://localhost:9222'
        });

        const page = await browser.newPage();
        
        // Переходим на Meshok
        console.log('🪙 Переходим на Meshok...');
        await page.goto('https://meshok.net/good/252');
        
        // Ждем и проверяем статус
        console.log('⏳ Ждем 10 секунд...');
        await new Promise(resolve => setTimeout(resolve, 10000));
        
        const status = await page.evaluate(() => {
            return {
                title: document.title,
                url: window.location.href,
                hasApp: !!document.querySelector('#app'),
                hasCloudflare: document.body.textContent.includes('Just a moment'),
                hasMeshok: document.body.textContent.includes('meshok'),
                bodyLength: document.body.textContent.length,
                appContent: document.querySelector('#app')?.innerHTML || '',
                hasScripts: document.querySelectorAll('script').length
            };
        });
        
        console.log('📊 СТАТУС CHROME:');
        console.log('Title:', status.title);
        console.log('URL:', status.url);
        console.log('Есть #app:', status.hasApp);
        console.log('Есть Cloudflare:', status.hasCloudflare);
        console.log('Есть Meshok:', status.hasMeshok);
        console.log('Длина body:', status.bodyLength);
        console.log('Содержимое #app:', status.appContent);
        console.log('Количество скриптов:', status.hasScripts);
        
        // Проверяем, есть ли расширение
        const extensionStatus = await page.evaluate(() => {
            return {
                hasChrome: typeof chrome !== 'undefined',
                hasRuntime: typeof chrome !== 'undefined' && chrome.runtime,
                extensions: typeof chrome !== 'undefined' && chrome.runtime ? chrome.runtime.id : null
            };
        });
        
        console.log('📊 СТАТУС РАСШИРЕНИЯ:');
        console.log('Chrome API:', extensionStatus.hasChrome);
        console.log('Runtime:', extensionStatus.hasRuntime);
        console.log('Extension ID:', extensionStatus.extensions);
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    }
}

debugChromeExtension();

const puppeteer = require('puppeteer');

async function testExtensionStatus() {
    try {
        console.log('🔍 Подключаемся к Chrome с расширением...');
        
        const browser = await puppeteer.connect({
            browserURL: 'http://localhost:9222'
        });

        const page = await browser.newPage();
        
        // Проверяем, загружено ли расширение
        console.log('🔍 Проверяем расширение...');
        const extensionInfo = await page.evaluate(() => {
            return {
                hasChrome: typeof chrome !== 'undefined',
                hasRuntime: typeof chrome !== 'undefined' && chrome.runtime,
                hasTabs: typeof chrome !== 'undefined' && chrome.tabs,
                extensions: typeof chrome !== 'undefined' && chrome.runtime ? chrome.runtime.id : null,
                userAgent: navigator.userAgent
            };
        });
        
        console.log('📊 СТАТУС РАСШИРЕНИЯ:');
        console.log('Chrome API доступен:', extensionInfo.hasChrome);
        console.log('Runtime доступен:', extensionInfo.hasRuntime);
        console.log('Tabs доступен:', extensionInfo.hasTabs);
        console.log('Extension ID:', extensionInfo.extensions);
        console.log('User Agent:', extensionInfo.userAgent);
        
        // Тестируем на простом сайте
        console.log('🌐 Тестируем на простом сайте...');
        await page.goto('https://httpbin.org/html');
        const simpleContent = await page.content();
        console.log('✅ Простой сайт загружен, длина:', simpleContent.length);
        
        // Тестируем на Meshok
        console.log('🪙 Тестируем на Meshok...');
        await page.goto('https://meshok.net/good/252');
        await new Promise(resolve => setTimeout(resolve, 10000));
        
        const meshokContent = await page.content();
        console.log('✅ Meshok загружен, длина:', meshokContent.length);
        
        // Проверяем, что получили
        const analysis = await page.evaluate(() => {
            return {
                title: document.title,
                url: window.location.href,
                hasApp: !!document.querySelector('#app'),
                hasCloudflare: document.body.textContent.includes('Just a moment'),
                hasMeshok: document.body.textContent.includes('meshok'),
                bodyText: document.body.textContent.substring(0, 200)
            };
        });
        
        console.log('📊 АНАЛИЗ MESHOK:');
        console.log('Title:', analysis.title);
        console.log('URL:', analysis.url);
        console.log('Есть #app:', analysis.hasApp);
        console.log('Есть Cloudflare:', analysis.hasCloudflare);
        console.log('Есть Meshok:', analysis.hasMeshok);
        console.log('Первые 200 символов:', analysis.bodyText);
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    }
}

testExtensionStatus();

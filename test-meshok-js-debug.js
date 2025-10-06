const puppeteer = require('puppeteer');

async function testMeshokJSDebug() {
    try {
        console.log('🔍 Подключаемся к Chrome с расширением...');
        
        const browser = await puppeteer.connect({
            browserURL: 'http://localhost:9222'
        });

        const page = await browser.newPage();
        
        // Включаем JavaScript и cookies
        await page.setJavaScriptEnabled(true);
        
        // Устанавливаем user agent
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        // Переходим на Meshok
        console.log('🪙 Переходим на Meshok...');
        await page.goto('https://meshok.net/good/252', {
            waitUntil: 'networkidle2',
            timeout: 60000
        });
        
        // Проверяем, работает ли JavaScript
        console.log('🔍 Проверяем JavaScript...');
        const jsTest = await page.evaluate(() => {
            return {
                hasWindow: typeof window !== 'undefined',
                hasDocument: typeof document !== 'undefined',
                hasConsole: typeof console !== 'undefined',
                userAgent: navigator.userAgent,
                title: document.title,
                url: window.location.href,
                hasApp: !!document.querySelector('#app'),
                appContent: document.querySelector('#app')?.innerHTML || '',
                hasScripts: document.querySelectorAll('script').length,
                hasModules: document.querySelectorAll('script[type="module"]').length
            };
        });
        
        console.log('📊 JAVASCRIPT ДИАГНОСТИКА:');
        console.log('Window доступен:', jsTest.hasWindow);
        console.log('Document доступен:', jsTest.hasDocument);
        console.log('Console доступен:', jsTest.hasConsole);
        console.log('User Agent:', jsTest.userAgent);
        console.log('Title:', jsTest.title);
        console.log('URL:', jsTest.url);
        console.log('Есть #app:', jsTest.hasApp);
        console.log('Количество script тегов:', jsTest.hasScripts);
        console.log('Количество module скриптов:', jsTest.hasModules);
        console.log('Содержимое #app:', jsTest.appContent);
        
        // Ждем еще немного
        console.log('⏳ Ждем 15 секунд...');
        await new Promise(resolve => setTimeout(resolve, 15000));
        
        // Проверяем снова
        const jsTest2 = await page.evaluate(() => {
            return {
                appContent: document.querySelector('#app')?.innerHTML || '',
                appText: document.querySelector('#app')?.textContent || '',
                hasSplashscreen: !!document.querySelector('.splashscreen'),
                splashscreenHidden: document.querySelector('.splashscreen')?.classList.contains('splashscreen--hidden') || false
            };
        });
        
        console.log('📊 ПОСЛЕ 15 СЕКУНД:');
        console.log('Содержимое #app:', jsTest2.appContent);
        console.log('Текст #app:', jsTest2.appText);
        console.log('Есть splashscreen:', jsTest2.hasSplashscreen);
        console.log('Splashscreen скрыт:', jsTest2.splashscreenHidden);
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    }
}

testMeshokJSDebug();

const puppeteer = require('puppeteer');

async function testMeshokSPA() {
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
        
        // Ждем исчезновения splashscreen
        console.log('⏳ Ждем исчезновения splashscreen...');
        try {
            await page.waitForSelector('.splashscreen--hidden', { timeout: 30000 });
            console.log('✅ Splashscreen скрыт');
        } catch (e) {
            console.log('⚠️ Splashscreen не скрылся, продолжаем...');
        }
        
        // Ждем загрузки контента в #app
        console.log('⏳ Ждем загрузки контента в #app...');
        await new Promise(resolve => setTimeout(resolve, 10000));
        
        // Проверяем, что загрузилось в #app
        const appContent = await page.evaluate(() => {
            const app = document.querySelector('#app');
            return {
                appHTML: app ? app.innerHTML : '',
                appText: app ? app.textContent : '',
                hasItems: app ? app.querySelectorAll('.item, .product, .lot').length : 0,
                hasContent: app ? app.textContent.length > 100 : false
            };
        });
        
        console.log('📊 СОДЕРЖИМОЕ #app:');
        console.log('HTML длина:', appContent.appHTML.length);
        console.log('Текст длина:', appContent.appText.length);
        console.log('Количество товаров:', appContent.hasItems);
        console.log('Есть контент:', appContent.hasContent);
        
        if (appContent.appHTML.length > 100) {
            console.log('✅ Контент загружен в #app!');
            console.log('Первые 500 символов:', appContent.appText.substring(0, 500));
        } else {
            console.log('❌ Контент не загрузился в #app');
            console.log('HTML #app:', appContent.appHTML);
        }
        
        // Проверяем общий контент
        const content = await page.content();
        console.log('✅ Общий контент, длина:', content.length);
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    }
}

testMeshokSPA();

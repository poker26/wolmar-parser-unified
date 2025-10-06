const puppeteer = require('puppeteer');

async function analyzeMeshokContent() {
    try {
        console.log('🔍 Подключаемся к Chrome с расширением...');
        
        const browser = await puppeteer.connect({
            browserURL: 'http://localhost:9222'
        });

        const page = await browser.newPage();
        
        // Переходим на Meshok
        console.log('🪙 Переходим на Meshok...');
        await page.goto('https://meshok.net/good/252');
        
        // Ждем загрузки
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        const content = await page.content();
        console.log('✅ Контент получен, длина:', content.length);
        
        // Анализируем контент
        console.log('\n📊 АНАЛИЗ КОНТЕНТА:');
        console.log('Первые 200 символов:', content.substring(0, 200));
        console.log('\n🔍 Поиск ключевых слов:');
        
        // Проверяем различные индикаторы
        const indicators = {
            'Just a moment': content.includes('Just a moment'),
            'Cloudflare': content.includes('Cloudflare'),
            'challenge': content.includes('challenge'),
            'bot': content.includes('bot'),
            'captcha': content.includes('captcha'),
            'meshok': content.toLowerCase().includes('meshok'),
            'монеты': content.toLowerCase().includes('монеты'),
            'coins': content.toLowerCase().includes('coins'),
            'товар': content.toLowerCase().includes('товар'),
            'item': content.toLowerCase().includes('item')
        };
        
        Object.entries(indicators).forEach(([key, value]) => {
            console.log(`${key}: ${value ? '✅' : '❌'}`);
        });
        
        // Проверяем заголовок страницы
        const title = await page.title();
        console.log('\n📄 Заголовок страницы:', title);
        
        // Проверяем URL
        const url = page.url();
        console.log('🌐 Текущий URL:', url);
        
        // Проверяем, есть ли элементы на странице
        const elements = await page.evaluate(() => {
            return {
                bodyText: document.body ? document.body.textContent.substring(0, 500) : 'No body',
                hasItems: document.querySelectorAll('.item').length,
                hasProducts: document.querySelectorAll('.product').length,
                hasGoods: document.querySelectorAll('.good').length,
                hasLots: document.querySelectorAll('.lot').length
            };
        });
        
        console.log('\n🔍 ЭЛЕМЕНТЫ СТРАНИЦЫ:');
        console.log('Текст body (первые 500 символов):', elements.bodyText);
        console.log('Количество .item элементов:', elements.hasItems);
        console.log('Количество .product элементов:', elements.hasProducts);
        console.log('Количество .good элементов:', elements.hasGoods);
        console.log('Количество .lot элементов:', elements.hasLots);
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    }
}

analyzeMeshokContent();

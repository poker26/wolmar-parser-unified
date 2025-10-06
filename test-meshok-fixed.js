const puppeteer = require('puppeteer');

async function testMeshok() {
    try {
        console.log('🔍 Подключаемся к Chrome с расширением...');
        
        // Подключаемся к уже запущенному Chrome с расширением
        const browser = await puppeteer.connect({
            browserURL: 'http://localhost:9222'
        });

        console.log('✅ Подключились к Chrome');
        
        const page = await browser.newPage();
        console.log('✅ Создали новую страницу');
        
        // Тестируем на Meshok
        console.log('🪙 Переходим на Meshok...');
        await page.goto('https://meshok.net/good/252');
        
        // Используем правильный способ ожидания
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        const meshokContent = await page.content();
        console.log('✅ Meshok контент получен, длина:', meshokContent.length);
        
        // Проверяем, есть ли Cloudflare
        if (meshokContent.includes('Just a moment')) {
            console.log('❌ Cloudflare все еще блокирует');
            console.log('Первые 500 символов:', meshokContent.substring(0, 500));
        } else {
            console.log('✅ Cloudflare обойден!');
            console.log('Первые 500 символов:', meshokContent.substring(0, 500));
        }
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    }
}

testMeshok();

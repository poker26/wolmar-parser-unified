const puppeteer = require('puppeteer');

async function testMeshokLongWait() {
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
        
        // Ждем загрузки JavaScript - УВЕЛИЧИВАЕМ ВРЕМЯ
        console.log('⏳ Ждем загрузки JavaScript (30 секунд)...');
        await new Promise(resolve => setTimeout(resolve, 30000));
        
        // Проверяем статус
        const status = await page.evaluate(() => {
            const challenge = document.querySelector('#challenge-error-text');
            const body = document.body ? document.body.textContent : '';
            
            return {
                hasChallenge: !!challenge,
                challengeText: challenge ? challenge.textContent : null,
                bodyLength: body.length,
                hasMeshokContent: body.toLowerCase().includes('монеты') || body.toLowerCase().includes('товар'),
                title: document.title,
                url: window.location.href
            };
        });
        
        console.log('📊 СТАТУС ПОСЛЕ 30 СЕКУНД:');
        console.log('Challenge активен:', status.hasChallenge);
        console.log('Challenge текст:', status.challengeText);
        console.log('Длина body:', status.bodyLength);
        console.log('Есть контент Meshok:', status.hasMeshokContent);
        console.log('Заголовок:', status.title);
        console.log('URL:', status.url);
        
        const content = await page.content();
        console.log('✅ Финальный контент, длина:', content.length);
        
        // Проверяем результат
        if (status.hasChallenge) {
            console.log('❌ Challenge все еще активен после 30 секунд');
        } else if (status.hasMeshokContent && content.length > 50000) {
            console.log('✅ УСПЕХ! Получен реальный контент Meshok');
            console.log('Первые 500 символов:', content.substring(0, 500));
        } else {
            console.log('❓ Неопределенный результат');
            console.log('Первые 500 символов:', content.substring(0, 500));
        }
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    }
}

testMeshokLongWait();

const puppeteer = require('puppeteer');

async function testMeshokWithJS() {
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
            timeout: 30000
        });
        
        // Ждем загрузки JavaScript
        console.log('⏳ Ждем загрузки JavaScript...');
        await new Promise(resolve => setTimeout(resolve, 10000));
        
        // Проверяем, есть ли challenge
        const challengeText = await page.evaluate(() => {
            const challenge = document.querySelector('#challenge-error-text');
            return challenge ? challenge.textContent : null;
        });
        
        if (challengeText) {
            console.log('🔍 Challenge найден:', challengeText);
            
            // Ждем еще немного
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
        
        const content = await page.content();
        console.log('✅ Контент получен, длина:', content.length);
        
        // Проверяем, обошли ли защиту
        if (content.includes('challenge-error-text')) {
            console.log('❌ Защита все еще активна');
            console.log('Первые 500 символов:', content.substring(0, 500));
        } else if (content.includes('meshok') && content.length > 50000) {
            console.log('✅ Защита обойдена! Получен реальный контент');
            console.log('Первые 500 символов:', content.substring(0, 500));
        } else {
            console.log('❓ Неопределенный статус');
            console.log('Первые 500 символов:', content.substring(0, 500));
        }
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    }
}

testMeshokWithJS();

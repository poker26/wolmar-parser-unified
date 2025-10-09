const puppeteer = require('puppeteer-core');

async function testPuppeteerSimple() {
    console.log('🧪 Простой тест Puppeteer...\n');
    
    const executablePaths = [
        process.env.PUPPETEER_EXECUTABLE_PATH,
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
        '/usr/bin/google-chrome',
        '/snap/bin/chromium'
    ].filter(Boolean);
    
    console.log('📋 Пробуем пути к браузеру:');
    executablePaths.forEach((path, index) => {
        console.log(`   ${index + 1}. ${path}`);
    });
    console.log('');
    
    let browser;
    let lastError;
    
    for (const executablePath of executablePaths) {
        try {
            console.log(`🔍 Пробуем: ${executablePath}`);
            browser = await puppeteer.launch({
                executablePath,
                headless: true,
                args: [
                    '--no-sandbox', 
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--user-data-dir=/tmp/chrome-user-data'
                ]
            });
            console.log(`✅ УСПЕХ! Браузер запущен: ${executablePath}`);
            break;
        } catch (error) {
            console.log(`❌ Ошибка: ${error.message}`);
            lastError = error;
            continue;
        }
    }
    
    if (!browser) {
        console.log(`\n💥 НЕ УДАЛОСЬ ЗАПУСТИТЬ БРАУЗЕР!`);
        console.log(`Последняя ошибка: ${lastError.message}`);
        return false;
    }
    
    try {
        const page = await browser.newPage();
        console.log('✅ Страница создана');
        
        await page.goto('https://www.google.com', { waitUntil: 'domcontentloaded', timeout: 10000 });
        console.log('✅ Страница загружена');
        
        const title = await page.title();
        console.log(`📄 Заголовок: ${title}`);
        
        await browser.close();
        console.log('✅ Браузер закрыт');
        
        console.log('\n🎉 ТЕСТ ПРОЙДЕН УСПЕШНО!');
        return true;
        
    } catch (error) {
        console.error('❌ Ошибка во время теста:', error.message);
        await browser.close();
        return false;
    }
}

// Запускаем тест
testPuppeteerSimple();

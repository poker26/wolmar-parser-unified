const { launchPuppeteer, createPage } = require('./puppeteer-utils');

async function testPuppeteer() {
    console.log('🧪 Тестируем puppeteer-utils.js...');
    console.log('📋 Платформа:', process.platform);
    console.log('📋 Node.js версия:', process.version);
    
    try {
        console.log('🚀 Запускаем браузер...');
        const browser = await launchPuppeteer();
        console.log('✅ Браузер запущен успешно');
        
        console.log('📄 Создаем страницу...');
        const page = await createPage(browser);
        console.log('✅ Страница создана успешно');
        
        console.log('🌐 Переходим на тестовую страницу...');
        await page.goto('https://www.google.com', { waitUntil: 'domcontentloaded', timeout: 10000 });
        console.log('✅ Страница загружена успешно');
        
        const title = await page.title();
        console.log('📋 Заголовок страницы:', title);
        
        await browser.close();
        console.log('✅ Тест завершен успешно');
        
    } catch (error) {
        console.error('❌ Ошибка теста:', error.message);
        console.error('❌ Полная ошибка:', error);
    }
}

testPuppeteer();
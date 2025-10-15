const puppeteer = require('puppeteer');

async function testCategoryURL() {
    console.log('🔍 Тестируем URL категории аукциона 2009...');
    
    const browser = await puppeteer.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    try {
        const page = await browser.newPage();
        
        // Тестируем URL из базы данных
        const testUrl = 'https://wolmar.ru/auction/2009/antikvariat';
        console.log(`📄 Загружаем: ${testUrl}`);
        
        await page.goto(testUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        
        // Проверяем заголовок
        const title = await page.title();
        console.log(`📋 Заголовок: ${title}`);
        
        // Ищем ссылки на лоты
        const lotLinks = await page.$$eval('a[href*="/auction/"]', links => {
            return links.slice(0, 10).map(link => ({
                href: link.href,
                text: link.textContent.trim().substring(0, 50)
            }));
        });
        
        console.log(`\n🔗 Найдено ссылок на лоты: ${lotLinks.length}`);
        lotLinks.forEach((link, index) => {
            console.log(`${index + 1}. ${link.href}`);
            console.log(`   Текст: "${link.text}"`);
        });
        
        // Проверяем, есть ли информация об аукционе 2009
        const auctionInfo = await page.evaluate(() => {
            const bodyText = document.body.textContent;
            if (bodyText.includes('2009')) {
                return 'Содержит упоминание аукциона 2009';
            } else if (bodyText.includes('2099')) {
                return 'Содержит упоминание аукциона 2099';
            } else {
                return 'Не содержит упоминаний аукционов 2009 или 2099';
            }
        });
        
        console.log(`\n📊 Анализ страницы: ${auctionInfo}`);
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    } finally {
        await browser.close();
    }
}

testCategoryURL().catch(console.error);

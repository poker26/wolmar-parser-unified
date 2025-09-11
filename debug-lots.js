const puppeteer = require('puppeteer-core');
const config = require('./config');

async function debugLots(auctionNumber, pageNumber = 1) {
    const browser = await puppeteer.launch({
        ...config.browserConfig,
        headless: false
    });
    
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    
    try {
        const auctionUrl = pageNumber === 1 ? 
            `https://numismat.ru/au.shtml?au=${auctionNumber}` : 
            `https://numismat.ru/au.shtml?au=${auctionNumber}&page=${pageNumber}`;
        
        console.log(`🔍 Открываем страницу: ${auctionUrl}`);
        await page.goto(auctionUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Детальная отладка поиска лотов
        const debugInfo = await page.evaluate(() => {
            const info = {
                totalElements: document.querySelectorAll('*').length,
                lotInElements: document.querySelectorAll('.lot_in').length,
                zapisElements: document.querySelectorAll('.zapis').length,
                h3Elements: document.querySelectorAll('h3').length,
                priceElements: document.querySelectorAll('.price').length,
                lotDetails: []
            };
            
            // Проверяем каждый элемент .lot_in
            const lotInElements = document.querySelectorAll('.lot_in');
            lotInElements.forEach((element, index) => {
                const lotDetail = {
                    index: index,
                    hasParent: !!element.closest('.zapis'),
                    parentId: element.closest('.zapis')?.id || null,
                    hasH3: !!element.closest('.zapis')?.querySelector('h3'),
                    h3Text: element.closest('.zapis')?.querySelector('h3')?.textContent || null,
                    hasDescription: !!element.querySelector('p:not(.price)'),
                    descriptionText: element.querySelector('p:not(.price)')?.textContent?.substring(0, 100) || null,
                    hasPrice: !!element.querySelector('.price'),
                    priceText: element.querySelector('.price')?.textContent || null,
                    outerHTML: element.outerHTML.substring(0, 200)
                };
                info.lotDetails.push(lotDetail);
            });
            
            return info;
        });
        
        console.log('\n📊 Детальная информация о лотах:');
        console.log(`Всего элементов на странице: ${debugInfo.totalElements}`);
        console.log(`Элементов .lot_in: ${debugInfo.lotInElements}`);
        console.log(`Элементов .zapis: ${debugInfo.zapisElements}`);
        console.log(`Элементов h3: ${debugInfo.h3Elements}`);
        console.log(`Элементов .price: ${debugInfo.priceElements}`);
        
        console.log('\n🔍 Детали каждого лота:');
        debugInfo.lotDetails.forEach((lot, index) => {
            console.log(`\nЛот ${index + 1}:`);
            console.log(`  Родительский элемент: ${lot.hasParent ? 'Да' : 'Нет'} (ID: ${lot.parentId})`);
            console.log(`  Заголовок h3: ${lot.hasH3 ? 'Да' : 'Нет'} (${lot.h3Text})`);
            console.log(`  Описание: ${lot.hasDescription ? 'Да' : 'Нет'} (${lot.descriptionText})`);
            console.log(`  Цена: ${lot.hasPrice ? 'Да' : 'Нет'} (${lot.priceText})`);
            console.log(`  HTML: ${lot.outerHTML}`);
        });
        
    } catch (error) {
        console.error('❌ Ошибка отладки:', error.message);
    } finally {
        await browser.close();
    }
}

// Запуск отладки
if (require.main === module) {
    const args = process.argv.slice(2);
    const auctionNumber = args[0] || '1054';
    const pageNumber = parseInt(args[1]) || 1;
    
    console.log(`🔍 Детальная отладка лотов аукциона ${auctionNumber}, страница ${pageNumber}`);
    debugLots(auctionNumber, pageNumber);
}

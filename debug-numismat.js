const puppeteer = require('puppeteer-core');
const config = require('./config');

async function debugNumismatPage(auctionNumber, pageNumber = 1) {
    const browser = await puppeteer.launch({...config.browserConfig,
        headless: false // Показываем браузер для отладки,
            args: [
                '--user-data-dir=/tmp/chrome-temp-bxyh3',
                '--disable-metrics',
                '--disable-metrics-reporting',
                '--disable-background-mode',
                '--disable-background-timer-throttling',
                '--disable-renderer-backgrounding',
                '--disable-backgrounding-occluded-windows',
                '--disable-logging',
                '--disable-gpu-logging',
                '--disable-features=TranslateUI,BlinkGenPropertyTrees,VizDisplayCompositor'
            ]});
    
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    
    try {
        const auctionUrl = pageNumber === 1 ? 
            `https://numismat.ru/au.shtml?au=${auctionNumber}` : 
            `https://numismat.ru/au.shtml?au=${auctionNumber}&page=${pageNumber}`;
        
        console.log(`🔍 Открываем страницу: ${auctionUrl}`);
        await page.goto(auctionUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Получаем HTML структуру страницы
        const pageStructure = await page.evaluate(() => {
            const structure = {
                title: document.title,
                h1: document.querySelector('h1')?.textContent,
                bodyText: document.body.textContent.substring(0, 1000),
                lotElements: [],
                allElements: []
            };
            
            // Ищем элементы, которые могут содержать лоты
            const possibleLotSelectors = [
                'h3', 'h4', 'h5', 'h6',
                '.lot', '[class*="lot"]',
                'tr', 'td', 'div',
                '.auction-item', '.item',
                'p', 'span'
            ];
            
            possibleLotSelectors.forEach(selector => {
                const elements = document.querySelectorAll(selector);
                elements.forEach((el, index) => {
                    const text = el.textContent.trim();
                    if (text.includes('Лот') || text.includes('Старт:') || text.includes('₽')) {
                        structure.lotElements.push({
                            selector: selector,
                            index: index,
                            text: text.substring(0, 200),
                            html: el.outerHTML.substring(0, 500)
                        });
                    }
                });
            });
            
            // Также получаем общую структуру страницы
            const allElements = document.querySelectorAll('*');
            allElements.forEach((el, index) => {
                if (index < 50) { // Ограничиваем количество
                    structure.allElements.push({
                        tagName: el.tagName,
                        className: el.className,
                        id: el.id,
                        text: el.textContent?.substring(0, 100)
                    });
                }
            });
            
            return structure;
        });
        
        console.log('\n📊 Структура страницы:');
        console.log('Title:', pageStructure.title);
        console.log('H1:', pageStructure.h1);
        console.log('\n📝 Первые 1000 символов текста:');
        console.log(pageStructure.bodyText);
        
        console.log('\n🔍 Найденные элементы с лотами:');
        pageStructure.lotElements.forEach((el, index) => {
            console.log(`\n${index + 1}. Селектор: ${el.selector}`);
            console.log(`   Текст: ${el.text}`);
            console.log(`   HTML: ${el.html}`);
        });
        
        console.log('\n🏗️ Общая структура страницы (первые 50 элементов):');
        pageStructure.allElements.forEach((el, index) => {
            console.log(`${index + 1}. ${el.tagName}${el.className ? '.' + el.className : ''}${el.id ? '#' + el.id : ''}: ${el.text}`);
        });
        
        // Делаем скриншот для визуального анализа
        await page.screenshot({ path: `debug-numismat-${auctionNumber}-page${pageNumber}.png`, fullPage: true });
        console.log(`\n📸 Скриншот сохранен: debug-numismat-${auctionNumber}-page${pageNumber}.png`);
        
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
    
    console.log(`🔍 Отладка страницы аукциона ${auctionNumber}, страница ${pageNumber}`);
    debugNumismatPage(auctionNumber, pageNumber);
}

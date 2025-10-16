const { launchPuppeteer, createPage, cleanupChromeTempFiles } = require('./puppeteer-utils');

async function debugRealBidCounts() {
    console.log('🔍 ДИАГНОСТИКА РЕАЛЬНОГО КОЛИЧЕСТВА СТАВОК');
    console.log('==========================================');
    
    const browser = await launchPuppeteer();
    const page = await createPage(browser);
    
    try {
        // Тестируем несколько разных лотов
        const testLots = [
            { url: 'https://www.wolmar.ru/auction/2007/6879086?category=antikvariat', name: 'Лот 6879086' },
            { url: 'https://www.wolmar.ru/auction/2007/6879087?category=antikvariat', name: 'Лот 6879087' },
            { url: 'https://www.wolmar.ru/auction/2007/6879088?category=antikvariat', name: 'Лот 6879088' },
            { url: 'https://www.wolmar.ru/auction/2007/6879089?category=antikvariat', name: 'Лот 6879089' }
        ];
        
        for (const lot of testLots) {
            console.log(`\n📋 Тестируем ${lot.name}...`);
            
            // Переходим на страницу лота
            await page.goto(lot.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            
            // Извлекаем параметры для AJAX
            const urlMatch = lot.url.match(/\/auction\/(\d+)\/(\d+)/);
            if (!urlMatch) {
                console.log(`❌ Не удалось извлечь параметры из URL: ${lot.url}`);
                continue;
            }
            
            const auctionId = urlMatch[1];
            const lotId = urlMatch[2];
            console.log(`🔍 Параметры: auction_id=${auctionId}, lot_id=${lotId}`);
            
            // Формируем AJAX URL
            const ajaxUrl = `https://www.wolmar.ru/ajax/bids.php?auction_id=${auctionId}&lot_id=${lotId}`;
            console.log(`🌐 AJAX URL: ${ajaxUrl}`);
            
            // Делаем запрос к AJAX endpoint
            const response = await page.goto(ajaxUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
            if (!response || !response.ok()) {
                console.log(`❌ Ошибка AJAX запроса: ${response?.status()}`);
                continue;
            }
            
            // Парсим HTML таблицы ставок
            const bidCount = await page.evaluate(() => {
                const table = document.querySelector('table.colored');
                if (!table) {
                    console.log('Таблица ставок не найдена');
                    return 0;
                }
                
                const rows = table.querySelectorAll('tr');
                console.log(`Найдено строк в таблице: ${rows.length}`);
                
                // Считаем только строки с данными (исключая заголовок)
                let validBids = 0;
                for (let i = 1; i < rows.length; i++) {
                    const row = rows[i];
                    const cells = row.querySelectorAll('td');
                    
                    if (cells.length >= 4) {
                        const amountText = cells[0]?.textContent?.trim();
                        const bidderText = cells[2]?.textContent?.trim();
                        const timestampText = cells[3]?.textContent?.trim();
                        
                        if (amountText && bidderText && timestampText) {
                            validBids++;
                        }
                    }
                }
                
                return validBids;
            });
            
            console.log(`💰 Реальное количество ставок: ${bidCount}`);
            
            // Небольшая пауза между запросами
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    } finally {
        await cleanupChromeTempFiles();
        await browser.close();
    }
}

if (require.main === module) {
    debugRealBidCounts();
}

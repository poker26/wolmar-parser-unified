const { launchPuppeteer, createPage, cleanupChromeTempFiles } = require('./puppeteer-utils');

async function testAjaxBids() {
    console.log('🧪 ТЕСТИРУЕМ AJAX ПАРСИНГ СТАВОК');
    console.log('================================');
    
    const browser = await launchPuppeteer();
    const page = await createPage(browser);
    
    try {
        console.log('\n1️⃣ Браузер инициализирован...');
        
        console.log('\n2️⃣ Тестируем парсинг ставок для лота 2070/7222265...');
        const testUrl = 'https://www.wolmar.ru/auction/2070/7222265?category=bony';
        
        // Переходим на страницу лота
        await page.goto(testUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        
        // Парсим историю ставок напрямую
        const bidHistory = await parseBidHistoryDirect(page);
        
        console.log('\n3️⃣ Результаты парсинга:');
        console.log(`📊 Найдено ставок: ${bidHistory.length}`);
        
        if (bidHistory.length > 0) {
            console.log('\n💰 Первые 5 ставок:');
            bidHistory.slice(0, 5).forEach((bid, index) => {
                console.log(`   ${index + 1}. ${bid.amount} руб. - ${bid.bidder} (${bid.timestamp}) ${bid.isAutoBid ? '[АВТОБИД]' : '[РУЧНАЯ]'}`);
            });
            
            // Статистика по автобидам
            const autoBids = bidHistory.filter(bid => bid.isAutoBid).length;
            const manualBids = bidHistory.length - autoBids;
            
            console.log('\n📊 Статистика:');
            console.log(`   Всего ставок: ${bidHistory.length}`);
            console.log(`   Автобидов: ${autoBids} (${Math.round(autoBids / bidHistory.length * 100)}%)`);
            console.log(`   Ручных ставок: ${manualBids} (${Math.round(manualBids / bidHistory.length * 100)}%)`);
        } else {
            console.log('❌ Ставки не найдены');
        }
        
    } catch (error) {
        console.error('❌ Ошибка теста:', error.message);
    } finally {
        await cleanupChromeTempFiles();
        await browser.close();
    }
}

// Функция парсинга ставок без подключения к БД
async function parseBidHistoryDirect(page) {
    try {
        console.log(`💰 Парсим историю ставок через AJAX...`);
        
        // Извлекаем auction_id и lot_id из URL страницы
        const url = page.url();
        const urlMatch = url.match(/\/auction\/(\d+)\/(\d+)/);
        if (!urlMatch) {
            console.log(`❌ Не удалось извлечь auction_id и lot_id из URL: ${url}`);
            return [];
        }
        
        const auctionId = urlMatch[1];
        const lotId = urlMatch[2];
        console.log(`🔍 Извлечены параметры: auction_id=${auctionId}, lot_id=${lotId}`);
        
        // Формируем AJAX URL
        const ajaxUrl = `https://www.wolmar.ru/ajax/bids.php?auction_id=${auctionId}&lot_id=${lotId}`;
        console.log(`🌐 AJAX URL: ${ajaxUrl}`);
        
        // Делаем запрос к AJAX endpoint
        const response = await page.goto(ajaxUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
        if (!response || !response.ok()) {
            console.log(`❌ Ошибка AJAX запроса: ${response?.status()}`);
            return [];
        }
        
        // Парсим HTML таблицы ставок
        const bidHistory = await page.evaluate(() => {
            const bids = [];
            
            // Ищем таблицу ставок
            const table = document.querySelector('table.colored');
            if (!table) {
                console.log('Таблица ставок не найдена');
                return bids;
            }
            
            const rows = table.querySelectorAll('tr');
            console.log(`Найдено строк в таблице: ${rows.length}`);
            
            // Пропускаем заголовок (первая строка)
            for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                const cells = row.querySelectorAll('td');
                
                if (cells.length >= 4) {
                    // Структура: Сумма, *, Логин, Дата/Время, (пустая)
                    const amountText = cells[0]?.textContent?.trim();
                    const starText = cells[1]?.textContent?.trim();
                    const bidderText = cells[2]?.textContent?.trim();
                    const timestampText = cells[3]?.textContent?.trim();
                    
                    console.log(`Строка ${i}: "${amountText}" | "${starText}" | "${bidderText}" | "${timestampText}"`);
                    
                    if (amountText && bidderText && timestampText) {
                        // Извлекаем сумму (убираем пробелы и конвертируем в число)
                        const amount = parseInt(amountText.replace(/\s/g, ''));
                        
                        // Определяем автобид по наличию звездочки в колонке 1
                        const isAutoBid = starText === '*';
                        
                        bids.push({
                            amount: amount,
                            bidder: bidderText,
                            timestamp: timestampText,
                            isAutoBid: isAutoBid
                        });
                    }
                }
            }
            
            return bids;
        });
        
        console.log(`✅ Найдено ${bidHistory.length} ставок через AJAX`);
        return bidHistory;
        
    } catch (error) {
        console.log(`❌ Ошибка парсинга истории ставок: ${error.message}`);
        return [];
    }
}

if (require.main === module) {
    testAjaxBids();
}

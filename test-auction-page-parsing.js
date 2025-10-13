const puppeteer = require('puppeteer-core');

async function testAuctionPageParsing() {
    const browser = await puppeteer.launch({
        headless: false, // Показываем браузер для отладки
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        args: ['--no-sandbox', '--disable-setuid-sandbox',
            '--user-data-dir=/tmp/chrome-temp-9g8ln',
            '--disable-metrics',
            '--disable-metrics-reporting',
            '--disable-background-mode',
            '--disable-background-timer-throttling',
            '--disable-renderer-backgrounding',
            '--disable-backgrounding-occluded-windows',
            '--disable-logging',
            '--disable-gpu-logging',
            '--disable-features=TranslateUI,BlinkGenPropertyTrees,VizDisplayCompositor']
    });
    
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    
    try {
        // Тестируем на аукционе 2124
        const auctionUrl = 'https://www.wolmar.ru/auction/2124';
        console.log(`🔍 Тестируем парсинг страницы: ${auctionUrl}`);
        
        await page.goto(auctionUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Извлекаем данные о лотах и их состояниях
        const lotsData = await page.evaluate(() => {
            const lots = [];
            
            console.log('🔍 Ищем лоты на странице...');
            
            // Метод 1: Ищем по селекторам таблицы
            const tableRows = document.querySelectorAll('table tr, .auction-table tr');
            console.log(`Найдено строк таблицы: ${tableRows.length}`);
            
            tableRows.forEach((row, index) => {
                try {
                    const lot = {};
                    
                    // Ищем ссылку на лот
                    const lotLink = row.querySelector('a[href*="/auction/"]');
                    if (lotLink && lotLink.href) {
                        lot.url = lotLink.href;
                        
                        // Извлекаем номер лота из ссылки
                        const urlMatch = lotLink.href.match(/\/auction\/\d+\/(\d+)/);
                        if (urlMatch) {
                            lot.lotNumber = urlMatch[1];
                        }
                        
                        // Ищем состояние в ячейках строки
                        const cells = row.querySelectorAll('td');
                        cells.forEach(cell => {
                            const cellText = cell.textContent.trim();
                            // Ищем состояния типа MS, AU, XF, VF, UNC с возможными цифрами
                            if (cellText.match(/^(MS|AU|XF|VF|UNC|PL)[\s\d\-\+\/]*$/i)) {
                                lot.condition = cellText;
                            }
                        });
                        
                        // Если не нашли в ячейках, ищем в тексте строки
                        if (!lot.condition) {
                            const rowText = row.textContent;
                            const conditionMatch = rowText.match(/(MS|AU|XF|VF|UNC|PL)[\s\d\-\+\/]*/i);
                            if (conditionMatch) {
                                lot.condition = conditionMatch[0].trim();
                            }
                        }
                        
                        if (lot.url && lot.lotNumber && lot.condition) {
                            lots.push(lot);
                        }
                    }
                } catch (error) {
                    console.error(`Ошибка при парсинге строки ${index}:`, error);
                }
            });
            
            // Метод 2: Альтернативный поиск по классам
            if (lots.length === 0) {
                console.log('🔍 Пробуем альтернативный метод поиска...');
                
                const lotElements = document.querySelectorAll('.lot, .lot-item, [class*="lot"]');
                console.log(`Найдено элементов лотов: ${lotElements.length}`);
                
                lotElements.forEach((element, index) => {
                    try {
                        const lot = {};
                        
                        const lotLink = element.querySelector('a[href*="/auction/"]');
                        if (lotLink && lotLink.href) {
                            lot.url = lotLink.href;
                            
                            const urlMatch = lotLink.href.match(/\/auction\/\d+\/(\d+)/);
                            if (urlMatch) {
                                lot.lotNumber = urlMatch[1];
                            }
                            
                            const elementText = element.textContent;
                            const conditionMatch = elementText.match(/(MS|AU|XF|VF|UNC|PL)[\s\d\-\+\/]*/i);
                            if (conditionMatch) {
                                lot.condition = conditionMatch[0].trim();
                            }
                            
                            if (lot.url && lot.lotNumber && lot.condition) {
                                lots.push(lot);
                            }
                        }
                    } catch (error) {
                        console.error(`Ошибка при парсинге элемента ${index}:`, error);
                    }
                });
            }
            
            // Метод 3: Поиск по всему тексту страницы
            if (lots.length === 0) {
                console.log('🔍 Пробуем поиск по всему тексту страницы...');
                
                const pageText = document.body.textContent;
                const lotMatches = pageText.match(/\/auction\/\d+\/\d+/g);
                
                if (lotMatches) {
                    console.log(`Найдено ссылок на лоты в тексте: ${lotMatches.length}`);
                    
                    lotMatches.forEach(match => {
                        const urlMatch = match.match(/\/auction\/(\d+)\/(\d+)/);
                        if (urlMatch) {
                            const auctionNumber = urlMatch[1];
                            const lotNumber = urlMatch[2];
                            
                            // Ищем состояние рядом с этой ссылкой
                            const contextStart = pageText.indexOf(match) - 200;
                            const contextEnd = pageText.indexOf(match) + 200;
                            const context = pageText.substring(Math.max(0, contextStart), contextEnd);
                            
                            const conditionMatch = context.match(/(MS|AU|XF|VF|UNC|PL)[\s\d\-\+\/]*/i);
                            if (conditionMatch) {
                                lots.push({
                                    url: `https://www.wolmar.ru${match}`,
                                    lotNumber: lotNumber,
                                    condition: conditionMatch[0].trim()
                                });
                            }
                        }
                    });
                }
            }
            
            return lots;
        });
        
        console.log(`\n📊 Результаты парсинга:`);
        console.log(`Найдено лотов: ${lotsData.length}`);
        
        if (lotsData.length > 0) {
            console.log(`\n📋 Первые 10 лотов:`);
            lotsData.slice(0, 10).forEach((lot, index) => {
                console.log(`${index + 1}. Лот ${lot.lotNumber}: ${lot.condition} (${lot.url})`);
            });
            
            // Анализ состояний
            const conditions = lotsData.map(lot => lot.condition);
            const uniqueConditions = [...new Set(conditions)];
            console.log(`\n📊 Уникальные состояния (${uniqueConditions.length}):`);
            uniqueConditions.forEach(condition => {
                const count = conditions.filter(c => c === condition).length;
                console.log(`  ${condition}: ${count} лотов`);
            });
        } else {
            console.log('❌ Не удалось извлечь данные о лотах');
            console.log('🔍 Проверим структуру страницы...');
            
            const pageStructure = await page.evaluate(() => {
                const structure = {
                    tables: document.querySelectorAll('table').length,
                    lotLinks: document.querySelectorAll('a[href*="/auction/"]').length,
                    lotClasses: document.querySelectorAll('[class*="lot"]').length,
                    bodyText: document.body.textContent.length
                };
                
                // Ищем все ссылки на лоты
                const allLotLinks = Array.from(document.querySelectorAll('a[href*="/auction/"]')).map(link => link.href);
                
                return {
                    structure,
                    sampleLotLinks: allLotLinks.slice(0, 5)
                };
            });
            
            console.log('📊 Структура страницы:', pageStructure.structure);
            console.log('🔗 Примеры ссылок на лоты:', pageStructure.sampleLotLinks);
        }
        
    } catch (error) {
        console.error('❌ Ошибка при тестировании:', error.message);
    } finally {
        await browser.close();
    }
}

testAuctionPageParsing();

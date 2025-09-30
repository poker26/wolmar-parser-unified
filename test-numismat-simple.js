const puppeteer = require('puppeteer-core');
const config = require('./config');

async function testSimpleParsing(auctionNumber) {
    const browser = await puppeteer.launch(config.browserConfig);
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    
    try {
        const auctionUrl = `https://numismat.ru/au.shtml?au=${auctionNumber}`;
        console.log(`🔍 Открываем страницу: ${auctionUrl}`);
        await page.goto(auctionUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Простой тест парсинга лотов
        const lotsData = await page.evaluate((auctionNumber, sourceSite) => {
            const lots = [];

            // Ищем все блоки лотов - на numismat.ru лоты находятся в div с классом "lot_in"
            const lotBlocks = document.querySelectorAll('.lot_in');
            console.log(`Найдено блоков .lot_in: ${lotBlocks.length}`);
            
            lotBlocks.forEach((block, index) => {
                try {
                    const lot = {
                        auctionNumber: auctionNumber,
                        sourceSite: sourceSite,
                        pageNumber: 1
                    };

                    // Ищем родительский элемент с номером лота
                    const parentElement = block.closest('.zapis');
                    if (parentElement) {
                        const lotHeader = parentElement.querySelector('h3');
                        if (lotHeader) {
                            const lotNumberMatch = lotHeader.textContent.match(/Лот\s*(\d+)/i);
                            if (lotNumberMatch) {
                                lot.lotNumber = lotNumberMatch[1];
                            }
                        }
                    }

                    // Описание лота
                    const descriptionElement = block.querySelector('p:not(.price)');
                    if (descriptionElement) {
                        lot.coinDescription = descriptionElement.textContent.trim();
                    }

                    // Стартовая цена
                    const priceElement = block.querySelector('.price');
                    if (priceElement) {
                        const startPriceMatch = priceElement.textContent.match(/Старт:\s*(\d+(?:\s?\d+)*)/);
                        if (startPriceMatch) {
                            lot.startingBid = startPriceMatch[1].replace(/\s/g, '');
                        }
                    }

                    // Извлекаем год из описания
                    const yearMatch = lot.coinDescription?.match(/(\d{4})\s*г/);
                    if (yearMatch) {
                        lot.year = parseInt(yearMatch[1]);
                    }

                    // Определяем тип лота
                    if (lot.coinDescription?.toLowerCase().includes('монета')) {
                        lot.lotType = 'coin';
                    } else if (lot.coinDescription?.toLowerCase().includes('банкнот')) {
                        lot.lotType = 'banknote';
                    } else if (lot.coinDescription?.toLowerCase().includes('документ')) {
                        lot.lotType = 'document';
                    } else if (lot.coinDescription?.toLowerCase().includes('вексель')) {
                        lot.lotType = 'document';
                    } else if (lot.coinDescription?.toLowerCase().includes('облигац')) {
                        lot.lotType = 'document';
                    } else if (lot.coinDescription?.toLowerCase().includes('билет')) {
                        lot.lotType = 'document';
                    } else {
                        lot.lotType = 'other';
                    }

                    // Статус лота - для закрытых аукционов
                    lot.lotStatus = 'closed';

                    console.log(`Лот ${index + 1}: номер=${lot.lotNumber}, описание=${lot.coinDescription?.substring(0, 50)}...`);

                    // Добавляем лот только если у него есть номер и описание
                    if (lot.lotNumber && lot.coinDescription) {
                        lots.push(lot);
                        console.log(`✅ Лот ${lot.lotNumber} добавлен в список`);
                    } else {
                        console.log(`❌ Лот ${index + 1} не добавлен: номер=${lot.lotNumber}, описание=${!!lot.coinDescription}`);
                    }
                } catch (error) {
                    console.error('Ошибка парсинга лота:', error);
                }
            });

            console.log(`Итого найдено лотов: ${lots.length}`);
            return lots;
        }, auctionNumber, 'numismat.ru');
        
        console.log('\n📊 Результаты парсинга:');
        console.log(`Найдено лотов: ${lotsData.length}`);
        
        lotsData.forEach((lot, index) => {
            console.log(`\n${index + 1}. Лот ${lot.lotNumber}:`);
            console.log(`   Описание: ${lot.coinDescription?.substring(0, 80)}...`);
            console.log(`   Стартовая цена: ${lot.startingBid} руб.`);
            console.log(`   Год: ${lot.year || 'не указан'}`);
            console.log(`   Тип: ${lot.lotType}`);
            console.log(`   Статус: ${lot.lotStatus}`);
        });
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    } finally {
        await browser.close();
    }
}

// Запуск теста
if (require.main === module) {
    const args = process.argv.slice(2);
    const auctionNumber = args[0] || '1054';
    
    console.log(`🧪 Простой тест парсинга аукциона ${auctionNumber}`);
    testSimpleParsing(auctionNumber);
}

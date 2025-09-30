/**
 * Тестируем обновление конкретного лота
 */

const { Client } = require('pg');
const puppeteer = require('puppeteer-core');
const config = require('./config');

async function testSpecificLotUpdate() {
    const client = new Client(config.dbConfig);
    
    try {
        await client.connect();
        console.log('🔗 Подключение к базе данных установлено');
        
        // Инициализируем браузер
        const browser = await puppeteer.launch({
            executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
        
        console.log('🌐 Браузер инициализирован');
        
        // Функция для извлечения состояния с градацией
        function extractConditionWithGrade(conditionText) {
            if (!conditionText) return null;
            return conditionText.replace(/\s+/g, '');
        }
        
        // Тестируем конкретный лот
        const testLotUrl = 'https://www.wolmar.ru/auction/2130/7555829';
        console.log(`\n🧪 Тестируем лот: ${testLotUrl}`);
        
        // Проверяем текущее состояние в БД
        const currentState = await client.query(`
            SELECT id, lot_number, auction_number, condition, source_url
            FROM auction_lots 
            WHERE source_url = $1;
        `, [testLotUrl]);
        
        if (currentState.rows.length > 0) {
            const lot = currentState.rows[0];
            console.log(`📋 Текущее состояние в БД:`);
            console.log(`  Лот ${lot.lot_number} (Аукцион ${lot.auction_number})`);
            console.log(`  Состояние: "${lot.condition}"`);
            console.log(`  URL: ${lot.source_url}`);
            
            // Парсим страницу лота
            console.log(`\n🔍 Парсим страницу лота...`);
            await page.goto(testLotUrl, { waitUntil: 'networkidle2', timeout: 30000 });
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            const pageData = await page.evaluate(() => {
                const pageText = document.body.textContent || '';
                const conditionMatch = pageText.match(/Сохранность:\s*([^\n\r]+)/i);
                return conditionMatch ? conditionMatch[1].trim() : null;
            });
            
            if (pageData) {
                const newCondition = extractConditionWithGrade(pageData);
                console.log(`📊 Состояние на сайте: "${pageData}" -> "${newCondition}"`);
                
                console.log(`\n🔍 Сравнение:`);
                console.log(`  БД: "${lot.condition}"`);
                console.log(`  Сайт: "${newCondition}"`);
                console.log(`  Совпадают: ${lot.condition === newCondition ? '✅ ДА' : '❌ НЕТ'}`);
                
                if (lot.condition !== newCondition) {
                    console.log(`\n✅ НУЖНО ОБНОВИТЬ: "${lot.condition}" -> "${newCondition}"`);
                    
                    // Обновляем
                    await client.query(`
                        UPDATE auction_lots 
                        SET condition = $1 
                        WHERE id = $2;
                    `, [newCondition, lot.id]);
                    
                    console.log(`🎉 Лот обновлен!`);
                } else {
                    console.log(`\n⏭️ Без изменений - состояние уже корректное`);
                }
            } else {
                console.log(`❌ Не удалось извлечь состояние с страницы`);
            }
        } else {
            console.log(`❌ Лот не найден в базе данных`);
        }
        
        // Теперь тестируем парсинг с общей страницы
        console.log(`\n🧪 Тестируем парсинг с общей страницы аукциона 2130:`);
        
        const auctionUrl = 'https://www.wolmar.ru/auction/2130';
        await page.goto(auctionUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const lotsData = await page.evaluate(() => {
            const lots = [];
            const tables = document.querySelectorAll('table');
            
            tables.forEach(table => {
                const rows = table.querySelectorAll('tr');
                
                rows.forEach(row => {
                    const cells = row.querySelectorAll('td, th');
                    
                    if (cells.length >= 10) {
                        const lotLink = row.querySelector('a[href*="/auction/"]');
                        
                        if (lotLink) {
                            const lotUrl = lotLink.href;
                            const lotNumberMatch = lotUrl.match(/\/auction\/\d+\/(\d+)/);
                            const lotNumber = lotNumberMatch ? lotNumberMatch[1] : null;
                            
                            const conditionCell = cells[5];
                            const condition = conditionCell ? conditionCell.textContent.trim() : null;
                            
                            if (lotNumber && condition && condition.match(/^(MS|PF|AU|UNC|XF|VF|VG|F|G|PR|PL|Proof|Gem)/i)) {
                                lots.push({
                                    lotNumber: lotNumber,
                                    lotUrl: lotUrl,
                                    condition: condition
                                });
                            }
                        }
                    }
                });
            });
            
            return lots;
        });
        
        console.log(`📊 Найдено ${lotsData.length} лотов с состояниями`);
        
        // Ищем наш тестовый лот
        const targetLot = lotsData.find(lot => lot.lotUrl === testLotUrl);
        if (targetLot) {
            console.log(`🎯 Найден целевой лот в результатах парсинга:`);
            console.log(`  Номер: ${targetLot.lotNumber}`);
            console.log(`  Состояние: "${targetLot.condition}"`);
            console.log(`  URL: ${targetLot.lotUrl}`);
            
            const newCondition = extractConditionWithGrade(targetLot.condition);
            console.log(`  После обработки: "${newCondition}"`);
        } else {
            console.log(`❌ Целевой лот не найден в результатах парсинга`);
        }
        
        await browser.close();
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    } finally {
        await client.end();
    }
}

testSpecificLotUpdate();

/**
 * Диагностический скрипт для анализа проблемы сопоставления URL
 */

const { Client } = require('pg');
const config = require('./config');

async function debugUrlMatching() {
    const client = new Client(config.dbConfig);
    
    try {
        await client.connect();
        console.log('🔗 Подключение к базе данных установлено');
        
        // Проверяем, какие URL есть в базе для аукциона 967 (внутренний номер 2130)
        console.log('\n🔍 Анализируем аукцион 967 (внутренний номер 2130):');
        
        const auction967 = await client.query(`
            SELECT source_url, lot_number, condition
            FROM auction_lots 
            WHERE auction_number = '967'
            LIMIT 10;
        `);
        
        console.log(`📊 Найдено ${auction967.rows.length} лотов в аукционе 967:`);
        auction967.rows.forEach((lot, index) => {
            console.log(`  ${index + 1}. Лот ${lot.lot_number}: "${lot.condition}"`);
            console.log(`     URL: ${lot.source_url}`);
        });
        
        // Проверяем, какие URL парсит скрипт с общей страницы
        console.log('\n🧪 Тестируем парсинг URL с общей страницы аукциона 2130:');
        
        const puppeteer = require('puppeteer-core');
        const browser = await puppeteer.launch({
            executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
        
        const auctionUrl = 'https://www.wolmar.ru/auction/2130';
        console.log(`📄 Переходим на: ${auctionUrl}`);
        
        await page.goto(auctionUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Извлекаем URL с первой страницы
        const parsedUrls = await page.evaluate(() => {
            const urls = [];
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
                            
                            if (lotNumber && condition) {
                                urls.push({
                                    lotNumber: lotNumber,
                                    lotUrl: lotUrl,
                                    condition: condition
                                });
                            }
                        }
                    }
                });
            });
            
            return urls;
        });
        
        await browser.close();
        
        console.log(`📊 Парсинг нашел ${parsedUrls.length} лотов на первой странице:`);
        parsedUrls.slice(0, 5).forEach((lot, index) => {
            console.log(`  ${index + 1}. Лот ${lot.lotNumber}: "${lot.condition}"`);
            console.log(`     URL: ${lot.lotUrl}`);
        });
        
        // Проверяем совпадения
        console.log('\n🔍 Проверяем совпадения URL:');
        let matches = 0;
        let mismatches = 0;
        
        for (const parsedLot of parsedUrls.slice(0, 10)) {
            const dbMatch = await client.query(`
                SELECT id, lot_number, condition, source_url
                FROM auction_lots 
                WHERE source_url = $1;
            `, [parsedLot.lotUrl]);
            
            if (dbMatch.rows.length > 0) {
                const dbLot = dbMatch.rows[0];
                console.log(`✅ СОВПАДЕНИЕ: Лот ${parsedLot.lotNumber}`);
                console.log(`   Парсинг: "${parsedLot.condition}" | БД: "${dbLot.condition}"`);
                console.log(`   URL: ${parsedLot.lotUrl}`);
                matches++;
            } else {
                console.log(`❌ НЕ НАЙДЕН: Лот ${parsedLot.lotNumber}`);
                console.log(`   Состояние: "${parsedLot.condition}"`);
                console.log(`   URL: ${parsedLot.lotUrl}`);
                mismatches++;
            }
        }
        
        console.log(`\n📊 Результат проверки:`);
        console.log(`  ✅ Совпадений: ${matches}`);
        console.log(`  ❌ Не найдено: ${mismatches}`);
        
        // Проверяем, есть ли лоты с похожими URL
        if (mismatches > 0) {
            console.log('\n🔍 Ищем похожие URL в базе:');
            const sampleUrl = parsedUrls[0].lotUrl;
            const baseUrl = sampleUrl.split('?')[0]; // Убираем параметры
            
            const similarUrls = await client.query(`
                SELECT source_url, lot_number, condition
                FROM auction_lots 
                WHERE source_url LIKE $1
                LIMIT 5;
            `, [`${baseUrl}%`]);
            
            if (similarUrls.rows.length > 0) {
                console.log(`📋 Найдены похожие URL:`);
                similarUrls.rows.forEach((lot, index) => {
                    console.log(`  ${index + 1}. Лот ${lot.lot_number}: "${lot.condition}"`);
                    console.log(`     URL: ${lot.source_url}`);
                });
            } else {
                console.log(`❌ Похожие URL не найдены`);
            }
        }
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    } finally {
        await client.end();
    }
}

debugUrlMatching();

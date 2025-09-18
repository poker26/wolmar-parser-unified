/**
 * Тестируем массовое обновление на старом аукционе 964
 */

const { Client } = require('pg');
const puppeteer = require('puppeteer-core');
const config = require('./config');

async function testOldAuction964() {
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
        
        // Проверяем аукцион 964 в БД
        console.log('\n🔍 Проверяем аукцион 964 в базе данных:');
        
        const auction964Stats = await client.query(`
            SELECT 
                COUNT(*) as total_lots,
                COUNT(CASE WHEN condition LIKE '% %' THEN 1 END) as lots_with_spaces,
                COUNT(CASE WHEN condition NOT LIKE '% %' THEN 1 END) as lots_without_spaces
            FROM auction_lots 
            WHERE auction_number = '964';
        `);
        
        const stats = auction964Stats.rows[0];
        console.log(`📊 Статистика аукциона 964 в БД:`);
        console.log(`  Всего лотов: ${stats.total_lots}`);
        console.log(`  С пробелами: ${stats.lots_with_spaces}`);
        console.log(`  Без пробелов: ${stats.lots_without_spaces}`);
        
        // Показываем примеры лотов
        const sampleLots = await client.query(`
            SELECT lot_number, condition, source_url
            FROM auction_lots 
            WHERE auction_number = '964'
            ORDER BY lot_number
            LIMIT 10;
        `);
        
        console.log(`\n📋 Примеры лотов аукциона 964:`);
        sampleLots.rows.forEach((lot, index) => {
            const hasSpaces = lot.condition.includes(' ');
            console.log(`  ${index + 1}. Лот ${lot.lot_number}: "${lot.condition}" ${hasSpaces ? '⚠️ ЕСТЬ ПРОБЕЛЫ' : '✅ БЕЗ ПРОБЕЛОВ'}`);
        });
        
        // Теперь парсим общую страницу аукциона 964
        console.log(`\n🧪 Парсим общую страницу аукциона 964:`);
        
        const auctionUrl = 'https://www.wolmar.ru/auction/2124'; // Внутренний номер для аукциона 964
        console.log(`📄 Переходим на: ${auctionUrl}`);
        
        await page.goto(auctionUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Определяем количество страниц
        const totalPages = await page.evaluate(() => {
            const pagination = document.querySelector('.pagination');
            if (!pagination) return 1;
            
            const pageLinks = pagination.querySelectorAll('a');
            let maxPage = 1;
            
            pageLinks.forEach(link => {
                const text = link.textContent.trim();
                const pageNum = parseInt(text);
                if (!isNaN(pageNum) && pageNum > maxPage) {
                    maxPage = pageNum;
                }
            });
            
            return maxPage;
        });
        
        console.log(`📄 Найдено ${totalPages} страниц для парсинга`);
        
        // Парсим только первую страницу для теста
        console.log(`\n📖 Парсим страницу 1/${totalPages}...`);
        
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
        
        console.log(`📊 Найдено ${lotsData.length} лотов с состояниями на первой странице`);
        
        // Показываем первые 5 лотов
        console.log(`\n📋 Первые 5 лотов с парсинга:`);
        lotsData.slice(0, 5).forEach((lot, index) => {
            console.log(`  ${index + 1}. Лот ${lot.lotNumber}: "${lot.condition}"`);
            console.log(`     URL: ${lot.lotUrl}`);
        });
        
        // Тестируем обновление первых 10 лотов
        console.log(`\n🧪 Тестируем обновление первых 10 лотов:`);
        
        let updated = 0;
        let skipped = 0;
        let notFound = 0;
        
        for (const lot of lotsData.slice(0, 10)) {
            try {
                const newCondition = extractConditionWithGrade(lot.condition);
                
                // Ищем лот в базе по URL
                const findResult = await client.query(`
                    SELECT id, lot_number, condition 
                    FROM auction_lots 
                    WHERE source_url = $1;
                `, [lot.lotUrl]);
                
                if (findResult.rows.length > 0) {
                    const lotRecord = findResult.rows[0];
                    const oldCondition = lotRecord.condition;
                    
                    if (oldCondition !== newCondition) {
                        // Обновляем состояние
                        await client.query(`
                            UPDATE auction_lots 
                            SET condition = $1 
                            WHERE id = $2;
                        `, [newCondition, lotRecord.id]);
                        console.log(`✅ Лот ${lotRecord.lot_number}: "${oldCondition}" -> "${newCondition}"`);
                        updated++;
                    } else {
                        console.log(`⏭️ Лот ${lotRecord.lot_number}: Без изменений ("${oldCondition}")`);
                        skipped++;
                    }
                } else {
                    console.log(`⚠️ Лот ${lot.lotNumber}: Не найден в базе данных`);
                    notFound++;
                }
                
            } catch (error) {
                console.error(`❌ Ошибка обновления лота ${lot.lotNumber}:`, error.message);
            }
        }
        
        console.log(`\n📊 Результат тестирования:`);
        console.log(`  ✅ Обновлено: ${updated}`);
        console.log(`  ⏭️ Пропущено: ${skipped}`);
        console.log(`  ⚠️ Не найдено: ${notFound}`);
        
        await browser.close();
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    } finally {
        await client.end();
    }
}

testOldAuction964();

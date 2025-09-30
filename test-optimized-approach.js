const { Client } = require('pg');
const puppeteer = require('puppeteer-core');
const fs = require('fs');

const dbConfig = {
    user: 'postgres.xkwgspqwebfeteoblayu',        
    host: 'aws-0-eu-north-1.pooler.supabase.com',
    database: 'postgres',   
    password: 'Gopapopa326+',    
    port: 6543,
    ssl: {
        rejectUnauthorized: false
    }
};

class TestOptimizedApproach {
    constructor() {
        this.dbClient = new Client(dbConfig);
        this.browser = null;
        this.page = null;
        this.results = {
            auctions: [],
            totalUpdated: 0,
            totalSkipped: 0,
            totalErrors: 0,
            totalProcessed: 0
        };
    }

    async init() {
        await this.dbClient.connect();
        console.log('✅ Подключение к базе данных успешно');
        
        this.browser = await puppeteer.launch({
            headless: false, // Показываем браузер для отладки
            executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });
        
        this.page = await this.browser.newPage();
        await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        this.page.setDefaultTimeout(30000);
        this.page.setDefaultNavigationTimeout(30000);
        
        console.log('✅ Браузер инициализирован');
    }

    // Функция для извлечения состояния с градацией
    extractConditionWithGrade(conditionText) {
        if (!conditionText) return null;
        return conditionText.replace(/\s+/g, '');
    }

    // Получение тестовых аукционов (последние 3)
    async getTestAuctions() {
        console.log('📊 Получаем тестовые аукционы...');
        
        const query = `
            SELECT DISTINCT auction_number 
            FROM auction_lots 
            WHERE source_url IS NOT NULL
            ORDER BY auction_number DESC
            LIMIT 3;
        `;
        
        const result = await this.dbClient.query(query);
        console.log(`📋 Найдено ${result.rows.length} тестовых аукционов: ${result.rows.map(r => r.auction_number).join(', ')}`);
        
        return result.rows.map(row => row.auction_number);
    }

    // Парсинг общих страниц аукциона для извлечения состояний
    async parseAuctionPageForConditions(auctionNumber) {
        try {
            const auctionUrl = `https://www.wolmar.ru/auction/${auctionNumber}`;
            console.log(`\n🔍 Парсим общую страницу аукциона ${auctionNumber}...`);
            
            await this.page.goto(auctionUrl, { waitUntil: 'networkidle2', timeout: 30000 });
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            // Извлекаем данные о лотах и их состояниях с общей страницы
            const lotsData = await this.page.evaluate(() => {
                const lots = [];
                
                // Ищем все ссылки на лоты
                const lotLinks = document.querySelectorAll('a[href*="/auction/"]');
                console.log(`Найдено ссылок на лоты: ${lotLinks.length}`);
                
                lotLinks.forEach((link, index) => {
                    try {
                        const lot = {};
                        
                        if (link.href && link.href.includes('/auction/')) {
                            lot.url = link.href;
                            
                            // Извлекаем номер лота из ссылки
                            const urlMatch = link.href.match(/\/auction\/\d+\/(\d+)/);
                            if (urlMatch) {
                                lot.lotNumber = urlMatch[1];
                                
                                // Ищем состояние в родительском элементе или рядом
                                let condition = null;
                                
                                // Метод 1: Ищем в родительской строке таблицы
                                const parentRow = link.closest('tr');
                                if (parentRow) {
                                    const cells = parentRow.querySelectorAll('td');
                                    cells.forEach(cell => {
                                        const cellText = cell.textContent.trim();
                                        if (cellText.match(/^(MS|AU|XF|VF|UNC|PL)[\s\d\-\+\/]*$/i)) {
                                            condition = cellText;
                                        }
                                    });
                                }
                                
                                // Метод 2: Ищем в тексте вокруг ссылки
                                if (!condition) {
                                    const context = link.parentElement ? link.parentElement.textContent : '';
                                    const conditionMatch = context.match(/(MS|AU|XF|VF|UNC|PL)[\s\d\-\+\/]*/i);
                                    if (conditionMatch) {
                                        condition = conditionMatch[0].trim();
                                    }
                                }
                                
                                // Метод 3: Ищем в соседних элементах
                                if (!condition) {
                                    const siblings = link.parentElement ? link.parentElement.parentElement.children : [];
                                    for (let sibling of siblings) {
                                        const siblingText = sibling.textContent.trim();
                                        if (siblingText.match(/^(MS|AU|XF|VF|UNC|PL)[\s\d\-\+\/]*$/i)) {
                                            condition = siblingText;
                                            break;
                                        }
                                    }
                                }
                                
                                if (condition) {
                                    lot.condition = condition;
                                    lots.push(lot);
                                }
                            }
                        }
                    } catch (error) {
                        console.error(`Ошибка при парсинге ссылки ${index}:`, error);
                    }
                });
                
                return lots;
            });
            
            console.log(`✅ Извлечено ${lotsData.length} лотов с состояниями с общей страницы`);
            
            // Показываем примеры
            if (lotsData.length > 0) {
                console.log(`📋 Примеры извлеченных состояний:`);
                lotsData.slice(0, 5).forEach((lot, index) => {
                    console.log(`  ${index + 1}. Лот ${lot.lotNumber}: ${lot.condition}`);
                });
            }
            
            return lotsData;
            
        } catch (error) {
            console.error(`❌ Ошибка при парсинге аукциона ${auctionNumber}:`, error.message);
            return [];
        }
    }

    // Обновление состояний лотов из данных с общей страницы
    async updateLotsFromAuctionPage(auctionNumber, lotsData) {
        console.log(`🔄 Обновляем состояния для аукциона ${auctionNumber}...`);
        
        let auctionUpdated = 0;
        let auctionSkipped = 0;
        let auctionErrors = 0;
        
        for (const lotData of lotsData) {
            try {
                // Получаем текущее состояние из базы
                const currentQuery = `
                    SELECT id, condition FROM auction_lots 
                    WHERE auction_number = $1 AND lot_number = $2;
                `;
                const currentResult = await this.dbClient.query(currentQuery, [auctionNumber, lotData.lotNumber]);
                
                if (currentResult.rows.length > 0) {
                    const lotId = currentResult.rows[0].id;
                    const currentCondition = currentResult.rows[0].condition;
                    const newCondition = this.extractConditionWithGrade(lotData.condition);
                    
                    if (newCondition !== currentCondition) {
                        // Обновляем состояние в базе данных
                        const updateQuery = `
                            UPDATE auction_lots 
                            SET condition = $1, parsed_at = CURRENT_TIMESTAMP
                            WHERE id = $2;
                        `;
                        await this.dbClient.query(updateQuery, [newCondition, lotId]);
                        
                        console.log(`✅ Лот ${lotData.lotNumber}: "${currentCondition}" -> "${newCondition}"`);
                        auctionUpdated++;
                        this.results.totalUpdated++;
                    } else {
                        console.log(`⏭️ Лот ${lotData.lotNumber}: без изменений ("${currentCondition}")`);
                        auctionSkipped++;
                        this.results.totalSkipped++;
                    }
                } else {
                    console.log(`⚠️ Лот ${lotData.lotNumber} не найден в базе данных`);
                    auctionErrors++;
                    this.results.totalErrors++;
                }
                
                this.results.totalProcessed++;
                
            } catch (error) {
                console.error(`❌ Ошибка при обновлении лота ${lotData.lotNumber}:`, error.message);
                auctionErrors++;
                this.results.totalErrors++;
                this.results.totalProcessed++;
            }
        }
        
        const auctionResult = {
            auctionNumber,
            updated: auctionUpdated,
            skipped: auctionSkipped,
            errors: auctionErrors,
            totalLots: lotsData.length
        };
        
        this.results.auctions.push(auctionResult);
        
        console.log(`📊 Аукцион ${auctionNumber}: обновлено ${auctionUpdated}, пропущено ${auctionSkipped}, ошибок ${auctionErrors}`);
        return auctionResult;
    }

    // Основной метод тестирования
    async testOptimizedApproach() {
        try {
            const auctions = await this.getTestAuctions();
            
            if (auctions.length === 0) {
                console.log('❌ Нет аукционов для тестирования');
                return;
            }
            
            console.log(`\n🧪 Начинаем тестирование оптимизированного подхода на ${auctions.length} аукционах...`);
            console.log('⏰ Время начала:', new Date().toLocaleString());
            
            for (let i = 0; i < auctions.length; i++) {
                const auctionNumber = auctions[i];
                
                console.log(`\n📋 [${i + 1}/${auctions.length}] Тестируем аукцион ${auctionNumber}...`);
                
                // Парсим общую страницу аукциона
                const lotsData = await this.parseAuctionPageForConditions(auctionNumber);
                
                if (lotsData.length > 0) {
                    // Обновляем состояния лотов
                    await this.updateLotsFromAuctionPage(auctionNumber, lotsData);
                } else {
                    console.log(`⚠️ Не удалось извлечь данные с общей страницы аукциона ${auctionNumber}`);
                }
                
                // Пауза между аукционами
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
            
            console.log('\n🎉 ТЕСТИРОВАНИЕ ЗАВЕРШЕНО!');
            this.printTestResults();
            
        } catch (error) {
            console.error('❌ Ошибка при тестировании:', error.message);
        }
    }

    printTestResults() {
        console.log('\n📊 РЕЗУЛЬТАТЫ ТЕСТИРОВАНИЯ:');
        console.log('='.repeat(60));
        
        this.results.auctions.forEach(auction => {
            console.log(`\n📋 Аукцион ${auction.auctionNumber}:`);
            console.log(`   📊 Всего лотов на странице: ${auction.totalLots}`);
            console.log(`   ✅ Обновлено: ${auction.updated}`);
            console.log(`   ⏭️ Без изменений: ${auction.skipped}`);
            console.log(`   ❌ Ошибок: ${auction.errors}`);
            
            if (auction.totalLots > 0) {
                const successRate = ((auction.updated + auction.skipped) / auction.totalLots * 100).toFixed(1);
                console.log(`   📈 Успешность: ${successRate}%`);
            }
        });
        
        console.log(`\n📊 ОБЩИЕ РЕЗУЛЬТАТЫ:`);
        console.log(`   ✅ Обновлено лотов: ${this.results.totalUpdated}`);
        console.log(`   ⏭️ Без изменений: ${this.results.totalSkipped}`);
        console.log(`   ❌ Ошибок: ${this.results.totalErrors}`);
        console.log(`   📊 Всего обработано: ${this.results.totalProcessed}`);
        
        if (this.results.totalProcessed > 0) {
            const successRate = ((this.results.totalUpdated + this.results.totalSkipped) / this.results.totalProcessed * 100).toFixed(1);
            console.log(`   📈 Общая успешность: ${successRate}%`);
        }
        
        // Сохраняем результаты в файл
        try {
            const resultsFile = 'test_results.json';
            fs.writeFileSync(resultsFile, JSON.stringify(this.results, null, 2));
            console.log(`\n💾 Результаты сохранены в файл: ${resultsFile}`);
        } catch (error) {
            console.log('⚠️ Не удалось сохранить результаты в файл');
        }
    }

    async close() {
        try {
            if (this.dbClient) {
                await this.dbClient.end();
                console.log('✅ Соединение с базой данных закрыто');
            }
        } catch (error) {
            console.log('⚠️ Ошибка при закрытии соединения с БД');
        }
        
        try {
            if (this.browser) {
                await this.browser.close();
                console.log('✅ Браузер закрыт');
            }
        } catch (error) {
            console.log('⚠️ Ошибка при закрытии браузера');
        }
    }
}

async function testOptimizedApproach() {
    const tester = new TestOptimizedApproach();
    
    try {
        await tester.init();
        await tester.testOptimizedApproach();
    } catch (error) {
        console.error('❌ Критическая ошибка:', error);
    } finally {
        await tester.close();
    }
}

// Обработка сигналов для корректного завершения
process.on('SIGINT', async () => {
    console.log('\n⚠️ Получен сигнал прерывания. Завершаем тестирование...');
    process.exit(0);
});

testOptimizedApproach();

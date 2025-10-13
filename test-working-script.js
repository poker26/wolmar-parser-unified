/**
 * Тестовый скрипт для проверки рабочей версии оптимизированного обновления
 * Тестируем на аукционе 961 (внутренний номер 2117) - проверяем улучшенное определение пагинации
 */

const { Client } = require('pg');
const puppeteer = require('puppeteer-core');
const config = require('./config');

class TestWorkingUpdater {
    constructor() {
        this.dbConfig = config.dbConfig;
        this.dbClient = new Client(this.dbConfig);
        this.browser = null;
        this.page = null;
        
        this.stats = {
            processed: 0,
            updated: 0,
            skipped: 0,
            errors: 0,
            pagesProcessed: 0
        };
    }

    async init() {
        try {
            await this.dbClient.connect();
            console.log('🔗 Подключение к базе данных установлено');
            
            await this.initBrowser();
            console.log('🌐 Браузер инициализирован');
        } catch (error) {
            console.error('❌ Ошибка инициализации:', error.message);
            throw error;
        }
    }

    async initBrowser() {
        try {
            this.browser = await puppeteer.launch({
                executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
                headless: true,
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
            this.page = await this.browser.newPage();
            await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
        } catch (error) {
            console.error('❌ Ошибка инициализации браузера:', error.message);
            throw error;
        }
    }

    extractConditionWithGrade(conditionText) {
        if (!conditionText) return null;
        return conditionText.replace(/\s+/g, '');
    }

    async testPaginationDetection() {
        console.log('\n🧪 ТЕСТИРУЕМ УЛУЧШЕННОЕ ОПРЕДЕЛЕНИЕ ПАГИНАЦИИ:');
        
        const auctionUrl = 'https://www.wolmar.ru/auction/2117';
        console.log(`📄 Переходим на: ${auctionUrl}`);
        
        await this.page.goto(auctionUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Улучшенное определение количества страниц
        const totalPages = await this.page.evaluate(() => {
            // Способ 1: Ищем пагинацию
            const pagination = document.querySelector('.pagination');
            if (pagination) {
                console.log('Найдена пагинация:', pagination.textContent);
                const pageLinks = pagination.querySelectorAll('a');
                let maxPage = 1;
                
                pageLinks.forEach(link => {
                    const text = link.textContent.trim();
                    const pageNum = parseInt(text);
                    if (!isNaN(pageNum) && pageNum > maxPage) {
                        maxPage = pageNum;
                    }
                });
                
                if (maxPage > 1) return maxPage;
            }
            
            // Способ 2: Ищем ссылки на страницы в тексте
            const pageLinks = document.querySelectorAll('a[href*="page="]');
            let maxPage = 1;
            
            pageLinks.forEach(link => {
                const href = link.href;
                const pageMatch = href.match(/page=(\d+)/);
                if (pageMatch) {
                    const pageNum = parseInt(pageMatch[1]);
                    if (pageNum > maxPage) {
                        maxPage = pageNum;
                    }
                }
            });
            
            // Способ 3: Если ничего не найдено, пробуем перейти на страницу 2
            if (maxPage === 1) {
                // Проверяем, есть ли ссылка на страницу 2
                const page2Link = document.querySelector('a[href*="page=2"]');
                if (page2Link) {
                    maxPage = 2; // Минимум 2 страницы
                }
            }
            
            return maxPage;
        });
        
        console.log(`📄 Определено ${totalPages} страниц для парсинга`);
        
        // Тестируем парсинг каждой страницы
        let allLotsData = [];
        let targetLotFound = false;
        
        for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
            console.log(`\n📖 Парсим страницу ${pageNum}/${totalPages}...`);
            
            if (pageNum > 1) {
                const pageUrl = `${auctionUrl}?page=${pageNum}`;
                await this.page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 30000 });
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
            
            // Извлекаем данные о лотах с состояниями из таблицы
            const pageLotsData = await this.page.evaluate(() => {
                const lots = [];
                
                // Ищем таблицы с лотами
                const tables = document.querySelectorAll('table');
                
                tables.forEach(table => {
                    const rows = table.querySelectorAll('tr');
                    
                    rows.forEach(row => {
                        const cells = row.querySelectorAll('td, th');
                        
                        // Проверяем, что это строка с лотом (должно быть 10 ячеек и ссылка на лот)
                        if (cells.length >= 10) {
                            const lotLink = row.querySelector('a[href*="/auction/"]');
                            
                            if (lotLink) {
                                const lotUrl = lotLink.href;
                                const lotNumberMatch = lotUrl.match(/\/auction\/\d+\/(\d+)/);
                                const lotNumber = lotNumberMatch ? lotNumberMatch[1] : null;
                                
                                // Состояние находится в 6-й ячейке (индекс 5)
                                const conditionCell = cells[5];
                                const condition = conditionCell ? conditionCell.textContent.trim() : null;
                                
                                // Дополнительная информация
                                const nameCell = cells[1];
                                const yearCell = cells[2];
                                const lettersCell = cells[3];
                                const metalCell = cells[4];
                                
                                if (lotNumber && condition && condition.match(/^(MS|PF|AU|UNC|XF|VF|VG|F|G|PR|PL|Proof|Gem)/i)) {
                                    lots.push({
                                        lotNumber: lotNumber,
                                        lotUrl: lotUrl,
                                        condition: condition,
                                        name: nameCell ? nameCell.textContent.trim() : '',
                                        year: yearCell ? yearCell.textContent.trim() : '',
                                        letters: lettersCell ? lettersCell.textContent.trim() : '',
                                        metal: metalCell ? metalCell.textContent.trim() : ''
                                    });
                                }
                            }
                        }
                    });
                });
                
                return lots;
            });
            
            allLotsData = allLotsData.concat(pageLotsData);
            this.stats.pagesProcessed++;
            
            console.log(`  📊 Страница ${pageNum}: найдено ${pageLotsData.length} лотов`);
            
            // Проверяем, есть ли целевой лот на этой странице
            const targetLot = pageLotsData.find(lot => lot.lotNumber === '7478027');
            if (targetLot) {
                console.log(`  🎯 НАЙДЕН ЦЕЛЕВОЙ ЛОТ на странице ${pageNum}:`);
                console.log(`    Номер: ${targetLot.lotNumber}`);
                console.log(`    Состояние: "${targetLot.condition}"`);
                console.log(`    URL: ${targetLot.lotUrl}`);
                targetLotFound = true;
            }
            
            // Показываем первые 3 лота с каждой страницы
            if (pageLotsData.length > 0) {
                console.log(`  📋 Первые 3 лота со страницы ${pageNum}:`);
                pageLotsData.slice(0, 3).forEach((lot, index) => {
                    console.log(`    ${index + 1}. Лот ${lot.lotNumber}: "${lot.condition}"`);
                });
            }
            
            // Небольшая пауза между страницами
            if (pageNum < totalPages) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        
        console.log(`\n📊 ИТОГО найдено ${allLotsData.length} лотов с состояниями на всех страницах`);
        
        if (!targetLotFound) {
            console.log(`❌ Лот 7478027 НЕ НАЙДЕН на всех страницах`);
        }
        
        // Показываем статистику по состояниям
        const conditionStats = {};
        allLotsData.forEach(lot => {
            const condition = lot.condition;
            conditionStats[condition] = (conditionStats[condition] || 0) + 1;
        });
        
        console.log(`\n📊 Статистика по состояниям:`);
        Object.entries(conditionStats)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .forEach(([condition, count]) => {
                console.log(`  "${condition}": ${count} лотов`);
            });
        
        return allLotsData;
    }

    async run() {
        try {
            await this.init();
            
            console.log('🧪 ТЕСТИРОВАНИЕ РАБОЧЕЙ ВЕРСИИ СКРИПТА');
            console.log('📋 Тестируем улучшенное определение пагинации для аукциона 2117');
            
            // Тестируем улучшенное определение пагинации
            const lotsData = await this.testPaginationDetection();
            
            console.log('\n🎉 ТЕСТИРОВАНИЕ ЗАВЕРШЕНО!');
            console.log(`📊 Обработано страниц: ${this.stats.pagesProcessed}`);
            console.log(`📊 Найдено лотов: ${lotsData.length}`);
            console.log(`✅ Обновлено: ${this.stats.updated}`);
            console.log(`⏭️ Пропущено: ${this.stats.skipped}`);
            console.log(`❌ Ошибок: ${this.stats.errors}`);
            
        } catch (error) {
            console.error('❌ Критическая ошибка:', error.message);
        } finally {
            await this.cleanup();
        }
    }

    async cleanup() {
        try {
            if (this.browser) {
                await this.browser.close();
            }
        } catch (error) {
            console.error('❌ Ошибка закрытия браузера:', error.message);
        }
        
        try {
            if (this.dbClient) {
                await this.dbClient.end();
            }
        } catch (error) {
            console.error('❌ Ошибка закрытия БД:', error.message);
        }
        
        console.log('🧹 Ресурсы освобождены');
    }
}

async function main() {
    const tester = new TestWorkingUpdater();
    await tester.run();
}

main();

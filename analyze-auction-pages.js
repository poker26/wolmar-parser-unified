const puppeteer = require('puppeteer-core');

class AuctionPageAnalyzer {
    constructor() {
        this.browser = null;
        this.page = null;
    }

    async init() {
        console.log('🚀 Инициализация браузера...');
        this.browser = await puppeteer.launch({
            headless: true,
            executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        this.page = await this.browser.newPage();
        
        // Установка user-agent
        await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        
        console.log('✅ Браузер инициализирован');
    }

    async analyzeAuctionPage(auctionNumber) {
        try {
            console.log(`\n🔍 Анализируем аукцион ${auctionNumber}...`);
            
            const url = `https://www.wolmar.ru/auction/${auctionNumber}`;
            console.log(`📄 Загружаем страницу: ${url}`);
            
            await this.page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
            
            // Ждем загрузки контента
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Анализируем структуру страницы
            const pageAnalysis = await this.page.evaluate(() => {
                const results = {
                    totalLots: 0,
                    lotsWithConditions: 0,
                    lotsWithGrades: 0,
                    lotsWithSpaces: 0,
                    sampleConditions: [],
                    pageStructure: {}
                };
                
                // Ищем все элементы с лотами
                const lotElements = document.querySelectorAll('.lot-item, .auction-lot, [class*="lot"], [class*="auction"]');
                console.log(`Найдено ${lotElements.length} элементов лотов`);
                
                // Анализируем каждый элемент лота
                lotElements.forEach((element, index) => {
                    const text = element.textContent || '';
                    
                    // Ищем информацию о состоянии
                    const conditionMatch = text.match(/Сохранность:\s*([^\n\r]+)/i);
                    if (conditionMatch) {
                        const condition = conditionMatch[1].trim();
                        results.lotsWithConditions++;
                        results.sampleConditions.push(condition);
                        
                        // Проверяем наличие градаций
                        if (/\d{2,3}/.test(condition)) {
                            results.lotsWithGrades++;
                        }
                        
                        // Проверяем наличие пробелов
                        if (/\s/.test(condition)) {
                            results.lotsWithSpaces++;
                        }
                    }
                });
                
                results.totalLots = lotElements.length;
                
                // Анализируем структуру страницы
                results.pageStructure = {
                    hasLotTable: !!document.querySelector('table'),
                    hasLotList: !!document.querySelector('.lot-list, [class*="lot-list"]'),
                    hasLotGrid: !!document.querySelector('.lot-grid, [class*="lot-grid"]'),
                    hasLotCards: !!document.querySelector('.lot-card, [class*="lot-card"]'),
                    totalElements: document.querySelectorAll('*').length
                };
                
                return results;
            });
            
            console.log(`📊 Результаты анализа аукциона ${auctionNumber}:`);
            console.log(`   Всего элементов лотов: ${pageAnalysis.totalLots}`);
            console.log(`   Лотов с состояниями: ${pageAnalysis.lotsWithConditions}`);
            console.log(`   Лотов с градациями: ${pageAnalysis.lotsWithGrades}`);
            console.log(`   Лотов с пробелами: ${pageAnalysis.lotsWithSpaces}`);
            
            if (pageAnalysis.sampleConditions.length > 0) {
                console.log(`\n📋 Примеры состояний:`);
                pageAnalysis.sampleConditions.slice(0, 10).forEach((condition, index) => {
                    console.log(`   ${index + 1}. "${condition}"`);
                });
            }
            
            console.log(`\n🏗️ Структура страницы:`);
            console.log(`   Есть таблица лотов: ${pageAnalysis.pageStructure.hasLotTable}`);
            console.log(`   Есть список лотов: ${pageAnalysis.pageStructure.hasLotList}`);
            console.log(`   Есть сетка лотов: ${pageAnalysis.pageStructure.hasLotGrid}`);
            console.log(`   Есть карточки лотов: ${pageAnalysis.pageStructure.hasLotCards}`);
            
            return pageAnalysis;
            
        } catch (error) {
            console.error(`❌ Ошибка при анализе аукциона ${auctionNumber}:`, error.message);
            return null;
        }
    }

    async close() {
        if (this.browser) {
            await this.browser.close();
            console.log('✅ Браузер закрыт');
        }
    }
}

async function analyzeAuctionPages() {
    const analyzer = new AuctionPageAnalyzer();
    
    try {
        await analyzer.init();
        
        // Анализируем несколько аукционов
        const auctionsToAnalyze = ['965', '967', '964', '963'];
        const results = {};
        
        for (const auctionNumber of auctionsToAnalyze) {
            const result = await analyzer.analyzeAuctionPage(auctionNumber);
            if (result) {
                results[auctionNumber] = result;
            }
            
            // Пауза между запросами
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
        // Итоговый анализ
        console.log('\n📊 ИТОГОВЫЙ АНАЛИЗ:');
        console.log('='.repeat(50));
        
        Object.entries(results).forEach(([auction, data]) => {
            console.log(`\nАукцион ${auction}:`);
            console.log(`  Лотов с состояниями: ${data.lotsWithConditions}`);
            console.log(`  Лотов с градациями: ${data.lotsWithGrades}`);
            console.log(`  Лотов с пробелами: ${data.lotsWithSpaces}`);
            
            if (data.lotsWithGrades > 0) {
                console.log(`  ✅ Есть градации - можно обновлять через общие страницы`);
            } else {
                console.log(`  ❌ Нет градаций - нужен индивидуальный парсинг`);
            }
        });
        
        // Рекомендации
        console.log('\n🎯 РЕКОМЕНДАЦИИ:');
        const auctionsWithGrades = Object.entries(results).filter(([_, data]) => data.lotsWithGrades > 0);
        
        if (auctionsWithGrades.length > 0) {
            console.log('✅ Рекомендуется массовое обновление через общие страницы для аукционов:');
            auctionsWithGrades.forEach(([auction, _]) => {
                console.log(`   - Аукцион ${auction}`);
            });
        } else {
            console.log('❌ Рекомендуется индивидуальный парсинг каждого лота');
        }
        
    } catch (error) {
        console.error('❌ Ошибка при анализе:', error);
    } finally {
        await analyzer.close();
    }
}

analyzeAuctionPages();

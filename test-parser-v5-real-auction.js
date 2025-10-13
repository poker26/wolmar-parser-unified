const puppeteer = require('puppeteer-core');

class RealAuctionTester {
    constructor() {
        this.browser = null;
        this.page = null;
    }

    async init() {
        this.browser = await puppeteer.launch({
            headless: true,
            executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
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
        await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        this.page.setDefaultTimeout(30000);
        this.page.setDefaultNavigationTimeout(30000);
        
        console.log('✅ Браузер инициализирован');
    }

    // Функция извлечения состояния с градацией (из wolmar-parser5.js)
    extractConditionWithGrade(conditionText) {
        if (!conditionText) return null;
        return conditionText.replace(/\s+/g, '');
    }

    // Тестирование конкретных лотов аукциона 2104
    async testAuction2104Lots() {
        console.log('\n🔍 ТЕСТИРОВАНИЕ РЕАЛЬНЫХ ЛОТОВ АУКЦИОНА 2104:');
        console.log('='.repeat(60));
        
        // Тестируем несколько конкретных лотов аукциона 2104
        const testLots = [
            'https://www.wolmar.ru/auction/2104/1',
            'https://www.wolmar.ru/auction/2104/5',
            'https://www.wolmar.ru/auction/2104/10',
            'https://www.wolmar.ru/auction/2104/15',
            'https://www.wolmar.ru/auction/2104/20'
        ];
        
        const results = [];
        
        for (let i = 0; i < testLots.length; i++) {
            const lotUrl = testLots[i];
            console.log(`\n🔍 Тестируем лот ${i + 1}: ${lotUrl}`);
            
            try {
                await this.page.goto(lotUrl, { waitUntil: 'networkidle2', timeout: 30000 });
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                // Извлекаем данные о состоянии (как в wolmar-parser5.js)
                const lotData = await this.page.evaluate(() => {
                    const data = {};
                    
                    // Ищем информацию о состоянии в тексте страницы
                    const pageText = document.body.textContent || '';
                    
                    // Основной паттерн поиска состояния (как в wolmar-parser5.js)
                    const conditionMatch = pageText.match(/Сохранность:\s*([^\n\r]+)/i);
                    if (conditionMatch) {
                        data.condition = conditionMatch[1].trim();
                    }
                    
                    // Ищем номер лота
                    const lotNumberMatch = pageText.match(/Лот\s*(\d+)/i);
                    if (lotNumberMatch) {
                        data.lotNumber = lotNumberMatch[1];
                    }
                    
                    // Ищем описание монеты
                    const descriptionMatch = pageText.match(/Описание[:\s]*([^\n\r]+)/i);
                    if (descriptionMatch) {
                        data.description = descriptionMatch[1].trim();
                    }
                    
                    // Ищем год
                    const yearMatch = pageText.match(/(\d{4})\s*год/i);
                    if (yearMatch) {
                        data.year = yearMatch[1];
                    }
                    
                    // Ищем металл
                    const metalMatch = pageText.match(/Металл[:\s]*([^\n\r]+)/i);
                    if (metalMatch) {
                        data.metal = metalMatch[1].trim();
                    }
                    
                    return data;
                });
                
                if (lotData.condition) {
                    const processedCondition = this.extractConditionWithGrade(lotData.condition);
                    console.log(`✅ Лот ${lotData.lotNumber}: "${lotData.condition}" -> "${processedCondition}"`);
                    
                    if (lotData.description) {
                        console.log(`   Описание: ${lotData.description}`);
                    }
                    
                    if (lotData.year) {
                        console.log(`   Год: ${lotData.year}`);
                    }
                    
                    if (lotData.metal) {
                        console.log(`   Металл: ${lotData.metal}`);
                    }
                    
                    results.push({
                        lotNumber: lotData.lotNumber,
                        originalCondition: lotData.condition,
                        processedCondition: processedCondition,
                        description: lotData.description,
                        year: lotData.year,
                        metal: lotData.metal,
                        url: lotUrl
                    });
                } else {
                    console.log(`⚠️ Состояние не найдено для лота ${lotUrl}`);
                    
                    // Попробуем найти любую информацию о состоянии
                    const pageText = await this.page.evaluate(() => document.body.textContent);
                    const conditionKeywords = ['MS', 'AU', 'XF', 'VF', 'UNC', 'PF', 'PL', 'PR', 'F'];
                    const foundKeywords = conditionKeywords.filter(keyword => 
                        pageText.includes(keyword)
                    );
                    
                    if (foundKeywords.length > 0) {
                        console.log(`   Найдены ключевые слова состояний: ${foundKeywords.join(', ')}`);
                    }
                    
                    // Покажем часть текста страницы для анализа
                    const textSample = pageText.substring(0, 500);
                    console.log(`   Образец текста страницы: ${textSample}...`);
                }
                
            } catch (error) {
                console.error(`❌ Ошибка при парсинге лота ${lotUrl}:`, error.message);
            }
        }
        
        return results;
    }

    // Основной метод тестирования
    async runTest() {
        try {
            console.log('🚀 ТЕСТИРОВАНИЕ WOLMAR-PARSER5 НА РЕАЛЬНОМ АУКЦИОНЕ 2104');
            console.log('='.repeat(70));
            
            // Тестируем конкретные лоты аукциона 2104
            const results = await this.testAuction2104Lots();
            
            // Выводим итоговую статистику
            console.log('\n📊 ИТОГОВАЯ СТАТИСТИКА:');
            console.log('='.repeat(40));
            console.log(`✅ Успешно обработано лотов: ${results.length}`);
            
            if (results.length > 0) {
                console.log('\n📋 ОБРАБОТАННЫЕ СОСТОЯНИЯ:');
                results.forEach((result, index) => {
                    console.log(`${index + 1}. Лот ${result.lotNumber}: "${result.originalCondition}" -> "${result.processedCondition}"`);
                });
                
                // Анализируем типы состояний
                const conditionTypes = {};
                results.forEach(result => {
                    const condition = result.originalCondition;
                    if (condition.includes('MS')) conditionTypes['MS'] = (conditionTypes['MS'] || 0) + 1;
                    if (condition.includes('AU')) conditionTypes['AU'] = (conditionTypes['AU'] || 0) + 1;
                    if (condition.includes('XF')) conditionTypes['XF'] = (conditionTypes['XF'] || 0) + 1;
                    if (condition.includes('VF')) conditionTypes['VF'] = (conditionTypes['VF'] || 0) + 1;
                    if (condition.includes('UNC')) conditionTypes['UNC'] = (conditionTypes['UNC'] || 0) + 1;
                    if (condition.includes('PF')) conditionTypes['PF'] = (conditionTypes['PF'] || 0) + 1;
                });
                
                console.log('\n📊 АНАЛИЗ ТИПОВ СОСТОЯНИЙ:');
                Object.entries(conditionTypes).forEach(([type, count]) => {
                    console.log(`${type}: ${count} лотов`);
                });
            }
            
            console.log('\n🎉 ТЕСТИРОВАНИЕ ЗАВЕРШЕНО!');
            
        } catch (error) {
            console.error('❌ Критическая ошибка при тестировании:', error.message);
        }
    }

    async close() {
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

async function testRealAuction() {
    const tester = new RealAuctionTester();
    
    try {
        await tester.init();
        await tester.runTest();
    } catch (error) {
        console.error('❌ Критическая ошибка:', error.message);
    } finally {
        await tester.close();
    }
}

testRealAuction();

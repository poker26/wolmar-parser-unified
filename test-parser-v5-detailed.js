const puppeteer = require('puppeteer-core');
const { Client } = require('pg');

const dbConfig = {
    user: 'postgres.xkwgspqwebfeteoblayu',        
    host: 'sup.begemot26.ru',
    database: 'postgres',   
    password: 'Gopapopa326+',    
    port: 6543,
    ssl: {
        rejectUnauthorized: false
    }
};

class DetailedParserV5Tester {
    constructor() {
        this.dbClient = new Client(dbConfig);
        this.browser = null;
        this.page = null;
    }

    async init() {
        await this.dbClient.connect();
        console.log('✅ Подключение к базе данных успешно');
        
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
    async testSpecificLots() {
        console.log('\n🔍 ТЕСТИРОВАНИЕ КОНКРЕТНЫХ ЛОТОВ АУКЦИОНА 2104:');
        console.log('='.repeat(60));
        
        // Тестируем несколько конкретных лотов
        const testLots = [
            'https://www.wolmar.ru/auction/2104/1',
            'https://www.wolmar.ru/auction/2104/10',
            'https://www.wolmar.ru/auction/2104/50',
            'https://www.wolmar.ru/auction/2104/100',
            'https://www.wolmar.ru/auction/2104/200'
        ];
        
        const results = [];
        
        for (let i = 0; i < testLots.length; i++) {
            const lotUrl = testLots[i];
            console.log(`\n🔍 Тестируем лот ${i + 1}: ${lotUrl}`);
            
            try {
                await this.page.goto(lotUrl, { waitUntil: 'networkidle2', timeout: 30000 });
                await new Promise(resolve => setTimeout(resolve, 1500));
                
                // Извлекаем данные о состоянии
                const lotData = await this.page.evaluate(() => {
                    const data = {};
                    
                    // Ищем информацию о состоянии в тексте страницы
                    const pageText = document.body.textContent || '';
                    
                    // Различные варианты поиска состояния
                    const patterns = [
                        /Сохранность:\s*([^\n\r]+)/i,
                        /Состояние:\s*([^\n\r]+)/i,
                        /Grade:\s*([^\n\r]+)/i,
                        /Condition:\s*([^\n\r]+)/i
                    ];
                    
                    for (const pattern of patterns) {
                        const match = pageText.match(pattern);
                        if (match) {
                            data.condition = match[1].trim();
                            break;
                        }
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
                    
                    results.push({
                        lotNumber: lotData.lotNumber,
                        originalCondition: lotData.condition,
                        processedCondition: processedCondition,
                        description: lotData.description,
                        year: lotData.year,
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
                }
                
            } catch (error) {
                console.error(`❌ Ошибка при парсинге лота ${lotUrl}:`, error.message);
            }
        }
        
        return results;
    }

    // Тестирование на известных лотах с градациями
    async testKnownLotsWithGrades() {
        console.log('\n🔍 ТЕСТИРОВАНИЕ ИЗВЕСТНЫХ ЛОТОВ С ГРАДАЦИЯМИ:');
        console.log('='.repeat(60));
        
        // Тестируем лоты, которые мы знаем имеют градации
        const knownLots = [
            'https://www.wolmar.ru/auction/2130/7555831', // MS 61
            'https://www.wolmar.ru/auction/2130/7555840', // MS 61
            'https://www.wolmar.ru/auction/2121/7501805', // MS 61
            'https://www.wolmar.ru/auction/2126/7525679'  // MS 61
        ];
        
        const results = [];
        
        for (let i = 0; i < knownLots.length; i++) {
            const lotUrl = knownLots[i];
            console.log(`\n🔍 Тестируем известный лот ${i + 1}: ${lotUrl}`);
            
            try {
                await this.page.goto(lotUrl, { waitUntil: 'networkidle2', timeout: 30000 });
                await new Promise(resolve => setTimeout(resolve, 1500));
                
                // Извлекаем данные о состоянии
                const lotData = await this.page.evaluate(() => {
                    const data = {};
                    
                    // Ищем информацию о состоянии в тексте страницы
                    const pageText = document.body.textContent || '';
                    const conditionMatch = pageText.match(/Сохранность:\s*([^\n\r]+)/i);
                    if (conditionMatch) {
                        data.condition = conditionMatch[1].trim();
                    }
                    
                    // Ищем номер лота
                    const lotNumberMatch = pageText.match(/Лот\s*(\d+)/i);
                    if (lotNumberMatch) {
                        data.lotNumber = lotNumberMatch[1];
                    }
                    
                    return data;
                });
                
                if (lotData.condition) {
                    const processedCondition = this.extractConditionWithGrade(lotData.condition);
                    console.log(`✅ Лот ${lotData.lotNumber}: "${lotData.condition}" -> "${processedCondition}"`);
                    
                    results.push({
                        lotNumber: lotData.lotNumber,
                        originalCondition: lotData.condition,
                        processedCondition: processedCondition,
                        url: lotUrl
                    });
                } else {
                    console.log(`⚠️ Состояние не найдено для лота ${lotUrl}`);
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
            console.log('🚀 ДЕТАЛЬНОЕ ТЕСТИРОВАНИЕ WOLMAR-PARSER5');
            console.log('='.repeat(70));
            
            // 1. Тестируем конкретные лоты аукциона 2104
            const auction2104Results = await this.testSpecificLots();
            
            // 2. Тестируем известные лоты с градациями
            const knownLotsResults = await this.testKnownLotsWithGrades();
            
            // 3. Выводим итоговую статистику
            console.log('\n📊 ИТОГОВАЯ СТАТИСТИКА:');
            console.log('='.repeat(40));
            console.log(`✅ Успешно обработано лотов аукциона 2104: ${auction2104Results.length}`);
            console.log(`✅ Успешно обработано известных лотов: ${knownLotsResults.length}`);
            
            const allResults = [...auction2104Results, ...knownLotsResults];
            if (allResults.length > 0) {
                console.log('\n📋 ВСЕ ОБРАБОТАННЫЕ СОСТОЯНИЯ:');
                allResults.forEach((result, index) => {
                    console.log(`${index + 1}. Лот ${result.lotNumber}: "${result.originalCondition}" -> "${result.processedCondition}"`);
                });
            }
            
            console.log('\n🎉 ДЕТАЛЬНОЕ ТЕСТИРОВАНИЕ ЗАВЕРШЕНО!');
            
        } catch (error) {
            console.error('❌ Критическая ошибка при тестировании:', error.message);
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

async function testDetailedParserV5() {
    const tester = new DetailedParserV5Tester();
    
    try {
        await tester.init();
        await tester.runTest();
    } catch (error) {
        console.error('❌ Критическая ошибка:', error.message);
    } finally {
        await tester.close();
    }
}

testDetailedParserV5();

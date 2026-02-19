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

class ParserV5Tester {
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

    // Тестирование парсинга общего аукциона
    async testAuctionPageParsing() {
        console.log('\n🔍 ТЕСТИРОВАНИЕ ПАРСИНГА ОБЩЕЙ СТРАНИЦЫ АУКЦИОНА 2104:');
        console.log('='.repeat(60));
        
        try {
            await this.page.goto('https://www.wolmar.ru/auction/2104', { waitUntil: 'networkidle2', timeout: 30000 });
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Извлекаем данные о лотах с общей страницы
            const auctionData = await this.page.evaluate(() => {
                const lots = [];
                
                // Ищем все элементы лотов
                const lotElements = document.querySelectorAll('.lot-item, .auction-lot, [class*="lot"]');
                
                lotElements.forEach((element, index) => {
                    try {
                        const lotData = {};
                        
                        // Ищем номер лота
                        const lotNumberMatch = element.textContent.match(/Лот\s*(\d+)/i);
                        if (lotNumberMatch) {
                            lotData.lotNumber = lotNumberMatch[1];
                        }
                        
                        // Ищем состояние/сохранность
                        const conditionMatch = element.textContent.match(/Сохранность:\s*([^\n\r]+)/i);
                        if (conditionMatch) {
                            lotData.condition = conditionMatch[1].trim();
                        }
                        
                        // Ищем ссылку на лот
                        const linkElement = element.querySelector('a[href*="/auction/2104/"]');
                        if (linkElement) {
                            lotData.url = linkElement.href;
                        }
                        
                        if (lotData.lotNumber && lotData.condition) {
                            lots.push(lotData);
                        }
                    } catch (error) {
                        console.log(`Ошибка при обработке элемента ${index}:`, error.message);
                    }
                });
                
                return lots;
            });
            
            console.log(`📊 Найдено ${auctionData.length} лотов с состояниями на общей странице`);
            
            if (auctionData.length > 0) {
                console.log('\n📋 ПРИМЕРЫ СОСТОЯНИЙ С ОБЩЕЙ СТРАНИЦЫ:');
                auctionData.slice(0, 10).forEach((lot, index) => {
                    const processedCondition = this.extractConditionWithGrade(lot.condition);
                    console.log(`${index + 1}. Лот ${lot.lotNumber}: "${lot.condition}" -> "${processedCondition}"`);
                });
            }
            
            return auctionData;
            
        } catch (error) {
            console.error('❌ Ошибка при парсинге общей страницы:', error.message);
            return [];
        }
    }

    // Тестирование парсинга отдельных лотов
    async testIndividualLotParsing(lotUrls) {
        console.log('\n🔍 ТЕСТИРОВАНИЕ ПАРСИНГА ОТДЕЛЬНЫХ ЛОТОВ:');
        console.log('='.repeat(60));
        
        const results = [];
        
        for (let i = 0; i < Math.min(lotUrls.length, 5); i++) {
            const lotUrl = lotUrls[i];
            console.log(`\n🔍 Тестируем лот ${i + 1}: ${lotUrl}`);
            
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

    // Проверка существующих записей в базе данных
    async checkExistingRecords() {
        console.log('\n🔍 ПРОВЕРКА СУЩЕСТВУЮЩИХ ЗАПИСЕЙ В БАЗЕ ДАННЫХ:');
        console.log('='.repeat(60));
        
        try {
            const query = `
                SELECT lot_number, condition, source_url
                FROM auction_lots 
                WHERE auction_number = '2104'
                ORDER BY lot_number
                LIMIT 10;
            `;
            
            const result = await this.dbClient.query(query);
            
            if (result.rows.length > 0) {
                console.log(`📊 Найдено ${result.rows.length} записей аукциона 2104 в базе данных:`);
                result.rows.forEach((row, index) => {
                    console.log(`${index + 1}. Лот ${row.lot_number}: "${row.condition}"`);
                });
            } else {
                console.log('⚠️ Записи аукциона 2104 не найдены в базе данных');
            }
            
            return result.rows;
            
        } catch (error) {
            console.error('❌ Ошибка при проверке базы данных:', error.message);
            return [];
        }
    }

    // Основной метод тестирования
    async runTest() {
        try {
            console.log('🚀 ЗАПУСК ТЕСТИРОВАНИЯ WOLMAR-PARSER5 НА АУКЦИОНЕ 2104');
            console.log('='.repeat(70));
            
            // 1. Проверяем существующие записи
            await this.checkExistingRecords();
            
            // 2. Тестируем парсинг общей страницы
            const auctionData = await this.testAuctionPageParsing();
            
            // 3. Тестируем парсинг отдельных лотов
            if (auctionData.length > 0) {
                const lotUrls = auctionData.map(lot => lot.url).filter(url => url);
                await this.testIndividualLotParsing(lotUrls);
            }
            
            console.log('\n🎉 ТЕСТИРОВАНИЕ ЗАВЕРШЕНО!');
            
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

async function testParserV5() {
    const tester = new ParserV5Tester();
    
    try {
        await tester.init();
        await tester.runTest();
    } catch (error) {
        console.error('❌ Критическая ошибка:', error);
    } finally {
        await tester.close();
    }
}

testParserV5();

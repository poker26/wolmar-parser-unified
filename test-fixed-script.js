/**
 * Тестовый скрипт для проверки исправленного оптимизированного обновления
 * Тестируем на аукционе 961 (внутренний номер 2117)
 */

const { Client } = require('pg');
const puppeteer = require('puppeteer-core');
const config = require('./config');

class TestFixedUpdater {
    constructor() {
        this.dbConfig = config.dbConfig;
        this.dbClient = new Client(this.dbConfig);
        this.browser = null;
        this.page = null;
        
        this.stats = {
            processed: 0,
            updated: 0,
            skipped: 0,
            errors: 0
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
                args: ['--no-sandbox', '--disable-setuid-sandbox']
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

    async testSpecificLot() {
        console.log('\n🧪 ТЕСТИРУЕМ КОНКРЕТНЫЙ ЛОТ 7478027:');
        
        // Проверяем текущее состояние в базе
        const currentState = await this.dbClient.query(`
            SELECT id, lot_number, auction_number, condition, source_url
            FROM auction_lots 
            WHERE source_url LIKE '%7478027%';
        `);
        
        if (currentState.rows.length > 0) {
            const lot = currentState.rows[0];
            console.log(`📋 Текущее состояние в базе:`);
            console.log(`  Лот ${lot.lot_number} (Аукцион ${lot.auction_number})`);
            console.log(`  Состояние: "${lot.condition}"`);
            console.log(`  URL: ${lot.source_url}`);
            
            // Парсим страницу лота
            console.log(`\n🔍 Парсим страницу лота: ${lot.source_url}`);
            await this.page.goto(lot.source_url, { waitUntil: 'networkidle2', timeout: 30000 });
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            const pageData = await this.page.evaluate(() => {
                const pageText = document.body.textContent || '';
                const conditionMatch = pageText.match(/Сохранность:\s*([^\n\r]+)/i);
                return conditionMatch ? conditionMatch[1].trim() : null;
            });
            
            if (pageData) {
                const newCondition = this.extractConditionWithGrade(pageData);
                console.log(`📊 Состояние на сайте: "${pageData}" -> "${newCondition}"`);
                
                if (lot.condition !== newCondition) {
                    console.log(`✅ НУЖНО ОБНОВИТЬ: "${lot.condition}" -> "${newCondition}"`);
                    
                    // Обновляем
                    await this.dbClient.query(`
                        UPDATE auction_lots 
                        SET condition = $1 
                        WHERE id = $2;
                    `, [newCondition, lot.id]);
                    
                    console.log(`🎉 Лот обновлен!`);
                    this.stats.updated++;
                } else {
                    console.log(`⏭️ Без изменений`);
                    this.stats.skipped++;
                }
            } else {
                console.log(`❌ Не удалось извлечь состояние с страницы`);
                this.stats.errors++;
            }
        } else {
            console.log(`❌ Лот 7478027 не найден в базе данных`);
        }
        
        this.stats.processed++;
    }

    async testAuctionPage() {
        console.log('\n🧪 ТЕСТИРУЕМ ПАРСИНГ ОБЩЕЙ СТРАНИЦЫ АУКЦИОНА 2117:');
        
        const auctionUrl = 'https://www.wolmar.ru/auction/2117';
        console.log(`📄 Переходим на: ${auctionUrl}`);
        
        await this.page.goto(auctionUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const lotsData = await this.page.evaluate(() => {
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
        
        // Ищем лот 7478027 в результатах
        const targetLot = lotsData.find(lot => lot.lotNumber === '7478027');
        if (targetLot) {
            console.log(`🎯 Найден целевой лот:`);
            console.log(`  Номер: ${targetLot.lotNumber}`);
            console.log(`  Состояние: "${targetLot.condition}"`);
            console.log(`  URL: ${targetLot.lotUrl}`);
        } else {
            console.log(`❌ Лот 7478027 не найден в результатах парсинга`);
        }
        
        // Показываем первые 5 лотов
        console.log(`\n📋 Первые 5 лотов:`);
        lotsData.slice(0, 5).forEach((lot, index) => {
            console.log(`  ${index + 1}. Лот ${lot.lotNumber}: "${lot.condition}"`);
        });
    }

    async run() {
        try {
            await this.init();
            
            console.log('🧪 ТЕСТИРОВАНИЕ ИСПРАВЛЕННОГО СКРИПТА');
            console.log('📋 Тестируем на аукционе 961 (внутренний номер 2117)');
            
            // Тестируем конкретный лот
            await this.testSpecificLot();
            
            // Тестируем парсинг общей страницы
            await this.testAuctionPage();
            
            console.log('\n🎉 ТЕСТИРОВАНИЕ ЗАВЕРШЕНО!');
            console.log(`📊 Обработано: ${this.stats.processed}`);
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
        if (this.browser) {
            await this.browser.close();
        }
        if (this.dbClient) {
            await this.dbClient.end();
        }
        console.log('🧹 Ресурсы освобождены');
    }
}

async function main() {
    const tester = new TestFixedUpdater();
    await tester.run();
}

main();

/**
 * Тестовый скрипт для проверки оптимизированного обновления
 * Обрабатывает только первые 3 аукциона для тестирования
 */

const { Client } = require('pg');
const puppeteer = require('puppeteer-core');
const config = require('./config');

class TestOptimizedUpdater {
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
            auctionsProcessed: 0
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

    async getTestAuctions() {
        console.log('📊 Получаем тестовые аукционы...');
        
        const query = `
            SELECT DISTINCT 
                SUBSTRING(source_url FROM '/auction/([^/]+)/') as internal_auction_number,
                auction_number
            FROM auction_lots 
            WHERE source_url IS NOT NULL
            ORDER BY auction_number DESC
            LIMIT 3;
        `;
        
        const result = await this.dbClient.query(query);
        console.log(`📋 Найдено ${result.rows.length} тестовых аукционов`);
        
        return result.rows;
    }

    async parseAuctionPage(internalAuctionNumber) {
        const auctionUrl = `https://www.wolmar.ru/auction/${internalAuctionNumber}`;
        console.log(`\n🔍 Парсим аукцион ${internalAuctionNumber}: ${auctionUrl}`);
        
        try {
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
            return lotsData;
            
        } catch (error) {
            console.error(`❌ Ошибка парсинга аукциона ${internalAuctionNumber}:`, error.message);
            return [];
        }
    }

    async updateLotsFromAuctionData(lotsData) {
        let auctionUpdated = 0;
        let auctionSkipped = 0;
        
        // Ограничиваем количество лотов для тестирования
        const testLots = lotsData.slice(0, 10);
        
        for (const lot of testLots) {
            try {
                const newCondition = this.extractConditionWithGrade(lot.condition);
                
                const findQuery = `
                    SELECT id, lot_number, condition 
                    FROM auction_lots 
                    WHERE source_url = $1;
                `;
                const findResult = await this.dbClient.query(findQuery, [lot.lotUrl]);
                
                if (findResult.rows.length > 0) {
                    const lotRecord = findResult.rows[0];
                    const oldCondition = lotRecord.condition;
                    
                    if (oldCondition !== newCondition) {
                        const updateQuery = `
                            UPDATE auction_lots 
                            SET condition = $1 
                            WHERE id = $2;
                        `;
                        await this.dbClient.query(updateQuery, [newCondition, lotRecord.id]);
                        console.log(`✅ Лот ${lotRecord.lot_number}: "${oldCondition}" -> "${newCondition}"`);
                        auctionUpdated++;
                        this.stats.updated++;
                    } else {
                        console.log(`⏭️ Лот ${lotRecord.lot_number}: Без изменений ("${oldCondition}")`);
                        auctionSkipped++;
                        this.stats.skipped++;
                    }
                } else {
                    console.log(`⚠️ Лот ${lot.lotNumber}: Не найден в базе данных`);
                    auctionSkipped++;
                    this.stats.skipped++;
                }
                
                this.stats.processed++;
                
            } catch (error) {
                console.error(`❌ Ошибка обновления лота ${lot.lotNumber}:`, error.message);
                this.stats.errors++;
            }
        }
        
        console.log(`\n📊 Результат аукциона: Обновлено ${auctionUpdated}, Пропущено ${auctionSkipped}`);
        return { updated: auctionUpdated, skipped: auctionSkipped };
    }

    async processAuction(internalAuctionNumber, auctionNumber) {
        console.log(`\n🏆 Обрабатываем аукцион ${auctionNumber} (внутренний номер: ${internalAuctionNumber})`);
        
        const lotsData = await this.parseAuctionPage(internalAuctionNumber);
        
        if (lotsData.length === 0) {
            console.log('⚠️ Не удалось получить данные с общей страницы');
            return;
        }
        
        const result = await this.updateLotsFromAuctionData(lotsData);
        
        this.stats.auctionsProcessed++;
        
        return result;
    }

    async run() {
        try {
            await this.init();
            
            console.log('🧪 ТЕСТИРОВАНИЕ ОПТИМИЗИРОВАННОГО ОБНОВЛЕНИЯ');
            console.log('📋 Обрабатываем первые 3 аукциона, по 10 лотов каждый');
            
            const auctions = await this.getTestAuctions();
            
            if (auctions.length === 0) {
                console.log('❌ Аукционы для тестирования не найдены');
                return;
            }
            
            for (const auction of auctions) {
                try {
                    await this.processAuction(auction.internal_auction_number, auction.auction_number);
                    await new Promise(resolve => setTimeout(resolve, 1000));
                } catch (error) {
                    console.error(`❌ Ошибка обработки аукциона ${auction.auction_number}:`, error.message);
                    this.stats.errors++;
                }
            }
            
            console.log('\n🎉 ТЕСТИРОВАНИЕ ЗАВЕРШЕНО!');
            console.log(`📊 Обработано лотов: ${this.stats.processed}`);
            console.log(`✅ Обновлено: ${this.stats.updated}`);
            console.log(`⏭️ Пропущено: ${this.stats.skipped}`);
            console.log(`❌ Ошибок: ${this.stats.errors}`);
            console.log(`🏆 Аукционов обработано: ${this.stats.auctionsProcessed}`);
            
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
    const updater = new TestOptimizedUpdater();
    await updater.run();
}

main();

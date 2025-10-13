/**
 * Массовое обновление состояний для завершенных аукционов
 * Работает только с аукционами, которые уже полностью завершены
 */

const { Client } = require('pg');
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const config = require('./config');

class CompletedAuctionsUpdater {
    constructor() {
        this.dbConfig = config.dbConfig;
        this.dbClient = new Client(this.dbConfig);
        this.browser = null;
        this.page = null;
        
        // Статистика
        this.stats = {
            processed: 0,
            updated: 0,
            skipped: 0,
            errors: 0,
            auctionsProcessed: 0,
            pagesProcessed: 0,
            startTime: null
        };
        
        this.progressFile = 'completed_auctions_update_progress.json';
        this.loadProgress();
        
        // Список завершенных аукционов (исключаем активные 967, 965)
        this.completedAuctions = ['964', '963', '962', '961', '960', '959', '955', '789'];
    }

    async init() {
        try {
            await this.dbClient.connect();
            console.log('🔗 Подключение к базе данных установлено');
            
            await this.initBrowser();
            console.log('🌐 Браузер инициализирован');
            
            this.stats.startTime = new Date();
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
                            '--user-data-dir=/tmp/chrome-temp-bxyh3',
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

    loadProgress() {
        try {
            if (fs.existsSync(this.progressFile)) {
                const data = JSON.parse(fs.readFileSync(this.progressFile, 'utf8'));
                this.stats = { ...this.stats, ...data.stats };
                console.log(`📂 Загружен прогресс: ${this.stats.processed} лотов обработано`);
            }
        } catch (error) {
            console.log('⚠️ Не удалось загрузить прогресс, начинаем с начала');
        }
    }

    saveProgress() {
        try {
            const progressData = {
                stats: this.stats,
                completedAuctions: this.completedAuctions,
                timestamp: new Date().toISOString()
            };
            fs.writeFileSync(this.progressFile, JSON.stringify(progressData, null, 2));
        } catch (error) {
            console.error('❌ Ошибка сохранения прогресса:', error.message);
        }
    }

    printStats() {
        const elapsed = Math.floor((new Date() - this.stats.startTime) / 1000);
        const rate = this.stats.processed > 0 ? (this.stats.processed / elapsed * 60).toFixed(1) : 0;
        
        console.log(`\n📊 Прогресс: ${this.stats.processed} лотов | Обновлено: ${this.stats.updated} | Ошибок: ${this.stats.errors} | Пропущено: ${this.stats.skipped} | Скорость: ${rate} лотов/мин`);
        console.log(`🏆 Аукционов: ${this.stats.auctionsProcessed}/${this.completedAuctions.length} | Страниц: ${this.stats.pagesProcessed}`);
    }

    // Функция для извлечения состояния с градацией
    extractConditionWithGrade(conditionText) {
        if (!conditionText) return null;
        return conditionText.replace(/\s+/g, '');
    }

    // Получаем список завершенных аукционов
    async getCompletedAuctionsToProcess() {
        console.log('📊 Получаем список завершенных аукционов для обработки...');
        
        const auctions = [];
        
        for (const auctionNumber of this.completedAuctions) {
            // Получаем внутренний номер wolmar для этого аукциона
            const query = `
                SELECT DISTINCT 
                    SUBSTRING(source_url FROM '/auction/([^/]+)/') as internal_auction_number,
                    COUNT(*) as lots_count
                FROM auction_lots 
                WHERE auction_number = $1 AND source_url IS NOT NULL
                GROUP BY internal_auction_number
                LIMIT 1;
            `;
            
            const result = await this.dbClient.query(query, [auctionNumber]);
            
            if (result.rows.length > 0) {
                const row = result.rows[0];
                auctions.push({
                    auctionNumber: auctionNumber,
                    internalAuctionNumber: row.internal_auction_number,
                    lotsCount: row.lots_count
                });
                console.log(`  Аукцион ${auctionNumber} (внутренний ${row.internal_auction_number}): ${row.lots_count} лотов`);
            } else {
                console.log(`  ⚠️ Аукцион ${auctionNumber}: не найден в базе данных`);
            }
        }
        
        console.log(`📋 Найдено ${auctions.length} завершенных аукционов для обработки`);
        return auctions;
    }

    // Парсим одну страницу аукциона
    async parseAuctionPage(internalAuctionNumber, pageNum = 1) {
        const auctionUrl = pageNum === 1 
            ? `https://www.wolmar.ru/auction/${internalAuctionNumber}`
            : `https://www.wolmar.ru/auction/${internalAuctionNumber}?page=${pageNum}`;
        
        try {
            await this.page.goto(auctionUrl, { waitUntil: 'networkidle2', timeout: 30000 });
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Извлекаем данные о лотах с состояниями из таблицы
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
            
            return lotsData;
            
        } catch (error) {
            console.error(`❌ Ошибка парсинга страницы ${pageNum} аукциона ${internalAuctionNumber}:`, error.message);
            return [];
        }
    }

    // Обновляем лоты из данных аукциона
    async updateLotsFromAuctionData(lotsData) {
        let auctionUpdated = 0;
        let auctionSkipped = 0;
        
        for (const lot of lotsData) {
            try {
                const newCondition = this.extractConditionWithGrade(lot.condition);
                
                // Ищем лот в базе по URL
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
                        // Обновляем состояние
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
                
                // Сохраняем прогресс каждые 50 лотов
                if (this.stats.processed % 50 === 0) {
                    this.saveProgress();
                    this.printStats();
                }
                
            } catch (error) {
                console.error(`❌ Ошибка обновления лота ${lot.lotNumber}:`, error.message);
                this.stats.errors++;
            }
        }
        
        console.log(`\n📊 Результат аукциона: Обновлено ${auctionUpdated}, Пропущено ${auctionSkipped}`);
        return { updated: auctionUpdated, skipped: auctionSkipped };
    }

    // Обрабатываем один завершенный аукцион
    async processCompletedAuction(auctionNumber, internalAuctionNumber) {
        console.log(`\n🏆 Обрабатываем завершенный аукцион ${auctionNumber} (внутренний номер: ${internalAuctionNumber})`);
        
        // Парсим только первую страницу для завершенных аукционов
        const lotsData = await this.parseAuctionPage(internalAuctionNumber, 1);
        this.stats.pagesProcessed++;
        
        if (lotsData.length === 0) {
            console.log('⚠️ Не удалось получить данные с аукциона');
            return;
        }
        
        console.log(`📊 Найдено ${lotsData.length} лотов с состояниями`);
        
        // Обновляем лоты
        const result = await this.updateLotsFromAuctionData(lotsData);
        
        this.stats.auctionsProcessed++;
        this.saveProgress();
        
        return result;
    }

    // Основной метод запуска
    async run() {
        try {
            await this.init();
            
            console.log('🚀 Запуск массового обновления состояний для завершенных аукционов');
            console.log('📋 Стратегия: Парсинг завершенных аукционов + связь по URL');
            console.log(`📋 Завершенные аукционы: ${this.completedAuctions.join(', ')}`);
            
            // Получаем список завершенных аукционов
            const auctions = await this.getCompletedAuctionsToProcess();
            
            if (auctions.length === 0) {
                console.log('❌ Завершенные аукционы для обработки не найдены');
                return;
            }
            
            // Обрабатываем каждый завершенный аукцион
            for (const auction of auctions) {
                try {
                    await this.processCompletedAuction(auction.auctionNumber, auction.internalAuctionNumber);
                    
                    // Небольшая пауза между аукционами
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    
                } catch (error) {
                    console.error(`❌ Ошибка обработки аукциона ${auction.auctionNumber}:`, error.message);
                    this.stats.errors++;
                }
            }
            
            // Финальная статистика
            console.log('\n🎉 ОБНОВЛЕНИЕ ЗАВЕРШЕНО!');
            this.printStats();
            
            const totalTime = Math.floor((new Date() - this.stats.startTime) / 1000);
            console.log(`⏱️ Общее время: ${Math.floor(totalTime / 60)}м ${totalTime % 60}с`);
            
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

// Обработка сигналов прерывания
process.on('SIGINT', () => {
    console.log('\n⚠️ Получен сигнал прерывания. Сохраняем прогресс...');
    process.exit(0);
});

// Запуск скрипта
async function main() {
    const updater = new CompletedAuctionsUpdater();
    await updater.run();
}

main();

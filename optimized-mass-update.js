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

class OptimizedMassUpdater {
    constructor() {
        this.dbClient = new Client(dbConfig);
        this.browser = null;
        this.page = null;
        this.updated = 0;
        this.errors = 0;
        this.skipped = 0;
        this.processed = 0;
        this.progressFile = 'optimized_update_progress.json';
        this.startTime = Date.now();
    }

    async init() {
        await this.dbClient.connect();
        console.log('✅ Подключение к базе данных успешно');
        
        this.browser = await puppeteer.launch({
            headless: true,
            executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });
        
        this.page = await this.browser.newPage();
        await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        this.page.setDefaultTimeout(30000);
        this.page.setDefaultNavigationTimeout(30000);
        
        console.log('✅ Браузер инициализирован');
        this.loadProgress();
    }

    loadProgress() {
        try {
            if (fs.existsSync(this.progressFile)) {
                const progress = JSON.parse(fs.readFileSync(this.progressFile, 'utf8'));
                this.updated = progress.updated || 0;
                this.errors = progress.errors || 0;
                this.skipped = progress.skipped || 0;
                this.processed = progress.processed || 0;
                console.log(`📊 Загружен прогресс: обновлено ${this.updated}, ошибок ${this.errors}, пропущено ${this.skipped}`);
            }
        } catch (error) {
            console.log('⚠️ Не удалось загрузить прогресс, начинаем с нуля');
        }
    }

    saveProgress() {
        try {
            const progress = {
                updated: this.updated,
                errors: this.errors,
                skipped: this.skipped,
                processed: this.processed,
                timestamp: new Date().toISOString()
            };
            fs.writeFileSync(this.progressFile, JSON.stringify(progress, null, 2));
        } catch (error) {
            console.error('❌ Ошибка при сохранении прогресса:', error.message);
        }
    }

    // Функция для извлечения состояния с градацией
    extractConditionWithGrade(conditionText) {
        if (!conditionText) return null;
        return conditionText.replace(/\s+/g, '');
    }

    // Получение всех аукционов из базы данных
    async getAllAuctions() {
        console.log('📊 Получаем список всех аукционов...');
        
        const query = `
            SELECT DISTINCT auction_number 
            FROM auction_lots 
            WHERE source_url IS NOT NULL
            ORDER BY auction_number DESC;
        `;
        
        const result = await this.dbClient.query(query);
        console.log(`📋 Найдено ${result.rows.length} аукционов`);
        
        return result.rows.map(row => row.auction_number);
    }

    // Парсинг общих страниц аукциона для извлечения состояний
    async parseAuctionPageForConditions(auctionNumber) {
        try {
            const auctionUrl = `https://www.wolmar.ru/auction/${auctionNumber}`;
            console.log(`🔍 Парсим общую страницу аукциона ${auctionNumber}...`);
            
            await this.page.goto(auctionUrl, { waitUntil: 'networkidle2', timeout: 30000 });
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Извлекаем данные о лотах и их состояниях с общей страницы
            const lotsData = await this.page.evaluate(() => {
                const lots = [];
                
                // Ищем все строки таблицы с лотами
                const lotRows = document.querySelectorAll('tr[data-lot-id], .lot-row, tr:has(.title.lot)');
                
                lotRows.forEach(row => {
                    try {
                        const lot = {};
                        
                        // Ищем ссылку на лот
                        const lotLink = row.querySelector('a.title.lot[href*="/auction/"]');
                        if (lotLink && lotLink.href) {
                            lot.url = lotLink.href;
                            
                            // Извлекаем номер лота из ссылки
                            const urlMatch = lotLink.href.match(/\/auction\/\d+\/(\d+)/);
                            if (urlMatch) {
                                lot.lotNumber = urlMatch[1];
                            }
                            
                            // Ищем состояние в той же строке
                            const conditionCell = row.querySelector('td:contains("MS"), td:contains("AU"), td:contains("XF"), td:contains("VF"), td:contains("UNC")');
                            if (conditionCell) {
                                lot.condition = conditionCell.textContent.trim();
                            } else {
                                // Альтернативный поиск - ищем в тексте строки
                                const rowText = row.textContent;
                                const conditionMatch = rowText.match(/(MS|AU|XF|VF|UNC|PL)[\s\d\-\+\/]*/i);
                                if (conditionMatch) {
                                    lot.condition = conditionMatch[0].trim();
                                }
                            }
                            
                            if (lot.url && lot.lotNumber && lot.condition) {
                                lots.push(lot);
                            }
                        }
                    } catch (error) {
                        console.error('Ошибка при парсинге строки лота:', error);
                    }
                });
                
                return lots;
            });
            
            console.log(`✅ Извлечено ${lotsData.length} лотов с состояниями с общей страницы`);
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
                        this.updated++;
                    } else {
                        console.log(`⏭️ Лот ${lotData.lotNumber}: без изменений ("${currentCondition}")`);
                        auctionSkipped++;
                        this.skipped++;
                    }
                } else {
                    console.log(`⚠️ Лот ${lotData.lotNumber} не найден в базе данных`);
                    auctionErrors++;
                    this.errors++;
                }
                
                this.processed++;
                
            } catch (error) {
                console.error(`❌ Ошибка при обновлении лота ${lotData.lotNumber}:`, error.message);
                auctionErrors++;
                this.errors++;
                this.processed++;
            }
        }
        
        console.log(`📊 Аукцион ${auctionNumber}: обновлено ${auctionUpdated}, пропущено ${auctionSkipped}, ошибок ${auctionErrors}`);
        return { updated: auctionUpdated, skipped: auctionSkipped, errors: auctionErrors };
    }

    // Основной метод массового обновления
    async massUpdateFromAuctionPages() {
        try {
            const auctions = await this.getAllAuctions();
            
            if (auctions.length === 0) {
                console.log('❌ Нет аукционов для обновления');
                return;
            }
            
            console.log(`\n🚀 Начинаем оптимизированное массовое обновление для ${auctions.length} аукционов...`);
            console.log('⏰ Время начала:', new Date().toLocaleString());
            
            for (let i = 0; i < auctions.length; i++) {
                const auctionNumber = auctions[i];
                
                console.log(`\n📋 [${i + 1}/${auctions.length}] Обрабатываем аукцион ${auctionNumber}...`);
                
                // Парсим общую страницу аукциона
                const lotsData = await this.parseAuctionPageForConditions(auctionNumber);
                
                if (lotsData.length > 0) {
                    // Обновляем состояния лотов
                    await this.updateLotsFromAuctionPage(auctionNumber, lotsData);
                } else {
                    console.log(`⚠️ Не удалось извлечь данные с общей страницы аукциона ${auctionNumber}`);
                }
                
                // Сохраняем прогресс каждые 5 аукционов
                if ((i + 1) % 5 === 0) {
                    this.saveProgress();
                    this.printStats();
                }
                
                // Пауза между аукционами
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
            
            console.log('\n🎉 ОПТИМИЗИРОВАННОЕ МАССОВОЕ ОБНОВЛЕНИЕ ЗАВЕРШЕНО!');
            this.printFinalStats();
            
        } catch (error) {
            console.error('❌ Ошибка при массовом обновлении:', error.message);
        }
    }

    printStats() {
        const elapsed = Math.round((Date.now() - this.startTime) / 1000);
        const rate = this.processed > 0 ? (this.processed / elapsed * 60).toFixed(1) : 0;
        
        console.log(`\n📊 Прогресс: ${this.processed} лотов | Обновлено: ${this.updated} | Ошибок: ${this.errors} | Пропущено: ${this.skipped} | Скорость: ${rate} лотов/мин`);
    }

    printFinalStats() {
        const elapsed = Math.round((Date.now() - this.startTime) / 1000);
        const hours = Math.floor(elapsed / 3600);
        const minutes = Math.floor((elapsed % 3600) / 60);
        const seconds = elapsed % 60;
        
        console.log('\n📊 ФИНАЛЬНАЯ СТАТИСТИКА:');
        console.log('='.repeat(50));
        console.log(`✅ Обновлено лотов: ${this.updated}`);
        console.log(`⏭️ Без изменений: ${this.skipped}`);
        console.log(`❌ Ошибок: ${this.errors}`);
        console.log(`📊 Всего обработано: ${this.processed}`);
        console.log(`⏰ Время выполнения: ${hours}ч ${minutes}м ${seconds}с`);
        
        if (this.processed > 0) {
            const rate = (this.processed / elapsed * 60).toFixed(1);
            console.log(`🚀 Средняя скорость: ${rate} лотов/мин`);
        }
        
        // Удаляем файл прогресса
        try {
            if (fs.existsSync(this.progressFile)) {
                fs.unlinkSync(this.progressFile);
                console.log('🗑️ Файл прогресса удален');
            }
        } catch (error) {
            console.log('⚠️ Не удалось удалить файл прогресса');
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

async function optimizedMassUpdate() {
    const updater = new OptimizedMassUpdater();
    
    try {
        await updater.init();
        await updater.massUpdateFromAuctionPages();
    } catch (error) {
        console.error('❌ Критическая ошибка:', error);
    } finally {
        await updater.close();
    }
}

// Обработка сигналов для корректного завершения
process.on('SIGINT', async () => {
    console.log('\n⚠️ Получен сигнал прерывания. Сохраняем прогресс...');
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n⚠️ Получен сигнал завершения. Сохраняем прогресс...');
    process.exit(0);
});

optimizedMassUpdate();

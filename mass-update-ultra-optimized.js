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

class UltraOptimizedUpdater {
    constructor() {
        this.dbClient = new Client(dbConfig);
        this.browser = null;
        this.page = null;
        this.updated = 0;
        this.errors = 0;
        this.skipped = 0;
        this.processed = 0;
        this.progressFile = 'ultra_optimized_progress.json';
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

    // Получение лотов для обновления (только критичные состояния)
    async getLotsToUpdate() {
        console.log('📊 Получаем список лотов с критичными состояниями для обновления...');
        
        // Обновляем только лоты с критичными состояниями: MS, PF, UNC, PL, PR, F, Proof, Gem, XX
        // Исключаем VF, XF, AU - для них градации менее важны
        const query = `
            SELECT id, lot_number, auction_number, condition, source_url
            FROM auction_lots 
            WHERE source_url IS NOT NULL 
            AND condition IN ('MS', 'PF', 'UNC', 'PL', 'PR', 'F', 'Proof', 'Gem', 'XX')
            ORDER BY auction_number DESC, lot_number;
        `;
        
        const result = await this.dbClient.query(query);
        console.log(`📋 Найдено ${result.rows.length} лотов с критичными состояниями для обновления`);
        
        return result.rows;
    }

    // Обновление лота с автоматическим восстановлением
    async updateLotFromUrl(lotId, sourceUrl, lotNumber, auctionNumber) {
        console.log(`\n🔍 [${this.processed + 1}] Обновляем лот ${lotNumber} (Аукцион ${auctionNumber}) ID ${lotId}...`);
        
        let attempts = 0;
        const maxAttempts = 3;
        
        while (attempts < maxAttempts) {
            try {
                await this.page.goto(sourceUrl, { waitUntil: 'networkidle2', timeout: 30000 });
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
                    
                    return data;
                });
                
                if (lotData.condition) {
                    const newCondition = this.extractConditionWithGrade(lotData.condition);
                    
                    // Получаем текущее состояние из базы
                    const currentQuery = `
                        SELECT condition FROM auction_lots WHERE id = $1;
                    `;
                    const currentResult = await this.dbClient.query(currentQuery, [lotId]);
                    
                    if (currentResult.rows.length > 0) {
                        const oldCondition = currentResult.rows[0].condition;
                        if (oldCondition !== newCondition) {
                            const updateQuery = `
                                UPDATE auction_lots SET condition = $1 WHERE id = $2;
                            `;
                            await this.dbClient.query(updateQuery, [newCondition, lotId]);
                            console.log(`✅ Обновлено: "${oldCondition}" -> "${newCondition}"`);
                            this.updated++;
                        } else {
                            console.log(`⏭️ Без изменений: "${oldCondition}"`);
                            this.skipped++;
                        }
                    } else {
                        console.log(`⚠️ Лот ${lotId} не найден в базе данных.`);
                        this.skipped++;
                    }
                } else {
                    console.log(`⏭️ Состояние не найдено на странице для лота ${lotId}.`);
                    this.skipped++;
                }
                
                this.processed++;
                return true; // Успешно обработан
                
            } catch (error) {
                attempts++;
                console.log(`❌ Попытка ${attempts}/${maxAttempts} не удалась: ${error.message}`);
                
                if (error.message.includes('detached') || error.message.includes('Frame')) {
                    console.log('🔄 Пересоздаем браузер...');
                    await this.recreateBrowser();
                } else if (error.message.includes('Connection terminated') || error.message.includes('ECONNRESET')) {
                    console.log('🔄 Переподключаемся к базе данных...');
                    await this.reconnectDatabase();
                }
                
                if (attempts < maxAttempts) {
                    console.log(`⏳ Ждем 3 секунды перед повторной попыткой...`);
                    await new Promise(resolve => setTimeout(resolve, 3000));
                } else {
                    console.log(`❌ Все попытки исчерпаны для лота ${lotId}`);
                    this.errors++;
                    this.processed++;
                    return false;
                }
            }
        }
    }

    // Пересоздание браузера
    async recreateBrowser() {
        try {
            if (this.page && !this.page.isClosed()) {
                await this.page.close();
            }
            if (this.browser) {
                await this.browser.close();
            }
            
            this.browser = await puppeteer.launch({
                headless: true,
                executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
            });
            
            this.page = await this.browser.newPage();
            await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
            this.page.setDefaultTimeout(30000);
            this.page.setDefaultNavigationTimeout(30000);
            
            console.log('✅ Браузер пересоздан');
        } catch (error) {
            console.error('❌ Ошибка при пересоздании браузера:', error.message);
        }
    }

    // Переподключение к базе данных
    async reconnectDatabase() {
        try {
            await this.dbClient.end();
            this.dbClient = new Client(dbConfig);
            await this.dbClient.connect();
            console.log('✅ Переподключение к базе данных успешно');
        } catch (error) {
            console.error('❌ Ошибка при переподключении к БД:', error.message);
        }
    }

    // Основной метод массового обновления
    async massUpdateUltraOptimized() {
        try {
            const lotsToUpdate = await this.getLotsToUpdate();
            
            if (lotsToUpdate.length === 0) {
                console.log('❌ Нет лотов для обновления');
                return;
            }
            
            console.log(`\n🚀 Начинаем УЛЬТРА-ОПТИМИЗИРОВАННОЕ обновление ${lotsToUpdate.length} лотов...`);
            console.log('⏰ Время начала:', new Date().toLocaleString());
            console.log('🎯 Стратегия: Обновляем только критичные состояния (MS, PF, UNC, PL, PR, F, Proof, Gem, XX)');
            console.log('⏭️ Пропускаем: VF, XF, AU - для них градации менее важны');
            
            for (let i = 0; i < lotsToUpdate.length; i++) {
                const lot = lotsToUpdate[i];
                
                try {
                    await this.updateLotFromUrl(lot.id, lot.source_url, lot.lot_number, lot.auction_number);
                    
                    // Сохраняем прогресс каждые 10 лотов
                    if ((i + 1) % 10 === 0) {
                        this.saveProgress();
                        this.printStats();
                    }
                    
                    // Профилактическое переподключение к БД каждые 50 лотов
                    if ((i + 1) % 50 === 0) {
                        console.log('🔄 Профилактическое переподключение к базе данных...');
                        await this.reconnectDatabase();
                        console.log('✅ Переподключение успешно');
                    }
                    
                    // Пауза между лотами
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    
                } catch (error) {
                    console.error(`❌ Критическая ошибка при обработке лота ${lot.id}:`, error.message);
                    this.errors++;
                    this.processed++;
                }
            }
            
            console.log('\n🎉 УЛЬТРА-ОПТИМИЗИРОВАННОЕ ОБНОВЛЕНИЕ ЗАВЕРШЕНО!');
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

async function massUpdateUltraOptimized() {
    const updater = new UltraOptimizedUpdater();
    
    try {
        await updater.init();
        await updater.massUpdateUltraOptimized();
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

massUpdateUltraOptimized();

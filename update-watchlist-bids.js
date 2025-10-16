const { Pool } = require('pg');
const { launchPuppeteer, createPage, cleanupChromeTempFiles } = require('./puppeteer-utils');
const config = require('./config');

class WatchlistBidUpdater {
    constructor() {
        this.pool = new Pool(config.dbConfig);
        this.browser = null;
        this.page = null;
    }

    async init() {
        console.log('🚀 Запускаем браузер для обновления ставок...');
        this.browser = await launchPuppeteer();
        this.page = await createPage(this.browser);
        
        await this.page.setViewport({ width: 1280, height: 720 });
        console.log('✅ Браузер инициализирован');
    }

    async close() {
        if (this.browser) {
            await this.browser.close();
            console.log('🔒 Браузер закрыт');
        }
        cleanupChromeTempFiles();
    }

    formatTimestamp(timestampText) {
        try {
            // Парсим дату в формате DD.MM.YYYY HH:MM:SS
            const match = timestampText.match(/(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
            if (match) {
                const [, day, month, year, hour, minute, second] = match;
                return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
            }
            
            // Если формат не распознан, возвращаем как есть
            console.log(`⚠️ Неизвестный формат даты: ${timestampText}`);
            return timestampText;
        } catch (error) {
            console.log(`❌ Ошибка форматирования даты: ${error.message}`);
            return timestampText;
        }
    }

    async parseBidHistory(page, lotUrl) {
        try {
            console.log(`🔍 Парсим историю ставок для лота: ${lotUrl}`);
            
            // Извлекаем auction_id и lot_id из URL
            const urlParts = lotUrl.match(/\/auction\/(\d+)\/(\d+)/);
            if (!urlParts) {
                console.log('❌ Не удалось извлечь auction_id и lot_id из URL');
                return [];
            }
            
            const [, auctionId, lotId] = urlParts;
            const ajaxUrl = `https://www.wolmar.ru/ajax/bids.php?auction_id=${auctionId}&lot_id=${lotId}`;
            
            console.log(`📡 AJAX URL: ${ajaxUrl}`);
            
            // Переходим на AJAX endpoint
            await page.goto(ajaxUrl, {
                waitUntil: 'networkidle2',
                timeout: 30000
            });
            
            // Парсим HTML таблицу со ставками
            const bidData = await page.evaluate(() => {
                const table = document.querySelector('table.colored');
                if (!table) {
                    return [];
                }
                
                const rows = table.querySelectorAll('tr');
                const bids = [];
                
                for (let i = 1; i < rows.length; i++) { // Пропускаем заголовок
                    const cells = rows[i].querySelectorAll('td');
                    if (cells.length >= 4) {
                        const amountText = cells[0]?.textContent?.trim();
                        const starText = cells[1]?.textContent?.trim();
                        const bidderText = cells[2]?.textContent?.trim();
                        const timestampText = cells[3]?.textContent?.trim();
                        
                        if (amountText && bidderText && timestampText) {
                            bids.push({
                                amount: amountText,
                                star: starText,
                                bidder: bidderText,
                                timestamp: timestampText
                            });
                        }
                    }
                }
                
                return bids;
            });
            
            console.log(`📊 Найдено ${bidData.length} ставок`);
            
            // Форматируем данные для сохранения в БД
            const formattedBids = bidData.map(bid => ({
                amount: parseInt(bid.amount.replace(/\s/g, '')), // Убираем пробелы и конвертируем в число
                bidder: bid.bidder,
                timestamp: this.formatTimestamp(bid.timestamp),
                isAutoBid: bid.star === '*'
            }));
            
            console.log(`✅ Отформатировано ${formattedBids.length} ставок`);
            return formattedBids;
            
        } catch (error) {
            console.error(`❌ Ошибка парсинга истории ставок для ${lotUrl}:`, error.message);
            return [];
        }
    }

    async saveBidsToDatabase(bidHistory, lotId, auctionNumber, lotNumber) {
        if (!bidHistory || bidHistory.length === 0) {
            return;
        }
        
        try {
            console.log(`💾 Сохраняем ${bidHistory.length} ставок в БД...`);
            
            for (const bid of bidHistory) {
                const insertQuery = `
                    INSERT INTO lot_bids (
                        lot_id, auction_number, lot_number, bid_amount, bidder_login, bid_timestamp, is_auto_bid
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                    ON CONFLICT (auction_number, lot_number, bid_amount, bidder_login, bid_timestamp) DO NOTHING
                `;
                
                const values = [
                    lotId,
                    auctionNumber,
                    lotNumber,
                    bid.amount,
                    bid.bidder,
                    bid.timestamp,
                    bid.isAutoBid
                ];
                
                await this.pool.query(insertQuery, values);
            }
            
            console.log(`✅ Сохранено ${bidHistory.length} ставок`);
            
        } catch (error) {
            console.error('❌ Ошибка сохранения ставок в БД:', error.message);
        }
    }

    async updateWatchlistBids(userId = null) {
        try {
            console.log('🔄 Начинаем обновление истории ставок для избранного...');
            console.log(`👤 Пользователь ID: ${userId || 'все пользователи'}`);
            
            // Получаем лоты из избранного
            let query = `
                SELECT 
                    w.id as watchlist_id,
                    w.user_id,
                    al.id as lot_id,
                    al.lot_number,
                    al.auction_number,
                    al.source_url
                FROM watchlist w
                JOIN auction_lots al ON w.lot_id = al.id
                WHERE al.source_url IS NOT NULL
            `;
            
            const params = [];
            if (userId) {
                query += ` AND w.user_id = $1`;
                params.push(userId);
            }
            
            query += ` ORDER BY w.added_at DESC`;
            
            const result = await this.pool.query(query, params);
            const watchlistLots = result.rows;
            
            console.log(`📊 Найдено ${watchlistLots.length} лотов в избранном для обновления`);
            
            if (watchlistLots.length === 0) {
                console.log('ℹ️ Нет лотов в избранном для обновления');
                return { updated: 0, errors: [] };
            }
            
            const results = {
                updated: 0,
                errors: []
            };
            
            // Обновляем ставки для каждого лота
            for (const lot of watchlistLots) {
                try {
                    console.log(`\n🎯 Обрабатываем лот ${lot.lot_number} (ID: ${lot.lot_id})`);
                    
                    // Парсим историю ставок
                    const bidHistory = await this.parseBidHistory(this.page, lot.source_url);
                    
                    if (bidHistory.length > 0) {
                        // Сохраняем в БД
                        await this.saveBidsToDatabase(
                            bidHistory,
                            lot.lot_id,
                            lot.auction_number,
                            lot.lot_number
                        );
                        
                        results.updated += bidHistory.length;
                        console.log(`✅ Обновлено ${bidHistory.length} ставок для лота ${lot.lot_number}`);
                    } else {
                        console.log(`ℹ️ История ставок для лота ${lot.lot_number} пуста или недоступна`);
                    }
                    
                    // Небольшая пауза между запросами
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    
                } catch (error) {
                    const errorMsg = `Ошибка обработки лота ${lot.lot_number}: ${error.message}`;
                    console.error(`❌ ${errorMsg}`);
                    results.errors.push(errorMsg);
                }
            }
            
            console.log(`\n🎉 Обновление завершено!`);
            console.log(`📊 Результаты:`);
            console.log(`   - Обновлено ставок: ${results.updated}`);
            console.log(`   - Ошибок: ${results.errors.length}`);
            
            if (results.errors.length > 0) {
                console.log(`❌ Ошибки:`);
                results.errors.forEach(error => console.log(`   - ${error}`));
            }
            
            return results;
            
        } catch (error) {
            console.error('❌ Критическая ошибка обновления избранного:', error.message);
            throw error;
        }
    }
}

// Основная функция
async function main() {
    const updater = new WatchlistBidUpdater();
    
    try {
        await updater.init();
        
        // Получаем аргументы командной строки
        const args = process.argv.slice(2);
        const userId = args[0] ? parseInt(args[0]) : null;
        
        if (userId) {
            console.log(`👤 Обновляем избранное для пользователя ${userId}`);
        } else {
            console.log('👥 Обновляем избранное для всех пользователей');
        }
        
        const results = await updater.updateWatchlistBids(userId);
        
        console.log('\n✅ Обновление завершено успешно!');
        console.log(`📊 Итого обновлено ставок: ${results.updated}`);
        
    } catch (error) {
        console.error('❌ Критическая ошибка:', error.message);
        process.exit(1);
    } finally {
        await updater.close();
    }
}

// Запускаем скрипт
if (require.main === module) {
    main().catch(console.error);
}

module.exports = WatchlistBidUpdater;

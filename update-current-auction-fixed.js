const { Pool } = require('pg');
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

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

const pool = new Pool(dbConfig);

// Функции для работы с прогрессом
function getProgressFilePath(auctionNumber) {
    return path.join(__dirname, `update_progress_${auctionNumber}.json`);
}

function saveProgress(auctionNumber, currentIndex, totalLots) {
    const progress = {
        auctionNumber,
        currentIndex,
        totalLots,
        lastUpdate: new Date().toISOString()
    };
    
    const filePath = getProgressFilePath(auctionNumber);
    fs.writeFileSync(filePath, JSON.stringify(progress, null, 2));
    console.log(`💾 Прогресс сохранен: ${currentIndex}/${totalLots}`);
}

function loadProgress(auctionNumber) {
    const filePath = getProgressFilePath(auctionNumber);
    
    if (!fs.existsSync(filePath)) {
        return null;
    }
    
    try {
        const data = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Ошибка загрузки прогресса:', error);
        return null;
    }
}

function clearProgress(auctionNumber) {
    const filePath = getProgressFilePath(auctionNumber);
    
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log('🗑️ Файл прогресса удален');
    }
}

// Функция для получения номера текущего аукциона
async function getCurrentAuctionNumber() {
    try {
        // Сначала ищем активные аукционы
        const activeResult = await pool.query(`
            SELECT auction_number
            FROM auction_lots
            WHERE auction_end_date > NOW()
            ORDER BY auction_end_date ASC
            LIMIT 1
        `);

        if (activeResult.rows.length > 0) {
            console.log(`🔄 Найден активный аукцион: ${activeResult.rows[0].auction_number}`);
            return activeResult.rows[0].auction_number;
        }

        // Если нет активных, берем последний завершенный
        const lastResult = await pool.query(`
            SELECT auction_number
            FROM auction_lots
            ORDER BY auction_number DESC
            LIMIT 1
        `);

        if (lastResult.rows.length > 0) {
            console.log(`📋 Используем последний аукцион: ${lastResult.rows[0].auction_number}`);
            return lastResult.rows[0].auction_number;
        }

        return null;
    } catch (error) {
        console.error('Ошибка получения текущего аукциона:', error);
        return null;
    }
}

// Функция для получения номера Wolmar по внутреннему номеру
async function getWolmarAuctionNumber(internalNumber) {
    try {
        // Сначала проверяем, есть ли такой аукцион в базе данных
        const result = await pool.query(`
            SELECT auction_number 
            FROM auction_lots 
            WHERE auction_number = $1 
            LIMIT 1
        `, [internalNumber]);
        
        if (result.rows.length > 0) {
            console.log(`✅ Найден аукцион ${internalNumber} в базе данных`);
            return internalNumber;
        }
        
        // Если не найден, ищем активный аукцион (самый последний)
        const activeResult = await pool.query(`
            SELECT auction_number 
            FROM auction_lots 
            WHERE auction_end_date > NOW()
            ORDER BY auction_end_date ASC
            LIMIT 1
        `);
        
        if (activeResult.rows.length > 0) {
            const activeAuction = activeResult.rows[0].auction_number;
            console.log(`🔄 Внутренний номер ${internalNumber} → Активный аукцион в БД: ${activeAuction}`);
            console.log(`📋 Парсим сайт Wolmar по номеру ${internalNumber}, обновляем БД по номеру ${activeAuction}`);
            return { wolmarNumber: internalNumber, dbNumber: activeAuction };
        }
        
        // Если нет активных аукционов, берем последний
        const lastResult = await pool.query(`
            SELECT auction_number 
            FROM auction_lots 
            ORDER BY auction_number DESC
            LIMIT 1
        `);
        
        if (lastResult.rows.length > 0) {
            const lastAuction = lastResult.rows[0].auction_number;
            console.log(`🔄 Внутренний номер ${internalNumber} → Последний аукцион в БД: ${lastAuction}`);
            console.log(`📋 Парсим сайт Wolmar по номеру ${internalNumber}, обновляем БД по номеру ${lastAuction}`);
            return { wolmarNumber: internalNumber, dbNumber: lastAuction };
        }
        
        return null;
        
    } catch (error) {
        console.error('Ошибка поиска аукциона по внутреннему номеру:', error);
        return null;
    }
}

// Функция для парсинга текущих ставок с адаптированной логикой
async function parseCurrentBidsFixed(wolmarNumber, dbNumber, startFromIndex = null) {
    console.log(`🔄 Обновление ставок: парсим Wolmar ${wolmarNumber}, обновляем БД ${dbNumber}...`);
    
    // Загружаем прогресс если не указан стартовый индекс
    let progress = null;
    if (startFromIndex === null) {
        progress = loadProgress(wolmarNumber);
        if (progress) {
            startFromIndex = progress.currentIndex;
            console.log(`📂 Возобновляем с позиции: ${startFromIndex}`);
        }
    }

    const { launchPuppeteer, createPage } = require('./puppeteer-utils');
    
    const browser = await launchPuppeteer();

    try {
        const page = await createPage(browser);
        
        // Получаем все URL лотов из базы данных
        console.log(`📋 Загружаем ссылки на лоты из базы данных...`);
        
        const lotUrls = await pool.query(`
            SELECT lot_url, url_index 
            FROM auction_lot_urls 
            WHERE auction_number = $1 
            ORDER BY url_index
        `, [wolmarNumber]);
        
        if (lotUrls.rows.length === 0) {
            console.log(`❌ Не найдено ссылок на лоты для аукциона ${wolmarNumber}`);
            return;
        }
        
        console.log(`📋 Найдено ${lotUrls.rows.length} ссылок на лоты`);
        
        // Парсим каждый лот отдельно с пакетной обработкой
        const lotsData = [];
        const batchSize = 100; // Обрабатываем по 100 лотов за раз
        const totalLots = lotUrls.rows.length;
        
        console.log(`📊 Всего лотов для обработки: ${totalLots}`);
        console.log(`📦 Размер пакета: ${batchSize} лотов`);
        
        // Начинаем с указанного индекса или с 0
        const startIndex = startFromIndex || 0;
        console.log(`🎯 Начинаем с индекса: ${startIndex}`);
        
        for (let i = startIndex; i < totalLots; i += batchSize) {
            const endIndex = Math.min(i + batchSize, totalLots);
            console.log(`\n🔄 Обрабатываем пакет ${Math.floor(i/batchSize) + 1}: лоты ${i + 1}-${endIndex}`);
            
            for (let j = i; j < endIndex; j++) {
                const lotUrl = lotUrls.rows[j].lot_url;
                console.log(`🔄 Парсим лот ${j + 1}/${totalLots}: ${lotUrl}`);
                
                try {
                    await page.goto(lotUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    
                    const lotData = await page.evaluate(() => {
                        const data = {};
                        
                        // Номер лота - из заголовка h5
                        const lotTitle = document.querySelector('h5');
                        if (lotTitle) {
                            const match = lotTitle.textContent.match(/Лот\s*№\s*(\d+)/i);
                            if (match) {
                                data.lotNumber = parseInt(match[1]);
                            }
                        }
                        
                        // Информация о торгах
                        const valuesDiv = document.querySelectorAll('.values')[1];
                        if (valuesDiv) {
                            const valuesText = valuesDiv.textContent;
                            
                            // Текущая ставка
                            const bidMatch = valuesText.match(/Ставка:\s*(\d+(?:\s?\d+)*(?:[.,]\d+)?)\s*руб/i);
                            if (bidMatch) {
                                data.winningBid = bidMatch[1].replace(/\s/g, '').replace(',', '.');
                            }
                            
                            // Лидер
                            const leaderMatch = valuesText.match(/Лидер:\s*([a-zA-Z0-9_А-Яа-я]+)/i);
                            if (leaderMatch) {
                                data.winnerLogin = leaderMatch[1];
                            }
                        }
                        
                        return data;
                    });
                    
                    if (lotData.lotNumber && lotData.winningBid) {
                        lotsData.push({
                            lotNumber: lotData.lotNumber,
                            currentBid: lotData.winningBid,
                            bidder: lotData.winnerLogin || 'Неизвестно'
                        });
                        
                        console.log(`✅ Лот ${lotData.lotNumber}: ${lotData.winningBid}₽ (${lotData.winnerLogin || 'Неизвестно'})`);
                    } else {
                        console.log(`❌ Лот ${lotData.lotNumber}: не найдена ставка`);
                    }
                    
                    // Задержка между лотами
                    await new Promise(resolve => setTimeout(resolve, 200));
                    
                } catch (error) {
                    console.error(`❌ Ошибка парсинга лота ${j + 1}:`, error.message);
                    continue;
                }
            }
            
            // Обновляем базу данных после каждого пакета
            console.log(`💾 Обновляем базу данных для пакета ${Math.floor(i/batchSize) + 1}...`);
            let updatedCount = 0;
            for (const lot of lotsData) {
                try {
                    const price = parseFloat(lot.currentBid);
                    if (isNaN(price) || price <= 0) continue;
                    
                    // Ищем лот в БД по номеру лота (независимо от порядка URL)
                    const updateResult = await pool.query(`
                        UPDATE auction_lots 
                        SET winning_bid = $1, 
                            winner_login = $2
                        WHERE auction_number = $3 
                        AND lot_number = $4
                    `, [price, lot.bidder, dbNumber, lot.lotNumber]);
                    
                    if (updateResult.rowCount > 0) {
                        updatedCount++;
                        console.log(`✅ Обновлен лот ${lot.lotNumber}: ${price}₽ (${lot.bidder})`);
                    } else {
                        console.log(`⚠️ Лот ${lot.lotNumber} не найден в БД для обновления`);
                    }
                } catch (error) {
                    console.error(`❌ Ошибка обновления лота ${lot.lotNumber}:`, error);
                }
            }
            
            console.log(`✅ Пакет ${Math.floor(i/batchSize) + 1} завершен: обновлено ${updatedCount} лотов`);
            
            // Сохраняем прогресс
            saveProgress(wolmarNumber, endIndex, totalLots);
            
            // Очищаем массив для следующего пакета
            lotsData.length = 0;
            
            // Пауза между пакетами
            if (i + batchSize < totalLots) {
                console.log(`⏳ Пауза 2 секунды перед следующим пакетом...`);
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
        
        console.log(`🎉 Обработка всех лотов завершена!`);
        
        // Очищаем прогресс при успешном завершении
        clearProgress(wolmarNumber);
        
    } catch (error) {
        console.error('❌ Ошибка парсинга:', error);
    } finally {
        await browser.close();
    }
}

// Основная функция
async function main() {
    console.log('🚀 Запуск обновления текущих ставок (исправленная версия)...');

    try {
        let wolmarNumber, dbNumber;
        
        // Проверяем аргументы командной строки
        const args = process.argv.slice(2);
        let startFromIndex = null;
        
        if (args.length > 0) {
            const inputNumber = parseInt(args[0]);
            if (isNaN(inputNumber)) {
                console.log('❌ Неверный номер. Используйте: node update-current-auction-fixed.js [внутренний_номер] [стартовый_индекс]');
                return;
            }
            
            // Проверяем, есть ли второй аргумент (стартовый индекс)
            if (args.length > 1) {
                startFromIndex = parseInt(args[1]);
                if (isNaN(startFromIndex)) {
                    console.log('❌ Неверный стартовый индекс. Используйте число');
                    return;
                }
                console.log(`🎯 Запуск с индекса: ${startFromIndex}`);
            }
            
            // Пробуем найти номер Wolmar по внутреннему номеру
            const auctionInfo = await getWolmarAuctionNumber(inputNumber);
            
            if (!auctionInfo) {
                console.log(`❌ Не найден аукцион для внутреннего номера ${inputNumber}`);
                console.log('💡 Проверьте, что номер существует в базе данных');
                return;
            }
            
            // Определяем номера для парсинга и обновления БД
            if (typeof auctionInfo === 'object') {
                wolmarNumber = auctionInfo.wolmarNumber;
                dbNumber = auctionInfo.dbNumber;
            } else {
                wolmarNumber = auctionInfo;
                dbNumber = auctionInfo;
            }
            
            console.log(`📋 Внутренний номер: ${inputNumber} → Wolmar аукцион: ${wolmarNumber}, БД аукцион: ${dbNumber}`);
        } else {
            // Получаем номер текущего аукциона автоматически
            const auctionNumber = await getCurrentAuctionNumber();
            
            if (!auctionNumber) {
                console.log('❌ Не найден текущий аукцион');
                console.log('💡 Используйте: node update-current-auction-fixed.js [внутренний_номер]');
                return;
            }
            
            console.log(`📋 Текущий аукцион: ${auctionNumber}`);
            
            // Для автоматического режима используем один номер
            wolmarNumber = auctionNumber;
            dbNumber = auctionNumber;
        }
        
        // Парсим и обновляем ставки
        await parseCurrentBidsFixed(wolmarNumber, dbNumber, startFromIndex);
        
        console.log('✅ Обновление завершено');
        
    } catch (error) {
        console.error('❌ Критическая ошибка:', error);
    } finally {
        await pool.end();
    }
}

// Запуск скрипта
if (require.main === module) {
    main();
}





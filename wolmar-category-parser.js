/**
 * Wolmar Category Parser
 * 
 * Парсер лотов по категориям Wolmar на основе wolmar-parser5.js
 * 
 * Основные возможности:
 * - Обнаружение всех категорий на Wolmar
 * - Парсинг лотов по категориям с автоматической классификацией
 * - Сохранение с указанием источника (категория vs аукцион)
 * - Обработка пагинации в категориях
 * 
 * Дата создания: 18.09.2025
 * Автор: AI Assistant
 */

const puppeteer = require('puppeteer-core');
const { Client } = require('pg');
const fs = require('fs');
const https = require('https');

// Импортируем базовый парсер
const WolmarAuctionParser = require('./wolmar-parser5');
const LotClassifier = require('./lot-classifier');

class WolmarCategoryParser {
    constructor(dbConfig) {
        // Создаем экземпляр базового парсера
        this.baseParser = new WolmarAuctionParser(dbConfig, 'category-parser');
        
        // Копируем все свойства базового парсера
        this.dbConfig = this.baseParser.dbConfig;
        this.dbClient = this.baseParser.dbClient;
        this.browser = this.baseParser.browser;
        this.page = this.baseParser.page;
        this.processed = this.baseParser.processed;
        this.errors = this.baseParser.errors;
        this.skipped = this.baseParser.skipped;
        this.auctionNumber = this.baseParser.auctionNumber;
        this.progressFile = this.baseParser.progressFile;
        
        // Добавляем специфичные для категорий свойства
        this.categories = [];
        this.classifier = new LotClassifier();
        this.baseUrl = 'https://wolmar.ru';
    }

    // Копируем необходимые методы из базового класса
    async init() {
        return await this.baseParser.init();
    }

    async ensurePageActive() {
        return await this.baseParser.ensurePageActive();
    }

    async recreatePage() {
        return await this.baseParser.recreatePage();
    }

    async delay(ms) {
        return await this.baseParser.delay(ms);
    }

    async lotExists(auctionNumber, lotNumber) {
        return await this.baseParser.lotExists(auctionNumber, lotNumber);
    }

    /**
     * Обнаружение всех категорий на Wolmar
     */
    async discoverCategories() {
        console.log('🔍 Обнаружение категорий на Wolmar...');
        
        try {
            await this.ensurePageActive();
            await this.page.goto(this.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await this.delay(2000);

            const categories = await this.page.evaluate(() => {
                const foundCategories = [];
                
                // Ищем ссылки с параметром ?category=
                const categoryLinks = document.querySelectorAll('a[href*="?category="]');
                categoryLinks.forEach(link => {
                    const url = link.href;
                    const name = link.textContent.trim();
                    if (name && url) {
                        foundCategories.push({
                            name: name,
                            url: url,
                            type: 'parametric'
                        });
                    }
                });

                // Ищем текстовые ссылки на категории (например, /monety)
                const textCategoryLinks = document.querySelectorAll('a[href^="/"][href*="category"], a[href^="/"][href*="monety"], a[href^="/"][href*="banknoty"]');
                textCategoryLinks.forEach(link => {
                    const url = link.href;
                    const name = link.textContent.trim();
                    if (name && url && !url.includes('?') && url !== '/') {
                        foundCategories.push({
                            name: name,
                            url: url,
                            type: 'url'
                        });
                    }
                });

                return foundCategories;
            });

            // Удаляем дубликаты по URL
            const uniqueCategories = categories.filter((category, index, self) => 
                index === self.findIndex(c => c.url === category.url)
            );

            this.categories = uniqueCategories;
            console.log(`✅ Найдено ${uniqueCategories.length} уникальных категорий`);
            
            // Выводим список категорий
            uniqueCategories.forEach((category, index) => {
                console.log(`   ${index + 1}. ${category.name} (${category.type}) - ${category.url}`);
            });

            return uniqueCategories;

        } catch (error) {
            console.error('❌ Ошибка обнаружения категорий:', error.message);
            throw error;
        }
    }

    /**
     * Получение ссылок на лоты в категории
     */
    async getCategoryLotUrls(categoryUrl, testMode = false) {
        console.log(`🔍 Собираем ссылки на лоты в категории: ${categoryUrl}`);
        const allUrls = new Set();
        
        try {
            await this.ensurePageActive();
            await this.page.goto(categoryUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await this.delay(2000);

            // Получаем информацию о пагинации
            const paginationInfo = await this.page.evaluate(() => {
                // Ищем информацию о количестве лотов и страниц
                const totalLotsElement = document.querySelector('.disabled[style*="float: right"]');
                const totalLots = totalLotsElement ? totalLotsElement.textContent.match(/(\d+)\s*лот/)?.[1] : null;
                
                // Ищем последнюю страницу в пагинации
                const paginationLinks = document.querySelectorAll('.paginator li a');
                let maxPage = 1;
                paginationLinks.forEach(link => {
                    const pageNum = parseInt(link.textContent);
                    if (pageNum && pageNum > maxPage) {
                        maxPage = pageNum;
                    }
                });

                return {
                    totalLots: totalLots ? parseInt(totalLots) : null,
                    maxPage: maxPage
                };
            });

            console.log(`   📊 Найдено лотов: ${paginationInfo.totalLots || 'неизвестно'}`);
            console.log(`   📄 Страниц: ${paginationInfo.maxPage}`);

            const maxPages = testMode ? Math.min(3, paginationInfo.maxPage) : paginationInfo.maxPage;

            // Собираем ссылки со всех страниц
            for (let page = 1; page <= maxPages; page++) {
                try {
                    const pageUrl = page === 1 ? categoryUrl : `${categoryUrl}${categoryUrl.includes('?') ? '&' : '?'}page=${page}`;
                    
                    console.log(`   📄 Обрабатываем страницу ${page}/${maxPages}: ${pageUrl}`);
                    
                    await this.page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
                    await this.delay(1000);

                    // Извлекаем ссылки на лоты с текущей страницы
                    const pageUrls = await this.page.evaluate(() => {
                        const urls = [];
                        
                        // Ищем все ссылки на лоты в таблице
                        const lotLinks = document.querySelectorAll('a.title.lot[href*="/auction/"]');
                        
                        lotLinks.forEach(link => {
                            if (link.href && link.href.includes('/auction/')) {
                                urls.push(link.href);
                            }
                        });

                        return urls;
                    });

                    pageUrls.forEach(url => allUrls.add(url));
                    console.log(`   ✓ Найдено ссылок на странице: ${pageUrls.length} (всего: ${allUrls.size})`);

                    // Задержка между страницами
                    await this.delay(500);

                } catch (error) {
                    console.error(`❌ Ошибка на странице ${page}:`, error.message);
                    
                    // Если ошибка связана с detached frame, пересоздаем страницу
                    if (error.message.includes('detached') || error.message.includes('Frame')) {
                        console.log(`🔄 Обнаружена ошибка detached frame на странице ${page}, пересоздаем страницу...`);
                        await this.recreatePage();
                        await this.delay(3000);
                    }
                    
                    continue;
                }
            }

            const urls = Array.from(allUrls);
            console.log(`✅ Собрано ${urls.length} уникальных ссылок на лоты в категории`);
            
            return urls;

        } catch (error) {
            console.error('❌ Ошибка сбора ссылок в категории:', error.message);
            throw error;
        }
    }

    /**
     * Парсинг отдельного лота с добавлением категории
     */
    async parseLotPage(url, auctionEndDate = null, sourceCategory = null) {
        try {
            // Вызываем метод базового парсера
            const lotData = await this.baseParser.parseLotPage(url, auctionEndDate);
            
            // Добавляем информацию о категории
            lotData.sourceCategory = sourceCategory;
            lotData.parsingMethod = 'category_parser';
            
            // Применяем классификатор для определения категории
            if (this.classifier && lotData.coinDescription) {
                const classification = this.classifier.classify({
                    coin_description: lotData.coinDescription,
                    letters: lotData.letters || '',
                    metal: lotData.metal || '',
                    lot_type: lotData.lotType || ''
                });
                
                lotData.category = classification.category;
                lotData.categoryConfidence = classification.confidence;
            }
            
            return lotData;
            
        } catch (error) {
            console.error('❌ Ошибка парсинга лота с категорией:', error.message);
            throw error;
        }
    }

    /**
     * Сохранение лота в базу данных с дополнительными полями
     */
    async saveLotToDatabase(lotData) {
        try {
            const insertQuery = `
                INSERT INTO auction_lots (
                    lot_number, auction_number, coin_description, avers_image_url, avers_image_path,
                    revers_image_url, revers_image_path, winner_login, winning_bid, auction_end_date,
                    currency, source_url, bids_count, lot_status, year, metal, weight, condition,
                    letters, mintage, lot_type, category, source_category, parsing_method
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24
                ) RETURNING id
            `;

            const values = [
                lotData.lotNumber,
                lotData.auctionNumber,
                lotData.coinDescription,
                lotData.aversImageUrl,
                lotData.aversImagePath,
                lotData.reversImageUrl,
                lotData.reversImagePath,
                lotData.winnerLogin,
                lotData.winningBid,
                lotData.auctionEndDate,
                lotData.currency || 'RUB',
                lotData.sourceUrl,
                lotData.bidsCount,
                lotData.lotStatus,
                lotData.year,
                lotData.metal,
                lotData.weight,
                lotData.condition,
                lotData.letters,
                lotData.mintage,
                lotData.lotType,
                lotData.category,
                lotData.sourceCategory,
                lotData.parsingMethod
            ];

            const result = await this.dbClient.query(insertQuery, values);
            return result.rows[0].id;

        } catch (error) {
            console.error('❌ Ошибка сохранения лота в БД:', error.message);
            
            // Если соединение прервано, пробуем переподключиться
            if (error.message.includes('Connection terminated') || error.message.includes('connection') || error.message.includes('not queryable')) {
                console.log('🔄 Переподключение к базе данных...');
                try {
                    await this.dbClient.end();
                    this.dbClient = new Client(this.dbConfig);
                    await this.dbClient.connect();
                    console.log('✅ Переподключение успешно');
                    
                    // Повторяем операцию
                    return await this.saveLotToDatabase(lotData);
                } catch (reconnectError) {
                    console.error('❌ Ошибка переподключения:', reconnectError.message);
                    return null;
                }
            }
            
            return null;
        }
    }

    /**
     * Парсинг лотов в конкретной категории
     */
    async parseCategoryLots(categoryUrl, categoryName, options = {}) {
        const {
            maxLots = null,
            skipExisting = true,
            delayBetweenLots = 800,
            testMode = false
        } = options;

        console.log(`\n🎯 Начинаем парсинг категории: ${categoryName}`);
        console.log(`   URL: ${categoryUrl}`);
        console.log(`   Настройки: maxLots=${maxLots}, skipExisting=${skipExisting}, delay=${delayBetweenLots}ms, testMode=${testMode}`);

        try {
            // Получаем ссылки на лоты в категории
            const lotUrls = await this.getCategoryLotUrls(categoryUrl, testMode);
            
            if (lotUrls.length === 0) {
                console.log(`⚠️ В категории ${categoryName} не найдено лотов`);
                return;
            }

            const totalLots = maxLots ? Math.min(maxLots, lotUrls.length) : lotUrls.length;
            console.log(`📊 Будет обработано лотов: ${totalLots}`);

            let categoryProcessed = 0;
            let categorySkipped = 0;
            let categoryErrors = 0;

            // Обрабатываем лоты
            for (let i = 0; i < totalLots; i++) {
                const url = lotUrls[i];
                const progress = `${i + 1}/${totalLots}`;
                
                try {
                    console.log(`\n[${progress}] Парсинг: ${url}`);
                    
                    // Парсим лот с указанием категории
                    const lotData = await this.parseLotPage(url, null, categoryName);
                    
                    // Проверка на существование лота
                    if (skipExisting && lotData.auctionNumber && lotData.lotNumber) {
                        const exists = await this.lotExists(lotData.auctionNumber, lotData.lotNumber);
                        if (exists) {
                            console.log(`   ⏭️ Лот ${lotData.lotNumber} уже существует, пропускаем`);
                            categorySkipped++;
                            continue;
                        }
                    }

                    // Сохранение в БД
                    const savedId = await this.saveLotToDatabase(lotData);
                    if (savedId) {
                        categoryProcessed++;
                        this.processed++;
                        
                        // Вывод информации о лоте
                        console.log(`   ✅ Лот ${lotData.lotNumber}: ${lotData.coinDescription?.substring(0, 50)}...`);
                        console.log(`   💰 ${lotData.winningBid} руб. | 👤 ${lotData.winnerLogin} | 🏷️ ${lotData.category || 'не определена'}`);
                    } else {
                        console.log(`   ❌ Лот ${lotData.lotNumber} не был сохранен в БД`);
                        categoryErrors++;
                        this.errors++;
                    }

                    // Задержка между лотами
                    await this.delay(delayBetweenLots);

                } catch (error) {
                    console.error(`❌ Ошибка обработки лота [${progress}]:`, error.message);
                    categoryErrors++;
                    this.errors++;
                    
                    // Если ошибка связана с detached frame, пересоздаем страницу
                    if (error.message.includes('detached') || error.message.includes('Frame')) {
                        console.log(`🔄 Обнаружена ошибка detached frame, пересоздаем страницу...`);
                        await this.recreatePage();
                        await this.delay(3000);
                    }
                }
            }

            console.log(`\n📊 Статистика по категории "${categoryName}":`);
            console.log(`   ✅ Обработано: ${categoryProcessed}`);
            console.log(`   ⏭️ Пропущено: ${categorySkipped}`);
            console.log(`   ❌ Ошибок: ${categoryErrors}`);

        } catch (error) {
            console.error(`❌ Ошибка парсинга категории ${categoryName}:`, error.message);
            throw error;
        }
    }

    /**
     * Основной метод парсинга всех категорий
     */
    async parseAllCategories(options = {}) {
        const {
            maxCategories = null,
            maxLotsPerCategory = null,
            skipExisting = true,
            delayBetweenLots = 800,
            testMode = false
        } = options;

        console.log('🚀 Начинаем парсинг всех категорий Wolmar...');
        console.log(`Настройки: maxCategories=${maxCategories}, maxLotsPerCategory=${maxLotsPerCategory}, testMode=${testMode}`);

        try {
            // Инициализация
            await this.init();

            // Обнаружение категорий
            const categories = await this.discoverCategories();
            
            if (categories.length === 0) {
                console.log('⚠️ Категории не найдены');
                return;
            }

            const totalCategories = maxCategories ? Math.min(maxCategories, categories.length) : categories.length;
            console.log(`\n📊 Будет обработано категорий: ${totalCategories}`);

            // Парсинг каждой категории
            for (let i = 0; i < totalCategories; i++) {
                const category = categories[i];
                const progress = `${i + 1}/${totalCategories}`;
                
                console.log(`\n🎯 [${progress}] Обрабатываем категорию: ${category.name}`);
                
                try {
                    await this.parseCategoryLots(category.url, category.name, {
                        maxLots: maxLotsPerCategory,
                        skipExisting,
                        delayBetweenLots,
                        testMode
                    });
                    
                    // Задержка между категориями
                    await this.delay(2000);
                    
                } catch (error) {
                    console.error(`❌ Ошибка обработки категории ${category.name}:`, error.message);
                    this.errors++;
                    continue;
                }
            }

            // Финальная статистика
            console.log(`\n🎉 Парсинг всех категорий завершен!`);
            console.log(`📊 Общая статистика:`);
            console.log(`   ✅ Обработано лотов: ${this.processed}`);
            console.log(`   ❌ Ошибок: ${this.errors}`);
            console.log(`   ⏭️ Пропущено: ${this.skipped}`);

        } catch (error) {
            console.error('❌ Критическая ошибка парсинга категорий:', error.message);
            throw error;
        } finally {
            // Закрываем соединения
            if (this.browser) {
                await this.browser.close();
            }
            if (this.dbClient) {
                await this.dbClient.end();
            }
        }
    }
}

// Экспорт для использования в других модулях
module.exports = WolmarCategoryParser;

// Запуск если файл вызван напрямую
if (require.main === module) {
    const config = require('./config');
    
    const parser = new WolmarCategoryParser(config.dbConfig);
    
    // Настройки для тестового запуска
    const options = {
        maxCategories: 3,        // Обработать только 3 категории
        maxLotsPerCategory: 10,  // По 10 лотов в каждой категории
        skipExisting: true,      // Пропускать существующие лоты
        delayBetweenLots: 1000,  // Задержка 1 секунда между лотами
        testMode: true           // Тестовый режим
    };
    
    parser.parseAllCategories(options)
        .then(() => {
            console.log('✅ Парсинг категорий завершен успешно');
            process.exit(0);
        })
        .catch((error) => {
            console.error('❌ Парсинг категорий завершен с ошибкой:', error.message);
            process.exit(1);
        });
}

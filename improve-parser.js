// Улучшение wolmar-parser4.js для извлечения состояний с градациями
// с общих страниц аукционов

// Новая функция для извлечения ссылок и состояний с общих страниц
async function getAllLotUrlsWithConditions(auctionUrl, testMode = false) {
    console.log('🔍 Собираем ссылки на все лоты с состояниями...');
    const allLotsData = new Map(); // Используем Map для избежания дубликатов
    
    try {
        // Проверяем, что страница еще активна
        await this.ensurePageActive();

        await this.page.goto(auctionUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await this.delay(2000);

        // Получаем общее количество страниц
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

        console.log(`📊 Найдено лотов: ${paginationInfo.totalLots}`);
        console.log(`📄 Страниц пагинации: ${paginationInfo.maxPage}`);

        // В тестовом режиме обрабатываем только первую страницу
        const pagesToProcess = testMode ? 1 : paginationInfo.maxPage;
        console.log(`📋 Режим: ${testMode ? 'ТЕСТ (только 1 страница)' : 'ПОЛНЫЙ'} - обрабатываем ${pagesToProcess} страниц`);

        // Проходим по страницам пагинации
        for (let page = 1; page <= pagesToProcess; page++) {
            console.log(`🔄 Обрабатываем страницу ${page}/${pagesToProcess}...`);
            
            const pageUrl = page === 1 ? auctionUrl : `${auctionUrl}?page=${page}`;
            
            try {
                await this.page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
                await this.delay(1000);

                // Извлекаем ссылки на лоты и их состояния с текущей страницы
                const pageLotsData = await this.page.evaluate(() => {
                    const lots = [];
                    
                    // Ищем все ссылки на лоты в таблице
                    const lotLinks = document.querySelectorAll('a.title.lot[href*="/auction/"]');
                    
                    lotLinks.forEach(link => {
                        if (link.href && link.href.includes('/auction/')) {
                            const lotData = {
                                url: link.href
                            };
                            
                            // Ищем состояние в родительской строке таблицы
                            const parentRow = link.closest('tr');
                            if (parentRow) {
                                const cells = parentRow.querySelectorAll('td');
                                cells.forEach(cell => {
                                    const cellText = cell.textContent.trim();
                                    // Ищем состояния типа MS, AU, XF, VF, UNC с возможными цифрами
                                    if (cellText.match(/^(MS|AU|XF|VF|UNC|PL)[\s\d\-\+\/]*$/i)) {
                                        lotData.condition = cellText;
                                    }
                                });
                            }
                            
                            // Если не нашли в ячейках, ищем в тексте строки
                            if (!lotData.condition && parentRow) {
                                const rowText = parentRow.textContent;
                                const conditionMatch = rowText.match(/(MS|AU|XF|VF|UNC|PL)[\s\d\-\+\/]*/i);
                                if (conditionMatch) {
                                    lotData.condition = conditionMatch[0].trim();
                                }
                            }
                            
                            // Если нашли состояние, добавляем в результат
                            if (lotData.condition) {
                                lots.push(lotData);
                            }
                        }
                    });

                    return lots;
                });

                // Добавляем данные в общую карту (избегаем дубликатов по URL)
                pageLotsData.forEach(lotData => {
                    allLotsData.set(lotData.url, lotData);
                });
                
                console.log(`   ✓ Найдено лотов с состояниями на странице: ${pageLotsData.length} (всего: ${allLotsData.size})`);

                // Задержка между страницами
                await this.delay(500);

            } catch (error) {
                console.error(`❌ Ошибка на странице ${page}:`, error.message);
                
                // Если ошибка связана с detached frame, пересоздаем страницу
                if (error.message.includes('detached') || error.message.includes('Frame')) {
                    console.log(`🔄 Обнаружена ошибка detached frame на странице ${page}, пересоздаем страницу...`);
                    await this.recreatePage();
                    // Делаем паузу перед продолжением
                    await this.delay(3000);
                }
                
                // Если ошибка связана с соединением базы данных, пробуем переподключиться
                if (error.message.includes('Connection terminated') || error.message.includes('connection')) {
                    console.log(`🔄 Обнаружена ошибка соединения с БД на странице ${page}, пробуем переподключиться...`);
                    try {
                        await this.dbClient.end();
                        await this.dbClient.connect();
                        console.log('✅ Переподключение к БД успешно');
                    } catch (reconnectError) {
                        console.error('❌ Ошибка переподключения к БД:', reconnectError.message);
                    }
                }
                
                continue;
            }
        }

        // Сохраняем данные о лотах в базу данных
        if (allLotsData.size > 0) {
            console.log(`💾 Сохраняем данные о ${allLotsData.size} лотах в базу данных...`);
            await this.saveLotUrlsWithConditionsToDatabase(Array.from(allLotsData.values()));
        }

        // Возвращаем только URL для совместимости с существующим кодом
        return Array.from(allLotsData.keys());

    } catch (error) {
        console.error('❌ Ошибка при сборе ссылок и состояний:', error.message);
        return [];
    }
}

// Новая функция для сохранения данных о лотах с состояниями в базу данных
async function saveLotUrlsWithConditionsToDatabase(lotsData) {
    try {
        // Создаем таблицу для хранения данных о лотах с состояниями (если не существует)
        const createTableQuery = `
            CREATE TABLE IF NOT EXISTS auction_lots_conditions (
                id SERIAL PRIMARY KEY,
                auction_number VARCHAR(10) NOT NULL,
                lot_url TEXT NOT NULL,
                condition_text TEXT,
                extracted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(auction_number, lot_url)
            );
        `;
        
        await this.dbClient.query(createTableQuery);
        
        // Сохраняем данные о лотах
        for (const lotData of lotsData) {
            try {
                const insertQuery = `
                    INSERT INTO auction_lots_conditions (auction_number, lot_url, condition_text)
                    VALUES ($1, $2, $3)
                    ON CONFLICT (auction_number, lot_url) 
                    DO UPDATE SET 
                        condition_text = EXCLUDED.condition_text,
                        extracted_at = CURRENT_TIMESTAMP;
                `;
                
                await this.dbClient.query(insertQuery, [
                    this.auctionNumber,
                    lotData.url,
                    lotData.condition
                ]);
                
            } catch (error) {
                console.error(`❌ Ошибка при сохранении лота ${lotData.url}:`, error.message);
            }
        }
        
        console.log(`✅ Сохранено ${lotsData.length} записей о состояниях лотов`);
        
    } catch (error) {
        console.error('❌ Ошибка при сохранении данных о состояниях:', error.message);
    }
}

// Функция для извлечения состояния с градацией (улучшенная версия)
function extractConditionWithGrade(conditionText) {
    if (!conditionText) return null;
    // Убираем все пробелы для унификации
    return conditionText.replace(/\s+/g, '');
}

// Модифицированная функция parseLotPage для использования сохраненных состояний
async function parseLotPageWithSavedCondition(url, auctionEndDate = null) {
    try {
        // Проверяем, что страница еще активна
        await this.ensurePageActive();
        await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await this.delay(2000);

        const lotData = await this.page.evaluate(() => {
            const data = {};

            // Номер аукциона - из хлебных крошек
            const breadcrumbAuction = document.querySelector('ol[typeof="BreadcrumbList"] li:nth-child(2) span[property="name"]');
            if (breadcrumbAuction) {
                const match = breadcrumbAuction.textContent.match(/№\s*(\d+)/);
                if (match) {
                    data.auctionNumber = match[1];
                }
            }

            // Если не нашли в breadcrumb, ищем в h1
            if (!data.auctionNumber) {
                const h1 = document.querySelector('h1');
                if (h1) {
                    const match = h1.textContent.match(/№\s*(\d+)/);
                    if (match) {
                        data.auctionNumber = match[1];
                    }
                }
            }

            // Извлекаем из URL как резерв
            if (!data.auctionNumber) {
                const urlMatch = window.location.href.match(/\/auction\/(\d+)\//);
                if (urlMatch) {
                    data.auctionNumber = urlMatch[1];
                }
            }

            // Номер лота - из заголовка h5
            const lotTitle = document.querySelector('h5');
            if (lotTitle) {
                const match = lotTitle.textContent.match(/Лот\s*№?\s*(\d+)/);
                if (match) {
                    data.lotNumber = match[1];
                }
            }

            // Если не нашли в h5, ищем в других местах
            if (!data.lotNumber) {
                const lotElements = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
                for (const element of lotElements) {
                    const match = element.textContent.match(/Лот\s*№?\s*(\d+)/);
                    if (match) {
                        data.lotNumber = match[1];
                        break;
                    }
                }
            }

            // Извлекаем из URL как резерв
            if (!data.lotNumber) {
                const urlMatch = window.location.href.match(/\/auction\/\d+\/(\d+)/);
                if (urlMatch) {
                    data.lotNumber = urlMatch[1];
                }
            }

            // Описание монеты
            const descriptionElement = document.querySelector('.lot-description, .description, .lot-info');
            if (descriptionElement) {
                data.coinDescription = descriptionElement.textContent.trim();
            }

            // Если не нашли в специальном элементе, ищем в тексте страницы
            if (!data.coinDescription) {
                const pageText = document.body.textContent;
                const descriptionMatch = pageText.match(/Описание[:\s]*([^\n\r]+)/i);
                if (descriptionMatch) {
                    data.coinDescription = descriptionMatch[1].trim();
                }
            }

            // Извлекаем информацию о состоянии с градацией
            const valuesText = document.body.textContent;
            
            // Улучшенное извлечение состояния с поддержкой градаций
            const conditionMatch = valuesText.match(/Сохранность:\s*([\w\-\+\/\s]+)/);
            if (conditionMatch) {
                // Убираем ВСЕ пробелы из состояния для унификации
                data.condition = conditionMatch[1].replace(/\s+/g, '');
            }

            // Если не нашли в тексте, пробуем найти в таблице
            if (!data.condition) {
                const conditionCells = document.querySelectorAll('td, .condition, .grade');
                for (const cell of conditionCells) {
                    const cellText = cell.textContent.trim();
                    if (cellText.match(/^(MS|AU|XF|VF|UNC|PL)[\s\d\-\+\/]*$/i)) {
                        data.condition = cellText.replace(/\s+/g, '');
                        break;
                    }
                }
            }

            // Остальные поля (год, металл, вес и т.д.) - как в оригинале
            const yearMatch = valuesText.match(/Год[:\s]*(\d{4})/);
            if (yearMatch) {
                data.year = yearMatch[1];
            }

            const metalMatch = valuesText.match(/Металл[:\s]*([^\n\r]+)/i);
            if (metalMatch) {
                data.metal = metalMatch[1].trim();
            }

            const weightMatch = valuesText.match(/Вес[:\s]*([\d,\.]+)\s*г/i);
            if (weightMatch) {
                data.weight = parseFloat(weightMatch[1].replace(',', '.'));
            }

            const lettersMatch = valuesText.match(/Буквы[:\s]*([^\n\r]+)/i);
            if (lettersMatch) {
                data.letters = lettersMatch[1].trim();
            }

            // Информация о торгах
            const winnerMatch = valuesText.match(/Победитель[:\s]*([^\n\r]+)/i);
            if (winnerMatch) {
                data.winnerLogin = winnerMatch[1].trim();
            }

            const bidMatch = valuesText.match(/Цена[:\s]*([\d\s]+)\s*руб/i);
            if (bidMatch) {
                data.winningBid = parseInt(bidMatch[1].replace(/\s/g, ''));
            }

            const bidsMatch = valuesText.match(/Ставок[:\s]*(\d+)/i);
            if (bidsMatch) {
                data.bidsCount = parseInt(bidsMatch[1]);
            }

            const statusMatch = valuesText.match(/Статус[:\s]*([^\n\r]+)/i);
            if (statusMatch) {
                data.lotStatus = statusMatch[1].trim();
            }

            // URL источника
            data.sourceUrl = window.location.href;

            return data;
        });

        // Устанавливаем дату закрытия аукциона
        if (auctionEndDate) {
            lotData.auctionEndDate = auctionEndDate;
        }

        return lotData;

    } catch (error) {
        console.error('Ошибка при парсинге лота:', error.message);
        return null;
    }
}

module.exports = {
    getAllLotUrlsWithConditions,
    saveLotUrlsWithConditionsToDatabase,
    extractConditionWithGrade,
    parseLotPageWithSavedCondition
};

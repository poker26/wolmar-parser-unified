const { launchPuppeteer, createPage, cleanupChromeTempFiles } = require('./puppeteer-utils');

async function debugBidTable() {
    console.log('🔍 ДИАГНОСТИКА ТАБЛИЦЫ СТАВОК');
    console.log('==============================');
    
    const browser = await launchPuppeteer();
    const page = await createPage(browser);
    
    try {
        console.log('\n1️⃣ Переходим на страницу лота...');
        const testUrl = 'https://www.wolmar.ru/auction/2070/7226578?category=bony';
        await page.goto(testUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        
        console.log('\n2️⃣ Анализируем HTML структуру таблицы ставок...');
        const tableInfo = await page.evaluate(() => {
            const info = {
                tables: [],
                bidTable: null
            };
            
            // Ищем все таблицы на странице
            const allTables = document.querySelectorAll('table');
            console.log(`Найдено таблиц: ${allTables.length}`);
            
            allTables.forEach((table, index) => {
                const tbody = table.querySelector('tbody');
                const rows = tbody ? tbody.querySelectorAll('tr') : table.querySelectorAll('tr');
                
                info.tables.push({
                    index: index,
                    hasTbody: !!tbody,
                    rowCount: rows.length,
                    firstRowCells: rows.length > 0 ? rows[0].querySelectorAll('td').length : 0,
                    firstRowText: rows.length > 0 ? rows[0].textContent.trim().substring(0, 100) : ''
                });
                
                // Проверяем, содержит ли таблица ставки
                if (rows.length > 0) {
                    const firstRowText = rows[0].textContent.trim();
                    if (firstRowText.includes('руб') || firstRowText.includes('₽')) {
                        info.bidTable = {
                            index: index,
                            rowCount: rows.length,
                            sampleRows: []
                        };
                        
                        // Берем первые 3 строки как образец
                        for (let i = 0; i < Math.min(3, rows.length); i++) {
                            const cells = rows[i].querySelectorAll('td');
                            const rowData = {
                                cellCount: cells.length,
                                cells: []
                            };
                            
                            cells.forEach((cell, cellIndex) => {
                                rowData.cells.push({
                                    index: cellIndex,
                                    text: cell.textContent.trim(),
                                    html: cell.innerHTML.trim()
                                });
                            });
                            
                            info.bidTable.sampleRows.push(rowData);
                        }
                    }
                }
            });
            
            return info;
        });
        
        console.log('\n3️⃣ Результаты анализа:');
        console.log(`📊 Найдено таблиц: ${tableInfo.tables.length}`);
        
        tableInfo.tables.forEach(table => {
            console.log(`   Таблица ${table.index}: ${table.rowCount} строк, ${table.firstRowCells} колонок`);
            console.log(`   Первая строка: ${table.firstRowText}`);
        });
        
        if (tableInfo.bidTable) {
            console.log(`\n💰 Найдена таблица ставок (индекс ${tableInfo.bidTable.index}):`);
            console.log(`📊 Строк: ${tableInfo.bidTable.rowCount}`);
            
            tableInfo.bidTable.sampleRows.forEach((row, rowIndex) => {
                console.log(`\n   Строка ${rowIndex + 1} (${row.cellCount} колонок):`);
                row.cells.forEach((cell, cellIndex) => {
                    console.log(`     Колонка ${cellIndex}: "${cell.text}"`);
                });
            });
        } else {
            console.log('❌ Таблица ставок не найдена');
        }
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    } finally {
        await cleanupChromeTempFiles();
        await browser.close();
    }
}

if (require.main === module) {
    debugBidTable();
}

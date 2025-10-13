const puppeteer = require('puppeteer');
const { launchPuppeteer, createPage, cleanupChromeTempFiles } = require('./puppeteer-utils');

async function analyzeWolmarCategoriesDetailed() {
    console.log('🔍 Детальный анализ категорий на Wolmar...');
    
    const browser = await launchPuppeteer();
    
    try {
        const page = await createPage(browser);
        
        // Переходим на главную страницу Wolmar
        console.log('📄 Загружаем главную страницу Wolmar...');
        await page.goto('https://wolmar.ru/', { 
            waitUntil: 'networkidle2',
            timeout: 30000 
        });
        
        // Ждем загрузки страницы
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Получаем HTML страницы для анализа
        const pageContent = await page.content();
        
        // Ищем все ссылки с параметром category
        console.log('🔍 Ищем ссылки с параметром category...');
        
        const categoryLinks = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a[href*="category"]'));
            return links.map(link => ({
                text: link.textContent.trim(),
                href: link.href,
                categoryId: new URL(link.href).searchParams.get('category')
            }));
        });
        
        console.log(`📋 Найдено ${categoryLinks.length} ссылок с категориями:`);
        categoryLinks.forEach((link, index) => {
            console.log(`${index + 1}. ${link.text}`);
            console.log(`   URL: ${link.href}`);
            console.log(`   Category ID: ${link.categoryId}`);
            console.log('');
        });
        
        // Ищем блок "Категории монет" и получаем все ссылки в нем
        console.log('🔍 Ищем блок "Категории монет"...');
        
        const categoryBlockLinks = await page.evaluate(() => {
            // Ищем элемент, содержащий текст "Категории монет"
            const walker = document.createTreeWalker(
                document.body,
                NodeFilter.SHOW_TEXT,
                null,
                false
            );
            
            let categoryBlock = null;
            let node;
            while (node = walker.nextNode()) {
                if (node.textContent.includes('Категории монет')) {
                    categoryBlock = node.parentElement;
                    break;
                }
            }
            
            if (!categoryBlock) return [];
            
            // Ищем все ссылки в этом блоке и соседних элементах
            const allLinks = [];
            let currentElement = categoryBlock;
            
            // Проверяем текущий элемент и его соседей
            for (let i = 0; i < 10; i++) {
                if (!currentElement) break;
                
                const links = currentElement.querySelectorAll('a');
                links.forEach(link => {
                    const text = link.textContent.trim();
                    const href = link.href;
                    if (text && href && text.length > 0 && text.length < 200) {
                        allLinks.push({
                            text: text,
                            href: href,
                            categoryId: href.includes('category=') ? new URL(href).searchParams.get('category') : null
                        });
                    }
                });
                
                currentElement = currentElement.nextElementSibling;
            }
            
            return allLinks;
        });
        
        console.log(`📋 Найдено ${categoryBlockLinks.length} ссылок в блоке категорий:`);
        categoryBlockLinks.forEach((link, index) => {
            console.log(`${index + 1}. ${link.text}`);
            console.log(`   URL: ${link.href}`);
            if (link.categoryId) {
                console.log(`   Category ID: ${link.categoryId}`);
            }
            console.log('');
        });
        
        // Попробуем найти конкретные категории монет
        console.log('🔍 Ищем конкретные категории монет...');
        
        const coinCategories = await page.evaluate(() => {
            const categories = [];
            const textContent = document.body.textContent;
            
            // Ищем упоминания конкретных категорий
            const categoryPatterns = [
                'Монеты антика',
                'средневековье',
                'Допетровские монеты',
                'Монеты России до 1917',
                'золото',
                'серебро',
                'Монеты СССР',
                'Монеты России',
                'Иностранные монеты'
            ];
            
            categoryPatterns.forEach(pattern => {
                if (textContent.includes(pattern)) {
                    // Ищем ближайшие ссылки к этому тексту
                    const walker = document.createTreeWalker(
                        document.body,
                        NodeFilter.SHOW_TEXT,
                        null,
                        false
                    );
                    
                    let node;
                    while (node = walker.nextNode()) {
                        if (node.textContent.includes(pattern)) {
                            let parent = node.parentElement;
                            for (let i = 0; i < 5; i++) {
                                if (!parent) break;
                                const link = parent.querySelector('a');
                                if (link && link.href) {
                                    categories.push({
                                        pattern: pattern,
                                        text: link.textContent.trim(),
                                        href: link.href,
                                        categoryId: link.href.includes('category=') ? new URL(link.href).searchParams.get('category') : null
                                    });
                                    break;
                                }
                                parent = parent.parentElement;
                            }
                            break;
                        }
                    }
                }
            });
            
            return categories;
        });
        
        console.log(`📋 Найдено ${coinCategories.length} категорий монет:`);
        coinCategories.forEach((category, index) => {
            console.log(`${index + 1}. ${category.pattern}`);
            console.log(`   Текст ссылки: ${category.text}`);
            console.log(`   URL: ${category.href}`);
            if (category.categoryId) {
                console.log(`   Category ID: ${category.categoryId}`);
            }
            console.log('');
        });
        
        // Сохраняем все результаты
        const fs = require('fs');
        const results = {
            categoryLinks,
            categoryBlockLinks,
            coinCategories,
            timestamp: new Date().toISOString()
        };
        
        fs.writeFileSync('wolmar-categories-detailed.json', JSON.stringify(results, null, 2));
        console.log('💾 Детальные результаты сохранены в wolmar-categories-detailed.json');
        
        // Попробуем проанализировать одну из найденных категорий
        if (categoryLinks.length > 0) {
            const testCategory = categoryLinks[0];
            console.log(`\n🧪 Тестируем категорию: ${testCategory.text}`);
            console.log(`URL: ${testCategory.href}`);
            
            try {
                await page.goto(testCategory.href, { 
                    waitUntil: 'networkidle2',
                    timeout: 30000 
                });
                
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                // Ищем лоты на странице категории
                const lots = await page.evaluate(() => {
                    const lotElements = document.querySelectorAll('a[href*="/auction/"]');
                    return Array.from(lotElements).slice(0, 5).map(lot => ({
                        text: lot.textContent.trim(),
                        href: lot.href
                    }));
                });
                
                console.log(`📋 Найдено ${lots.length} лотов в категории:`);
                lots.forEach((lot, index) => {
                    console.log(`${index + 1}. ${lot.text}`);
                    console.log(`   URL: ${lot.href}`);
                });
                
            } catch (error) {
                console.log(`❌ Ошибка при анализе категории: ${error.message}`);
            }
        }
        
    } catch (error) {
        console.error('❌ Ошибка при анализе категорий:', error);
    } finally {
        await cleanupChromeTempFiles();
        await browser.close();
    }
}

// Запускаем анализ
analyzeWolmarCategoriesDetailed().catch(console.error);

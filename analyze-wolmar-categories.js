const puppeteer = require('puppeteer');
const { launchPuppeteer, createPage, cleanupChromeTempFiles } = require('./puppeteer-utils');

async function analyzeWolmarCategories() {
    console.log('🔍 Анализируем структуру категорий на Wolmar...');
    
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
        
        // Ищем блок с категориями монет
        console.log('🔍 Ищем блок категорий...');
        
        // Попробуем разные селекторы для поиска категорий
        const categorySelectors = [
            'a[href*="category"]',
            'a[href*="coins"]',
            '.category',
            '.categories',
            '[class*="category"]',
            'a:contains("Монеты")',
            'a:contains("Категории")'
        ];
        
        let categories = [];
        
        for (const selector of categorySelectors) {
            try {
                const elements = await page.$$(selector);
                console.log(`📋 Найдено ${elements.length} элементов с селектором: ${selector}`);
                
                for (const element of elements) {
                    const text = await element.evaluate(el => el.textContent?.trim());
                    const href = await element.evaluate(el => el.href);
                    
                    if (text && href && text.length > 0 && text.length < 100) {
                        categories.push({
                            text: text,
                            href: href,
                            selector: selector
                        });
                    }
                }
            } catch (error) {
                console.log(`⚠️ Ошибка с селектором ${selector}:`, error.message);
            }
        }
        
        // Убираем дубликаты
        const uniqueCategories = categories.filter((category, index, self) => 
            index === self.findIndex(c => c.href === category.href)
        );
        
        console.log(`\n📊 Найдено ${uniqueCategories.length} уникальных категорий:`);
        uniqueCategories.forEach((category, index) => {
            console.log(`${index + 1}. ${category.text}`);
            console.log(`   URL: ${category.href}`);
            console.log(`   Селектор: ${category.selector}`);
            console.log('');
        });
        
        // Сохраняем результаты
        const fs = require('fs');
        fs.writeFileSync('wolmar-categories-analysis.json', JSON.stringify(uniqueCategories, null, 2));
        console.log('💾 Результаты сохранены в wolmar-categories-analysis.json');
        
        // Попробуем найти конкретный блок "Категории монет"
        console.log('\n🔍 Ищем конкретный блок "Категории монет"...');
        
        const categoryBlock = await page.$eval('*', (el) => {
            // Ищем элемент, содержащий текст "Категории монет"
            const walker = document.createTreeWalker(
                el,
                NodeFilter.SHOW_TEXT,
                null,
                false
            );
            
            let node;
            while (node = walker.nextNode()) {
                if (node.textContent.includes('Категории монет')) {
                    return node.parentElement;
                }
            }
            return null;
        });
        
        if (categoryBlock) {
            console.log('✅ Найден блок "Категории монет"');
            
            // Получаем все ссылки в этом блоке
            const categoryLinks = await page.evaluate((block) => {
                const links = block.querySelectorAll('a');
                return Array.from(links).map(link => ({
                    text: link.textContent.trim(),
                    href: link.href
                }));
            }, categoryBlock);
            
            console.log(`📋 Найдено ${categoryLinks.length} ссылок в блоке категорий:`);
            categoryLinks.forEach((link, index) => {
                console.log(`${index + 1}. ${link.text} -> ${link.href}`);
            });
            
            // Сохраняем детальные результаты
            fs.writeFileSync('wolmar-category-links.json', JSON.stringify(categoryLinks, null, 2));
            console.log('💾 Детальные результаты сохранены в wolmar-category-links.json');
        } else {
            console.log('❌ Блок "Категории монет" не найден');
        }
        
    } catch (error) {
        console.error('❌ Ошибка при анализе категорий:', error);
    } finally {
        await cleanupChromeTempFiles();
        await browser.close();
    }
}

// Запускаем анализ
analyzeWolmarCategories().catch(console.error);

/**
 * Диагностический скрипт для анализа навигации Wolmar
 * 
 * Помогает понять структуру сайта и найти правильные селекторы для категорий
 */

const puppeteer = require('puppeteer-core');
const { launchPuppeteer, createPage } = require('./puppeteer-utils');

async function debugWolmarNavigation() {
    console.log('🔍 Диагностика навигации Wolmar...\n');
    
    let browser = null;
    let page = null;
    
    try {
        // Инициализация браузера
        browser = await launchPuppeteer();
        page = await createPage(browser);
        
        console.log('✅ Браузер инициализирован');
        
        // Переходим на главную страницу
        await page.goto('https://wolmar.ru', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        console.log('✅ Загружена главная страница Wolmar\n');
        
        // Анализируем структуру страницы
        const pageAnalysis = await page.evaluate(() => {
            const analysis = {
                allLinks: [],
                categoryLinks: [],
                navBlocks: [],
                menuItems: [],
                potentialCategories: []
            };
            
            // 1. Все ссылки на странице
            const allLinks = document.querySelectorAll('a[href]');
            allLinks.forEach(link => {
                const href = link.href;
                const text = link.textContent.trim();
                if (text && href) {
                    analysis.allLinks.push({
                        text: text,
                        href: href,
                        hasCategory: href.includes('category'),
                        hasAuction: href.includes('auction'),
                        hasMonety: href.includes('monety'),
                        hasBanknoty: href.includes('banknoty')
                    });
                }
            });
            
            // 2. Ссылки с параметром category
            const categoryLinks = document.querySelectorAll('a[href*="category"]');
            categoryLinks.forEach(link => {
                const href = link.href;
                const text = link.textContent.trim();
                if (text && href) {
                    analysis.categoryLinks.push({
                        text: text,
                        href: href
                    });
                }
            });
            
            // 3. Навигационные блоки
            const navSelectors = [
                '.nav', '.menu', '.categories', '.sidebar', 
                '.left-menu', '.right-menu', '.navigation',
                'nav', 'ul', '.list', '.links'
            ];
            
            navSelectors.forEach(selector => {
                const elements = document.querySelectorAll(selector);
                elements.forEach(element => {
                    const links = element.querySelectorAll('a');
                    if (links.length > 0) {
                        analysis.navBlocks.push({
                            selector: selector,
                            linksCount: links.length,
                            links: Array.from(links).map(link => ({
                                text: link.textContent.trim(),
                                href: link.href
                            }))
                        });
                    }
                });
            });
            
            // 4. Поиск потенциальных категорий
            const potentialSelectors = [
                'a[href*="monety"]',
                'a[href*="banknoty"]', 
                'a[href*="medali"]',
                'a[href*="znachki"]',
                'a[href*="jetony"]',
                'a[href*="ukrasheniya"]',
                'a[href*="category"]'
            ];
            
            potentialSelectors.forEach(selector => {
                const elements = document.querySelectorAll(selector);
                elements.forEach(element => {
                    const text = element.textContent.trim();
                    const href = element.href;
                    if (text && href) {
                        analysis.potentialCategories.push({
                            text: text,
                            href: href,
                            selector: selector
                        });
                    }
                });
            });
            
            return analysis;
        });
        
        // Выводим результаты анализа
        console.log('📊 АНАЛИЗ СТРАНИЦЫ:');
        console.log(`Всего ссылок: ${pageAnalysis.allLinks.length}`);
        console.log(`Ссылок с "category": ${pageAnalysis.categoryLinks.length}`);
        console.log(`Навигационных блоков: ${pageAnalysis.navBlocks.length}`);
        console.log(`Потенциальных категорий: ${pageAnalysis.potentialCategories.length}\n`);
        
        // Показываем ссылки с category
        if (pageAnalysis.categoryLinks.length > 0) {
            console.log('🔗 ССЫЛКИ С "CATEGORY":');
            pageAnalysis.categoryLinks.forEach((link, index) => {
                console.log(`   ${index + 1}. "${link.text}" → ${link.href}`);
            });
            console.log('');
        }
        
        // Показываем потенциальные категории
        if (pageAnalysis.potentialCategories.length > 0) {
            console.log('🎯 ПОТЕНЦИАЛЬНЫЕ КАТЕГОРИИ:');
            pageAnalysis.potentialCategories.forEach((item, index) => {
                console.log(`   ${index + 1}. "${item.text}" → ${item.href} (${item.selector})`);
            });
            console.log('');
        }
        
        // Показываем навигационные блоки
        if (pageAnalysis.navBlocks.length > 0) {
            console.log('🧭 НАВИГАЦИОННЫЕ БЛОКИ:');
            pageAnalysis.navBlocks.forEach((block, index) => {
                console.log(`   ${index + 1}. ${block.selector} (${block.linksCount} ссылок):`);
                block.links.slice(0, 5).forEach(link => {
                    console.log(`      - "${link.text}" → ${link.href}`);
                });
                if (block.links.length > 5) {
                    console.log(`      ... и еще ${block.links.length - 5} ссылок`);
                }
            });
            console.log('');
        }
        
        // Показываем примеры всех ссылок
        console.log('🔍 ПРИМЕРЫ ВСЕХ ССЫЛОК (первые 20):');
        pageAnalysis.allLinks.slice(0, 20).forEach((link, index) => {
            const flags = [];
            if (link.hasCategory) flags.push('CATEGORY');
            if (link.hasAuction) flags.push('AUCTION');
            if (link.hasMonety) flags.push('MONETY');
            if (link.hasBanknoty) flags.push('BANKNOTY');
            
            console.log(`   ${index + 1}. "${link.text}" → ${link.href} [${flags.join(', ')}]`);
        });
        
        if (pageAnalysis.allLinks.length > 20) {
            console.log(`   ... и еще ${pageAnalysis.allLinks.length - 20} ссылок`);
        }
        
        console.log('\n✅ Диагностика завершена!');
        
    } catch (error) {
        console.error('❌ Ошибка диагностики:', error.message);
        throw error;
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

// Запуск если файл вызван напрямую
if (require.main === module) {
    debugWolmarNavigation()
        .then(() => {
            console.log('✅ Диагностика завершена успешно');
            process.exit(0);
        })
        .catch((error) => {
            console.error('❌ Диагностика завершена с ошибкой:', error.message);
            process.exit(1);
        });
}

module.exports = { debugWolmarNavigation };

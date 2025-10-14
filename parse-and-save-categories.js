const { Pool } = require('pg');
const puppeteer = require('puppeteer');
const config = require('./config');

const pool = new Pool(config.dbConfig);

async function parseAndSaveCategories() {
    let browser = null;
    
    try {
        console.log('🚀 Запускаем браузер...');
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        
        console.log('🔍 Переходим на главную страницу Wolmar...');
        await page.goto('https://wolmar.ru', { waitUntil: 'networkidle2', timeout: 30000 });
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        console.log('📋 Ищем категории на странице...');
        const categories = await page.evaluate(() => {
            const foundCategories = [];
            
            // Ищем ссылки на категории в навигационном блоке
            const allLinks = document.querySelectorAll('a[href*="/auction/"]');
            allLinks.forEach(link => {
                const url = link.href;
                const name = link.textContent.trim();
                
                // Ищем ссылки на категории аукциона
                if (name && url && 
                    url.includes('/auction/') &&
                    !url.includes('?category=') &&
                    !url.includes('/lot/') &&
                    name.length > 3 &&
                    name.length < 100 &&
                    !name.includes('аукцион') &&
                    !name.includes('VIP') &&
                    !name.includes('№') &&
                    !name.includes('Все категории')) {
                    
                    // Извлекаем slug категории из URL
                    const urlParts = url.split('/');
                    if (urlParts.length > 3) {
                        const auctionNumber = urlParts[urlParts.length - 2];
                        const categorySlug = urlParts[urlParts.length - 1];
                        
                        // Проверяем, что это не просто номер аукциона
                        if (categorySlug && !categorySlug.match(/^\d+$/)) {
                            foundCategories.push({
                                name: name,
                                url_slug: categorySlug,
                                url_template: `https://wolmar.ru/auction/{AUCTION_NUMBER}/${categorySlug}`
                            });
                        }
                    }
                }
            });
            
            return foundCategories;
        });
        
        // Удаляем дубликаты по url_slug
        const uniqueCategories = categories.filter((category, index, self) => 
            index === self.findIndex(c => c.url_slug === category.url_slug)
        );
        
        console.log(`✅ Найдено ${uniqueCategories.length} уникальных категорий`);
        
        // Выводим найденные категории
        uniqueCategories.forEach((cat, index) => {
            console.log(`  ${index + 1}. ${cat.name} -> ${cat.url_slug}`);
        });
        
        // Сохраняем категории в базу данных
        console.log('\n💾 Сохраняем категории в базу данных...');
        
        for (const category of uniqueCategories) {
            try {
                const insertQuery = `
                    INSERT INTO wolmar_categories (name, url_slug, url_template)
                    VALUES ($1, $2, $3)
                    ON CONFLICT (url_slug) 
                    DO UPDATE SET 
                        name = EXCLUDED.name,
                        url_template = EXCLUDED.url_template,
                        updated_at = CURRENT_TIMESTAMP
                `;
                
                await pool.query(insertQuery, [category.name, category.url_slug, category.url_template]);
                console.log(`  ✅ Сохранена: ${category.name}`);
                
            } catch (error) {
                console.error(`  ❌ Ошибка сохранения ${category.name}:`, error.message);
            }
        }
        
        // Показываем итоговую статистику
        const countResult = await pool.query('SELECT COUNT(*) as count FROM wolmar_categories');
        console.log(`\n📊 Всего категорий в базе: ${countResult.rows[0].count}`);
        
    } catch (error) {
        console.error('❌ Ошибка парсинга категорий:', error);
    } finally {
        if (browser) {
            await browser.close();
        }
        await pool.end();
    }
}

parseAndSaveCategories();

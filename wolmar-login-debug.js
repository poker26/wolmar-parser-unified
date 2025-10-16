const { launchPuppeteer, createPage, cleanupChromeTempFiles } = require('./puppeteer-utils');
const fs = require('fs');

class WolmarLoginDebug {
    constructor() {
        this.browser = null;
        this.page = null;
        this.credentials = {
            username: 'hippo26',
            password: 'Gopapopa326'
        };
    }

    async init() {
        console.log('🚀 Запускаем браузер...');
        this.browser = await launchPuppeteer();
        this.page = await createPage(this.browser);
        
        // Устанавливаем размер окна
        await this.page.setViewport({ width: 1280, height: 720 });
        
        console.log('✅ Браузер инициализирован');
    }

    async debugPage() {
        try {
            console.log('🔍 Переходим на главную страницу Wolmar...');
            await this.page.goto('https://www.wolmar.ru/', {
                waitUntil: 'networkidle2',
                timeout: 30000
            });

            console.log('⏳ Ждем полной загрузки страницы...');
            await new Promise(resolve => setTimeout(resolve, 5000));

            // Делаем скриншот главной страницы
            await this.page.screenshot({ path: 'wolmar-homepage-debug.png', fullPage: true });
            console.log('📸 Скриншот главной страницы: wolmar-homepage-debug.png');

            // Получаем HTML страницы для анализа
            const pageContent = await this.page.content();
            fs.writeFileSync('wolmar-homepage.html', pageContent);
            console.log('📄 HTML страницы сохранен: wolmar-homepage.html');

            // Ищем все ссылки на странице
            console.log('🔍 Ищем все ссылки на странице...');
            const links = await this.page.evaluate(() => {
                const linkElements = document.querySelectorAll('a');
                return Array.from(linkElements).map(link => ({
                    text: link.textContent.trim(),
                    href: link.href,
                    className: link.className,
                    id: link.id
                })).filter(link => link.text && link.text.length > 0);
            });

            console.log('📋 Найденные ссылки:');
            links.forEach((link, index) => {
                if (link.text.toLowerCase().includes('автор') || 
                    link.text.toLowerCase().includes('войти') || 
                    link.text.toLowerCase().includes('login') ||
                    link.href.includes('login') ||
                    link.href.includes('auth')) {
                    console.log(`  ${index + 1}. "${link.text}" -> ${link.href} (class: ${link.className}, id: ${link.id})`);
                }
            });

            // Ищем все кнопки на странице
            console.log('🔍 Ищем все кнопки на странице...');
            const buttons = await this.page.evaluate(() => {
                const buttonElements = document.querySelectorAll('button, input[type="button"], input[type="submit"], input[type="image"]');
                return Array.from(buttonElements).map(button => ({
                    text: button.textContent?.trim() || button.value || button.alt || 'no text',
                    type: button.type,
                    className: button.className,
                    id: button.id,
                    name: button.name
                }));
            });

            console.log('🔘 Найденные кнопки:');
            buttons.forEach((button, index) => {
                if (button.text.toLowerCase().includes('автор') || 
                    button.text.toLowerCase().includes('войти') || 
                    button.text.toLowerCase().includes('login')) {
                    console.log(`  ${index + 1}. "${button.text}" (type: ${button.type}, class: ${button.className}, id: ${button.id}, name: ${button.name})`);
                }
            });

            // Ищем формы на странице
            console.log('🔍 Ищем все формы на странице...');
            const forms = await this.page.evaluate(() => {
                const formElements = document.querySelectorAll('form');
                return Array.from(formElements).map(form => ({
                    action: form.action,
                    method: form.method,
                    className: form.className,
                    id: form.id
                }));
            });

            console.log('📝 Найденные формы:');
            forms.forEach((form, index) => {
                console.log(`  ${index + 1}. action: ${form.action}, method: ${form.method} (class: ${form.className}, id: ${form.id})`);
            });

            // Ищем поля ввода
            console.log('🔍 Ищем все поля ввода на странице...');
            const inputs = await this.page.evaluate(() => {
                const inputElements = document.querySelectorAll('input');
                return Array.from(inputElements).map(input => ({
                    type: input.type,
                    name: input.name,
                    id: input.id,
                    className: input.className,
                    placeholder: input.placeholder
                }));
            });

            console.log('📝 Найденные поля ввода:');
            inputs.forEach((input, index) => {
                console.log(`  ${index + 1}. type: ${input.type}, name: ${input.name}, id: ${input.id} (class: ${input.className}, placeholder: ${input.placeholder})`);
            });

            // Попробуем найти элементы по различным селекторам
            console.log('🔍 Тестируем различные селекторы...');
            
            const selectors = [
                'a[href*="login"]',
                'a[href*="auth"]',
                'a:contains("Авторизация")',
                'a:contains("Войти")',
                'button:contains("Авторизация")',
                'button:contains("Войти")',
                'input[type="image"]',
                'form[action*="login"]',
                'input[name="login"]',
                'input[name="password"]'
            ];

            for (const selector of selectors) {
                try {
                    const elements = await this.page.$$(selector);
                    if (elements.length > 0) {
                        console.log(`✅ Селектор "${selector}" найден ${elements.length} элементов`);
                    } else {
                        console.log(`❌ Селектор "${selector}" не найден`);
                    }
                } catch (e) {
                    console.log(`❌ Селектор "${selector}" вызвал ошибку: ${e.message}`);
                }
            }

            // Попробуем найти по XPath
            console.log('🔍 Тестируем XPath селекторы...');
            const xpathSelectors = [
                '//a[contains(text(), "Авторизация")]',
                '//a[contains(text(), "Войти")]',
                '//button[contains(text(), "Авторизация")]',
                '//button[contains(text(), "Войти")]',
                '//input[@type="image"]',
                '//form[@action]',
                '//input[@name="login"]',
                '//input[@name="password"]'
            ];

            for (const xpath of xpathSelectors) {
                try {
                    const elements = await this.page.$x(xpath);
                    if (elements.length > 0) {
                        console.log(`✅ XPath "${xpath}" найден ${elements.length} элементов`);
                    } else {
                        console.log(`❌ XPath "${xpath}" не найден`);
                    }
                } catch (e) {
                    console.log(`❌ XPath "${xpath}" вызвал ошибку: ${e.message}`);
                }
            }

            return true;

        } catch (error) {
            console.error('❌ Ошибка при анализе страницы:', error.message);
            await this.page.screenshot({ path: 'wolmar-debug-error.png', fullPage: true });
            return false;
        }
    }

    async close() {
        if (this.browser) {
            await this.browser.close();
            console.log('🔒 Браузер закрыт');
        }
        
        // Очищаем временные файлы Chrome
        cleanupChromeTempFiles();
    }
}

// Основная функция
async function main() {
    const debug = new WolmarLoginDebug();
    
    try {
        await debug.init();
        const success = await debug.debugPage();
        
        if (success) {
            console.log('✅ Анализ страницы завершен успешно!');
            console.log('📸 Файлы для анализа:');
            console.log('  - wolmar-homepage-debug.png (скриншот)');
            console.log('  - wolmar-homepage.html (HTML код)');
        } else {
            console.log('❌ Анализ страницы не удался');
        }
        
    } catch (error) {
        console.error('❌ Критическая ошибка:', error);
    } finally {
        await debug.close();
    }
}

// Запускаем скрипт
if (require.main === module) {
    main().catch(console.error);
}

module.exports = WolmarLoginDebug;

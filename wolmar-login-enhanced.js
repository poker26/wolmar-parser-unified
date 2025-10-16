const { launchPuppeteer, createPage, cleanupChromeTempFiles } = require('./puppeteer-utils');
const fs = require('fs');

class WolmarLoginEnhanced {
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

    async findLoginButton() {
        console.log('🔍 Ищем кнопку входа...');
        
        // Список возможных селекторов для кнопки входа
        const loginSelectors = [
            // По тексту "Авторизация"
            '//a[contains(text(), "Авторизация")]',
            '//button[contains(text(), "Авторизация")]',
            '//*[contains(text(), "Авторизация")]',
            
            // По тексту "Войти"
            '//a[contains(text(), "Войти")]',
            '//button[contains(text(), "Войти")]',
            '//*[contains(text(), "Войти")]',
            
            // По href
            '//a[contains(@href, "login")]',
            '//a[contains(@href, "auth")]',
            
            // По классам и ID
            '//a[contains(@class, "login")]',
            '//a[contains(@class, "auth")]',
            '//button[contains(@class, "login")]',
            '//button[contains(@class, "auth")]',
            
            // CSS селекторы
            'a[href*="login"]',
            'a[href*="auth"]',
            'button[class*="login"]',
            'button[class*="auth"]',
            '.login-btn',
            '.auth-btn',
            '#login-btn',
            '#auth-btn'
        ];

        for (const selector of loginSelectors) {
            try {
                let elements;
                
                if (selector.startsWith('//')) {
                    // XPath селектор
                    elements = await this.page.$x(selector);
                } else {
                    // CSS селектор
                    elements = await this.page.$$(selector);
                }
                
                if (elements.length > 0) {
                    console.log(`✅ Кнопка входа найдена по селектору: ${selector}`);
                    return elements[0];
                }
            } catch (e) {
                // Игнорируем ошибки селекторов
            }
        }

        console.log('❌ Кнопка входа не найдена ни по одному селектору');
        return null;
    }

    async findFormFields() {
        console.log('🔍 Ищем поля формы входа...');
        
        // Ищем поле логина
        const usernameSelectors = [
            'input[name="login"]',
            'input[name="username"]',
            'input[name="email"]',
            'input[type="text"]',
            '#username',
            '#login',
            '#email'
        ];

        let usernameField = null;
        for (const selector of usernameSelectors) {
            try {
                usernameField = await this.page.$(selector);
                if (usernameField) {
                    console.log(`✅ Поле логина найдено: ${selector}`);
                    break;
                }
            } catch (e) {
                // Игнорируем ошибки
            }
        }

        // Ищем поле пароля
        const passwordSelectors = [
            'input[name="password"]',
            'input[type="password"]',
            '#password'
        ];

        let passwordField = null;
        for (const selector of passwordSelectors) {
            try {
                passwordField = await this.page.$(selector);
                if (passwordField) {
                    console.log(`✅ Поле пароля найдено: ${selector}`);
                    break;
                }
            } catch (e) {
                // Игнорируем ошибки
            }
        }

        return { usernameField, passwordField };
    }

    async findSubmitButton() {
        console.log('🔍 Ищем кнопку отправки формы...');
        
        const submitSelectors = [
            'input[type="image"]',
            'input[type="submit"]',
            'button[type="submit"]',
            'button:contains("Войти")',
            'button:contains("Login")',
            'button:contains("Отправить")',
            'button:contains("Submit")',
            '.submit-btn',
            '#submit-btn'
        ];

        for (const selector of submitSelectors) {
            try {
                const button = await this.page.$(selector);
                if (button) {
                    console.log(`✅ Кнопка отправки найдена: ${selector}`);
                    return button;
                }
            } catch (e) {
                // Игнорируем ошибки
            }
        }

        // Попробуем найти по XPath
        const xpathSelectors = [
            '//input[@type="image"]',
            '//input[@type="submit"]',
            '//button[@type="submit"]',
            '//button[contains(text(), "Войти")]',
            '//button[contains(text(), "Login")]',
            '//input[@type="image" and contains(@src, "go")]'
        ];

        for (const xpath of xpathSelectors) {
            try {
                const elements = await this.page.$x(xpath);
                if (elements.length > 0) {
                    console.log(`✅ Кнопка отправки найдена по XPath: ${xpath}`);
                    return elements[0];
                }
            } catch (e) {
                // Игнорируем ошибки
            }
        }

        console.log('❌ Кнопка отправки не найдена');
        return null;
    }

    async login() {
        try {
            console.log('🔍 Переходим на главную страницу Wolmar...');
            await this.page.goto('https://www.wolmar.ru/', {
                waitUntil: 'networkidle2',
                timeout: 30000
            });

            // Ждем загрузки страницы
            await new Promise(resolve => setTimeout(resolve, 3000));

            // Делаем скриншот главной страницы
            await this.page.screenshot({ path: 'wolmar-homepage-enhanced.png', fullPage: true });
            console.log('📸 Скриншот главной страницы: wolmar-homepage-enhanced.png');

            // Ищем кнопку входа
            const loginButton = await this.findLoginButton();
            if (!loginButton) {
                console.log('❌ Кнопка входа не найдена');
                return false;
            }

            console.log('🖱️ Нажимаем на кнопку входа...');
            await loginButton.click();

            // Ждем загрузки формы входа
            await new Promise(resolve => setTimeout(resolve, 3000));

            // Делаем скриншот формы входа
            await this.page.screenshot({ path: 'wolmar-login-form-enhanced.png', fullPage: true });
            console.log('📸 Скриншот формы входа: wolmar-login-form-enhanced.png');

            // Ищем поля формы
            const { usernameField, passwordField } = await this.findFormFields();
            
            if (!usernameField || !passwordField) {
                console.log('❌ Поля формы входа не найдены');
                return false;
            }

            console.log('📝 Заполняем форму входа...');
            await usernameField.type(this.credentials.username);
            await passwordField.type(this.credentials.password);

            // Делаем скриншот заполненной формы
            await this.page.screenshot({ path: 'wolmar-form-filled-enhanced.png', fullPage: true });
            console.log('📸 Скриншот заполненной формы: wolmar-form-filled-enhanced.png');

            // Ищем кнопку отправки
            const submitButton = await this.findSubmitButton();
            if (!submitButton) {
                console.log('❌ Кнопка отправки не найдена');
                return false;
            }

            console.log('🚀 Отправляем форму входа...');
            await submitButton.click();

            // Ждем обработки формы
            await new Promise(resolve => setTimeout(resolve, 5000));

            console.log('🔍 Проверяем результат входа...');
            
            // Проверяем, успешен ли вход
            const currentUrl = this.page.url();
            console.log(`📍 Текущий URL: ${currentUrl}`);

            // Ищем элементы, которые появляются после успешного входа
            const successIndicators = [
                'Личный кабинет',
                'Лоты текущего аукциона',
                'История выигрышей',
                'Лоты предыдущих аукционов',
                'Данные пользователя',
                'Выход',
                'logout',
                'profile'
            ];

            let loginSuccess = false;
            for (const indicator of successIndicators) {
                try {
                    const elements = await this.page.$x(`//*[contains(text(), '${indicator}')]`);
                    if (elements.length > 0) {
                        console.log(`✅ Найден индикатор успешного входа: "${indicator}"`);
                        loginSuccess = true;
                        break;
                    }
                } catch (e) {
                    // Игнорируем ошибки
                }
            }

            if (loginSuccess) {
                console.log('✅ Вход успешен!');
                await this.page.screenshot({ path: 'wolmar-logged-in-enhanced.png', fullPage: true });
                console.log('📸 Скриншот после входа: wolmar-logged-in-enhanced.png');
                
                // Сохраняем cookies
                const cookies = await this.page.cookies();
                fs.writeFileSync('wolmar-cookies-enhanced.json', JSON.stringify(cookies, null, 2));
                console.log('🍪 Cookies сохранены в wolmar-cookies-enhanced.json');
                return true;
            } else {
                console.log('❌ Вход не удался. Индикаторы успешного входа не найдены.');
                await this.page.screenshot({ path: 'wolmar-login-failed-enhanced.png', fullPage: true });
                console.log('📸 Скриншот неудачного входа: wolmar-login-failed-enhanced.png');
                return false;
            }

        } catch (error) {
            console.error('❌ Ошибка при входе:', error);
            await this.page.screenshot({ path: 'wolmar-error-enhanced.png', fullPage: true });
            console.log('📸 Скриншот ошибки: wolmar-error-enhanced.png');
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
    const loginTest = new WolmarLoginEnhanced();
    
    try {
        await loginTest.init();
        const success = await loginTest.login();
        
        if (success) {
            console.log('🎉 Тест входа успешно завершен!');
        } else {
            console.log('❌ Тест входа не удался');
        }
        
    } catch (error) {
        console.error('❌ Критическая ошибка:', error);
    } finally {
        await loginTest.close();
    }
}

// Запускаем скрипт
if (require.main === module) {
    main().catch(console.error);
}

module.exports = WolmarLoginEnhanced;

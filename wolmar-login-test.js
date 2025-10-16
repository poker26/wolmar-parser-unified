const { launchPuppeteer, createPage, cleanupChromeTempFiles } = require('./puppeteer-utils');
const fs = require('fs');

class WolmarLoginTest {
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

    async login() {
        try {
            console.log('🔍 Переходим на главную страницу Wolmar...');
            await this.page.goto('https://www.wolmar.ru/', {
                waitUntil: 'networkidle2',
                timeout: 30000
            });

            console.log('🔍 Ищем кнопку входа...');
            
            // Ждем загрузки страницы
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Ищем кнопку входа - приоритет на "Авторизация"
            let loginButton = null;
            
            // Сначала ищем по тексту "Авторизация" (приоритетный)
            console.log('🔍 Ищем кнопку входа по тексту "Авторизация"...');
            try {
                const [element] = await this.page.$x('//a[contains(text(), "Авторизация")] | //button[contains(text(), "Авторизация")] | //*[contains(text(), "Авторизация")]');
                if (element) {
                    loginButton = element;
                    console.log('✅ Кнопка входа найдена по тексту "Авторизация"');
                }
            } catch (e) {
                console.log('❌ Не удалось найти по тексту "Авторизация"');
            }
            
            // Если не найдено, пробуем другие селекторы
            if (!loginButton) {
                const loginSelectors = [
                    'a[href*="login"]',
                    'a[href*="auth"]',
                    'button:contains("Войти")',
                    'a:contains("Войти")',
                    '.login-btn',
                    '#login-btn',
                    '[data-login]'
                ];

            for (const selector of loginSelectors) {
                try {
                    loginButton = await this.page.$(selector);
                    if (loginButton) {
                        console.log(`✅ Найдена кнопка входа с селектором: ${selector}`);
                        break;
                    }
                } catch (e) {
                    // Игнорируем ошибки селекторов
                }
            }

            if (!loginButton) {
                // Попробуем найти по тексту
                console.log('🔍 Ищем кнопку входа по тексту...');
                const loginTexts = ['Авторизация', 'Войти', 'Вход', 'Login', 'Sign in'];
                
                for (const text of loginTexts) {
                    try {
                        const [element] = await this.page.$x(`//a[contains(text(), '${text}')] | //button[contains(text(), '${text}')]`);
                        if (element) {
                            loginButton = element;
                            console.log(`✅ Найдена кнопка входа по тексту: ${text}`);
                            break;
                        }
                    } catch (e) {
                        // Игнорируем ошибки
                    }
                }
            }

            if (!loginButton) {
                console.log('❌ Кнопка входа не найдена. Делаем скриншот...');
                await this.page.screenshot({ path: 'wolmar-homepage.png', fullPage: true });
                throw new Error('Кнопка входа не найдена');
            }

            console.log('🖱️ Нажимаем на кнопку входа...');
            await loginButton.click();

            // Ждем загрузки формы входа
            await new Promise(resolve => setTimeout(resolve, 3000));

            console.log('🔍 Ищем поля формы входа...');
            
            // Ищем поля username и password (специфично для Wolmar)
            const usernameSelectors = [
                'input[name="login"]',  // Wolmar использует name="login"
                'input[name="username"]',
                'input[name="email"]',
                'input[type="text"]',
                '#username',
                '#login',
                '#email'
            ];

            const passwordSelectors = [
                'input[name="password"]',  // Wolmar использует name="password"
                'input[type="password"]',
                '#password'
            ];

            let usernameField = null;
            let passwordField = null;

            for (const selector of usernameSelectors) {
                try {
                    usernameField = await this.page.$(selector);
                    if (usernameField) {
                        console.log(`✅ Найдено поле username с селектором: ${selector}`);
                        break;
                    }
                } catch (e) {
                    // Игнорируем ошибки
                }
            }

            for (const selector of passwordSelectors) {
                try {
                    passwordField = await this.page.$(selector);
                    if (passwordField) {
                        console.log(`✅ Найдено поле password с селектором: ${selector}`);
                        break;
                    }
                } catch (e) {
                    // Игнорируем ошибки
                }
            }

            if (!usernameField || !passwordField) {
                console.log('❌ Поля формы входа не найдены. Делаем скриншот...');
                await this.page.screenshot({ path: 'wolmar-login-form.png', fullPage: true });
                throw new Error('Поля формы входа не найдены');
            }

            console.log('📝 Заполняем форму входа...');
            await usernameField.type(this.credentials.username);
            await passwordField.type(this.credentials.password);

            console.log('🔍 Ищем кнопку отправки формы...');
            
            // Ищем кнопку отправки (специфично для Wolmar)
            const submitSelectors = [
                'input[type="image"]',  // Wolmar использует input type="image"
                'button[type="submit"]',
                'input[type="submit"]',
                'button:contains("Войти")',
                'button:contains("Login")',
                'button:contains("Sign in")',
                '.submit-btn',
                '#submit-btn'
            ];

            let submitButton = null;
            for (const selector of submitSelectors) {
                try {
                    submitButton = await this.page.$(selector);
                    if (submitButton) {
                        console.log(`✅ Найдена кнопка отправки с селектором: ${selector}`);
                        break;
                    }
                } catch (e) {
                    // Игнорируем ошибки
                }
            }

            if (!submitButton) {
                // Попробуем найти по тексту или по атрибутам
                const submitTexts = ['Войти', 'Login', 'Sign in', 'Отправить', 'Submit'];
                for (const text of submitTexts) {
                    try {
                        const [element] = await this.page.$x(`//button[contains(text(), '${text}')] | //input[@type='submit' and @value='${text}'] | //input[@type='image']`);
                        if (element) {
                            submitButton = element;
                            console.log(`✅ Найдена кнопка отправки по тексту: ${text}`);
                            break;
                        }
                    } catch (e) {
                        // Игнорируем ошибки
                    }
                }
            }

            if (!submitButton) {
                console.log('❌ Кнопка отправки не найдена. Делаем скриншот...');
                await this.page.screenshot({ path: 'wolmar-login-form-filled.png', fullPage: true });
                throw new Error('Кнопка отправки не найдена');
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
                    const element = await this.page.$x(`//*[contains(text(), '${indicator}')]`);
                    if (element.length > 0) {
                        console.log(`✅ Найден индикатор успешного входа: ${indicator}`);
                        loginSuccess = true;
                        break;
                    }
                } catch (e) {
                    // Игнорируем ошибки
                }
            }

            if (loginSuccess) {
                console.log('🎉 ВХОД УСПЕШЕН!');
                await this.page.screenshot({ path: 'wolmar-logged-in.png', fullPage: true });
                
                // Сохраняем cookies для дальнейшего использования
                const cookies = await this.page.cookies();
                fs.writeFileSync('wolmar-cookies.json', JSON.stringify(cookies, null, 2));
                console.log('🍪 Cookies сохранены в wolmar-cookies.json');
                
                return true;
            } else {
                console.log('❌ Вход не удался. Делаем скриншот...');
                await this.page.screenshot({ path: 'wolmar-login-failed.png', fullPage: true });
                return false;
            }

        } catch (error) {
            console.error('❌ Ошибка при входе:', error.message);
            await this.page.screenshot({ path: 'wolmar-error.png', fullPage: true });
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
    const loginTest = new WolmarLoginTest();
    
    try {
        await loginTest.init();
        const success = await loginTest.login();
        
        if (success) {
            console.log('✅ Тест входа завершен успешно!');
            console.log('📸 Скриншоты сохранены:');
            console.log('  - wolmar-logged-in.png (успешный вход)');
            console.log('  - wolmar-cookies.json (cookies для повторного использования)');
        } else {
            console.log('❌ Тест входа не удался');
            console.log('📸 Скриншоты для анализа:');
            console.log('  - wolmar-homepage.png (главная страница)');
            console.log('  - wolmar-login-form.png (форма входа)');
            console.log('  - wolmar-login-form-filled.png (заполненная форма)');
            console.log('  - wolmar-login-failed.png (неудачный вход)');
            console.log('  - wolmar-error.png (ошибка)');
        }
        
        // Ждем 5 секунд перед закрытием браузера
        console.log('⏳ Ждем 5 секунд перед закрытием браузера...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        
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

module.exports = WolmarLoginTest;

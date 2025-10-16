const { launchPuppeteer, createPage, cleanupChromeTempFiles } = require('./puppeteer-utils');
const fs = require('fs');

class WolmarBidPlacer {
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

            // Ждем загрузки страницы
            await new Promise(resolve => setTimeout(resolve, 3000));

            console.log('🔍 Ищем поля формы авторизации...');
            
            // Ищем поля по точным селекторам из кода формы
            const usernameField = await this.page.$('input[name="login"]');
            const passwordField = await this.page.$('input[name="password"]');
            
            if (!usernameField || !passwordField) {
                console.log('❌ Поля формы авторизации не найдены');
                return false;
            }

            console.log('✅ Поля формы найдены');
            console.log('📝 Заполняем форму авторизации...');
            
            await usernameField.type(this.credentials.username);
            await passwordField.type(this.credentials.password);

            console.log('🔍 Ищем кнопку отправки...');
            
            // Ищем кнопку отправки (input type="image")
            const submitButton = await this.page.$('input[type="image"]');
            
            if (!submitButton) {
                console.log('❌ Кнопка отправки не найдена');
                return false;
            }

            console.log('✅ Кнопка отправки найдена');
            console.log('🚀 Отправляем форму авторизации...');
            await submitButton.click();

            // Ждем обработки
            await new Promise(resolve => setTimeout(resolve, 5000));

            console.log('🔍 Проверяем результат авторизации...');
            
            // Проверяем успешность входа
            const pageContent = await this.page.content();
            const successIndicators = [
                'Личный кабинет',
                'Лоты текущего аукциона',
                'История выигрышей',
                'Выход'
            ];

            const isLoggedIn = successIndicators.some(indicator => pageContent.includes(indicator));

            if (isLoggedIn) {
                console.log('✅ Авторизация успешна!');
                return true;
            } else {
                console.log('❌ Авторизация не удалась');
                return false;
            }

        } catch (error) {
            console.error('❌ Ошибка при авторизации:', error.message);
            return false;
        }
    }

    async placeBid(lotUrl, bidAmount, useAutoBid = false) {
        try {
            console.log(`🔍 Переходим на страницу лота: ${lotUrl}`);
            await this.page.goto(lotUrl, {
                waitUntil: 'networkidle2',
                timeout: 30000
            });

            // Ждем загрузки страницы
            await new Promise(resolve => setTimeout(resolve, 3000));

            // Делаем скриншот страницы лота
            await this.page.screenshot({ path: 'wolmar-lot-page.png', fullPage: true });
            console.log('📸 Скриншот страницы лота: wolmar-lot-page.png');

            console.log('🔍 Ищем информацию о ставках...');
            
            // Получаем текущую ставку
            const currentBid = await this.page.evaluate(() => {
                const sumElement = document.getElementById('sum');
                return sumElement ? sumElement.textContent.trim() : null;
            });

            // Получаем минимальную ставку
            const minBid = await this.page.evaluate(() => {
                const minBidElement = document.getElementById('min_bid');
                return minBidElement ? minBidElement.textContent.trim() : null;
            });

            console.log(`📊 Текущая ставка: ${currentBid} руб.`);
            console.log(`📊 Минимальная ставка: ${minBid} руб.`);

            // 🚨 БЕЗОПАСНОСТЬ: В тестовом режиме используем ТОЛЬКО минимальную ставку!
            const safeBidAmount = parseInt(minBid) || 2;
            if (bidAmount !== safeBidAmount) {
                console.log(`⚠️  ВНИМАНИЕ: Запрошенная ставка ${bidAmount} руб. заменена на безопасную минимальную ставку ${safeBidAmount} руб.`);
            }
            const finalBidAmount = safeBidAmount;

            // Проверяем, есть ли форма ставки (только для авторизованных пользователей)
            const bidForm = await this.page.$('form#bid');
            
            if (!bidForm) {
                console.log('❌ Форма ставки не найдена. Возможно, вы не авторизованы или лот закрыт');
                return false;
            }

            console.log('✅ Форма ставки найдена');

            // Ищем поле для ввода ставки
            const bidInput = await this.page.$('input[name="value"]');
            
            if (!bidInput) {
                console.log('❌ Поле для ввода ставки не найдено');
                return false;
            }

            console.log('✅ Поле для ввода ставки найдено');
            console.log(`💰 Размещаем БЕЗОПАСНУЮ ставку: ${finalBidAmount} руб.`);

            // Очищаем поле и вводим новую ставку
            await bidInput.click();
            await bidInput.evaluate(input => input.select());
            await bidInput.type(finalBidAmount.toString());

            // Если нужно, включаем автобид
            if (useAutoBid) {
                console.log('🤖 Включаем автобид...');
                const autoBidCheckbox = await this.page.$('input[name="auto"]');
                if (autoBidCheckbox) {
                    const isChecked = await autoBidCheckbox.evaluate(cb => cb.checked);
                    if (!isChecked) {
                        await autoBidCheckbox.click();
                        console.log('✅ Автобид включен');
                    }
                }
            }

            // Делаем скриншот заполненной формы
            await this.page.screenshot({ path: 'wolmar-bid-form-filled.png', fullPage: true });
            console.log('📸 Скриншот заполненной формы: wolmar-bid-form-filled.png');

            // Ищем кнопку отправки ставки
            const submitButton = await this.page.$('input[type="submit"][value="сделать ставку"]');
            
            if (!submitButton) {
                console.log('❌ Кнопка отправки ставки не найдена');
                return false;
            }

            console.log('✅ Кнопка отправки найдена');
            console.log('🚀 Отправляем ставку...');
            
            // Отправляем форму
            await submitButton.click();

            // Ждем обработки ставки
            await new Promise(resolve => setTimeout(resolve, 5000));

            console.log('🔍 Проверяем результат размещения ставки...');
            
            // Делаем скриншот после отправки
            await this.page.screenshot({ path: 'wolmar-bid-result.png', fullPage: true });
            console.log('📸 Скриншот результата: wolmar-bid-result.png');

            // Проверяем, успешно ли размещена ставка
            const pageContent = await this.page.content();
            
            if (pageContent.includes('Ваша ставка') || pageContent.includes('ставка принята')) {
                console.log('✅ Ставка успешно размещена!');
                return true;
            } else {
                console.log('❌ Ставка не была размещена');
                return false;
            }

        } catch (error) {
            console.error('❌ Ошибка при размещении ставки:', error.message);
            await this.page.screenshot({ path: 'wolmar-bid-error.png', fullPage: true });
            return false;
        }
    }

    async close() {
        if (this.browser) {
            await this.browser.close();
            console.log('🔒 Браузер закрыт');
        }
        cleanupChromeTempFiles();
    }
}

// Основная функция
async function main() {
    const bidPlacer = new WolmarBidPlacer();
    
    try {
        await bidPlacer.init();
        
        // Авторизуемся
        const loginSuccess = await bidPlacer.login();
        if (!loginSuccess) {
            console.log('❌ Не удалось авторизоваться');
            return;
        }

        // Размещаем ставку на тестовом лоте
        const lotUrl = 'https://www.wolmar.ru/auction/2140/7609081';
        const bidAmount = 2; // ТОЛЬКО минимальная ставка 2 рубля для безопасности!
        const useAutoBid = false; // Без автобида для теста

        console.log(`🎯 Размещаем ставку ${bidAmount} руб. на лот: ${lotUrl}`);
        
        const bidSuccess = await bidPlacer.placeBid(lotUrl, bidAmount, useAutoBid);
        
        if (bidSuccess) {
            console.log('🎉 Ставка размещена успешно!');
        } else {
            console.log('❌ Не удалось разместить ставку');
        }
        
    } catch (error) {
        console.error('❌ Критическая ошибка:', error);
    } finally {
        await bidPlacer.close();
    }
}

// Запускаем скрипт
if (require.main === module) {
    main().catch(console.error);
}

module.exports = WolmarBidPlacer;

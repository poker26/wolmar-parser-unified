const { launchPuppeteer, createPage, cleanupChromeTempFiles } = require('./puppeteer-utils');
const fs = require('fs');

class WolmarBidPlacerCLI {
    constructor(options = {}) {
        this.browser = null;
        this.page = null;
        this.credentials = {
            username: options.username || 'hippo26',
            password: options.password || 'Gopapopa326'
        };
        this.lotUrl = options.lotUrl;
        this.bidAmount = options.bidAmount;
        this.useAutoBid = options.useAutoBid || false;
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

            await new Promise(resolve => setTimeout(resolve, 3000));

            console.log('🔍 Ищем поля формы авторизации...');
            
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

            const submitButton = await this.page.$('input[type="image"]');
            
            if (!submitButton) {
                console.log('❌ Кнопка отправки не найдена');
                return false;
            }

            console.log('🚀 Отправляем форму авторизации...');
            await submitButton.click();

            await new Promise(resolve => setTimeout(resolve, 5000));

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

    async placeBid() {
        try {
            console.log(`🔍 Переходим на страницу лота: ${this.lotUrl}`);
            await this.page.goto(this.lotUrl, {
                waitUntil: 'networkidle2',
                timeout: 30000
            });

            await new Promise(resolve => setTimeout(resolve, 3000));

            console.log('🔍 Ищем информацию о ставках...');
            
            const currentBid = await this.page.evaluate(() => {
                const sumElement = document.getElementById('sum');
                return sumElement ? sumElement.textContent.trim() : null;
            });

            const minBid = await this.page.evaluate(() => {
                const minBidElement = document.getElementById('min_bid');
                return minBidElement ? minBidElement.textContent.trim() : null;
            });

            console.log(`📊 Текущая ставка: ${currentBid} руб.`);
            console.log(`📊 Минимальная ставка: ${minBid} руб.`);

            // 🚨 БЕЗОПАСНОСТЬ: В тестовом режиме используем ТОЛЬКО минимальную ставку!
            const safeBidAmount = parseInt(minBid) || 2;
            if (this.bidAmount !== safeBidAmount) {
                console.log(`⚠️  ВНИМАНИЕ: Запрошенная ставка ${this.bidAmount} руб. заменена на безопасную минимальную ставку ${safeBidAmount} руб.`);
            }
            const finalBidAmount = safeBidAmount;

            const bidForm = await this.page.$('form#bid');
            
            if (!bidForm) {
                console.log('❌ Форма ставки не найдена');
                return false;
            }

            console.log('✅ Форма ставки найдена');

            const bidInput = await this.page.$('input[name="value"]');
            
            if (!bidInput) {
                console.log('❌ Поле для ввода ставки не найдено');
                return false;
            }

            console.log(`💰 Размещаем БЕЗОПАСНУЮ ставку: ${finalBidAmount} руб.`);

            await bidInput.click();
            await bidInput.evaluate(input => input.select());
            await bidInput.type(finalBidAmount.toString());

            if (this.useAutoBid) {
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

            const submitButton = await this.page.$('input[type="submit"][value="сделать ставку"]');
            
            if (!submitButton) {
                console.log('❌ Кнопка отправки ставки не найдена');
                return false;
            }

            console.log('🚀 Отправляем ставку...');
            await submitButton.click();

            await new Promise(resolve => setTimeout(resolve, 5000));

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

// Парсинг аргументов командной строки
function parseArgs() {
    const args = process.argv.slice(2);
    const options = {};

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--url':
                options.lotUrl = args[++i];
                break;
            case '--amount':
                options.bidAmount = parseInt(args[++i]);
                break;
            case '--auto-bid':
                options.useAutoBid = true;
                break;
            case '--username':
                options.username = args[++i];
                break;
            case '--password':
                options.password = args[++i];
                break;
            case '--help':
                console.log(`
Использование: node wolmar-bid-placer-cli.js [опции]

Опции:
  --url <URL>        URL лота для размещения ставки
  --amount <сумма>   Сумма ставки в рублях
  --auto-bid         Включить автобид
  --username <логин> Логин для входа (по умолчанию: hippo26)
  --password <пароль> Пароль для входа
  --help             Показать эту справку

Примеры:
  node wolmar-bid-placer-cli.js --url "https://www.wolmar.ru/auction/2140/7609081" --amount 5
  node wolmar-bid-placer-cli.js --url "https://www.wolmar.ru/auction/2140/7609081" --amount 10 --auto-bid
                `);
                process.exit(0);
                break;
        }
    }

    return options;
}

// Основная функция
async function main() {
    console.log('🚨 ВНИМАНИЕ: ТЕСТОВЫЙ РЕЖИМ - БЕЗОПАСНОСТЬ ПРЕВЫШЕ ВСЕГО!');
    console.log('🚨 Скрипт будет ставить ТОЛЬКО минимальную ставку независимо от указанной суммы!');
    console.log('');

    const options = parseArgs();

    if (!options.lotUrl || !options.bidAmount) {
        console.log('❌ Ошибка: необходимо указать --url и --amount');
        console.log('Используйте --help для справки');
        process.exit(1);
    }

    const bidPlacer = new WolmarBidPlacerCLI(options);
    
    try {
        await bidPlacer.init();
        
        const loginSuccess = await bidPlacer.login();
        if (!loginSuccess) {
            console.log('❌ Не удалось авторизоваться');
            return;
        }

        const bidSuccess = await bidPlacer.placeBid();
        
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

module.exports = WolmarBidPlacerCLI;

const { launchPuppeteer, createPage, cleanupChromeTempFiles } = require('./puppeteer-utils');
const readline = require('readline');

class WolmarBidInteractive {
    constructor() {
        this.browser = null;
        this.page = null;
        this.credentials = {
            username: 'hippo26',
            password: 'Gopapopa326'
        };
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
    }

    async init() {
        console.log('🚀 Запускаем браузер...');
        this.browser = await launchPuppeteer();
        this.page = await createPage(this.browser);
        
        await this.page.setViewport({ width: 1280, height: 720 });
        console.log('✅ Браузер инициализирован');
    }

    async askQuestion(question) {
        return new Promise((resolve) => {
            this.rl.question(question, (answer) => {
                resolve(answer.trim());
            });
        });
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

    async analyzeLot(lotUrl) {
        try {
            console.log(`🔍 Переходим на страницу лота: ${lotUrl}`);
            await this.page.goto(lotUrl, {
                waitUntil: 'networkidle2',
                timeout: 30000
            });

            await new Promise(resolve => setTimeout(resolve, 3000));

            console.log('🔍 Анализируем информацию о лоте...');
            
            const lotInfo = await this.page.evaluate(() => {
                const currentBid = document.getElementById('sum')?.textContent?.trim();
                const minBid = document.getElementById('min_bid')?.textContent?.trim();
                const lotTitle = document.querySelector('h1, h2, .lot-title')?.textContent?.trim();
                const auctionInfo = document.querySelector('.auction-info, .breadcrumb')?.textContent?.trim();
                
                return {
                    currentBid,
                    minBid,
                    lotTitle: lotTitle || 'Информация о лоте не найдена',
                    auctionInfo: auctionInfo || 'Информация об аукционе не найдена'
                };
            });

            console.log('📊 Информация о лоте:');
            console.log(`   Название: ${lotInfo.lotTitle}`);
            console.log(`   Аукцион: ${lotInfo.auctionInfo}`);
            console.log(`   Текущая ставка: ${lotInfo.currentBid} руб.`);
            console.log(`   Минимальная ставка: ${lotInfo.minBid} руб.`);

            return lotInfo;

        } catch (error) {
            console.error('❌ Ошибка при анализе лота:', error.message);
            return null;
        }
    }

    async placeBid(lotUrl, bidAmount, useAutoBid = false) {
        try {
            console.log(`🔍 Переходим на страницу лота: ${lotUrl}`);
            await this.page.goto(lotUrl, {
                waitUntil: 'networkidle2',
                timeout: 30000
            });

            await new Promise(resolve => setTimeout(resolve, 3000));

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
            if (bidAmount !== safeBidAmount) {
                console.log(`⚠️  ВНИМАНИЕ: Запрошенная ставка ${bidAmount} руб. заменена на безопасную минимальную ставку ${safeBidAmount} руб.`);
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
        this.rl.close();
        cleanupChromeTempFiles();
    }
}

// Основная функция
async function main() {
    console.log('🚨 ВНИМАНИЕ: ИНТЕРАКТИВНЫЙ РЕЖИМ РАЗМЕЩЕНИЯ СТАВОК');
    console.log('🚨 БЕЗОПАСНОСТЬ ПРЕВЫШЕ ВСЕГО - ТОЛЬКО МИНИМАЛЬНЫЕ СТАВКИ!');
    console.log('');

    const bidPlacer = new WolmarBidInteractive();
    
    try {
        await bidPlacer.init();
        
        // Авторизуемся
        const loginSuccess = await bidPlacer.login();
        if (!loginSuccess) {
            console.log('❌ Не удалось авторизоваться');
            return;
        }

        // Запрашиваем URL лота
        const lotUrl = await bidPlacer.askQuestion('🔗 Введите URL лота: ');
        
        if (!lotUrl || !lotUrl.includes('wolmar.ru')) {
            console.log('❌ Неверный URL лота');
            return;
        }

        // Анализируем лот
        const lotInfo = await bidPlacer.analyzeLot(lotUrl);
        if (!lotInfo) {
            console.log('❌ Не удалось проанализировать лот');
            return;
        }

        // Запрашиваем сумму ставки
        const bidAmountStr = await bidPlacer.askQuestion('💰 Введите сумму ставки (руб.): ');
        const bidAmount = parseInt(bidAmountStr);

        if (isNaN(bidAmount) || bidAmount < 1) {
            console.log('❌ Неверная сумма ставки');
            return;
        }

        // Запрашиваем автобид
        const autoBidAnswer = await bidPlacer.askQuestion('🤖 Использовать автобид? (yes/no): ');
        const useAutoBid = autoBidAnswer.toLowerCase() === 'yes';

        // 🚨 ФИНАЛЬНОЕ ПОДТВЕРЖДЕНИЕ
        console.log('');
        console.log('🚨 ФИНАЛЬНОЕ ПОДТВЕРЖДЕНИЕ СТАВКИ');
        console.log(`🚨 Лот: ${lotInfo.lotTitle}`);
        console.log(`🚨 Аукцион: ${lotInfo.auctionInfo}`);
        console.log(`🚨 Текущая ставка: ${lotInfo.currentBid} руб.`);
        console.log(`🚨 Минимальная ставка: ${lotInfo.minBid} руб.`);
        console.log(`🚨 Ваша ставка: ${bidAmount} руб.`);
        console.log(`🚨 Автобид: ${useAutoBid ? 'ДА' : 'НЕТ'}`);
        console.log('');

        const finalConfirmation = await bidPlacer.askQuestion('🚨 Вы уверены, что хотите разместить эту ставку? (yes/no): ');
        
        if (finalConfirmation.toLowerCase() !== 'yes') {
            console.log('❌ Ставка отменена пользователем');
            return;
        }

        console.log('✅ Ставка подтверждена, размещаем...');
        console.log('');

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

module.exports = WolmarBidInteractive;

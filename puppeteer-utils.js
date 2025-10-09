/**
 * Утилиты для работы с Puppeteer
 * Универсальная конфигурация для Windows и Linux
 */

const puppeteer = require('puppeteer');

/**
 * Универсальная функция для запуска Puppeteer
 * Автоматически определяет платформу и пробует разные пути к браузеру
 */
async function launchPuppeteer(options = {}) {
    const defaultOptions = {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox'
        ]
    };

    // Объединяем опции
    const launchOptions = { ...defaultOptions, ...options };

    // Для Windows указываем путь, для Linux позволяем Puppeteer самому найти браузер
    if (process.platform === 'win32') {
        const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
        console.log(`🔍 Запускаем браузер (Windows): ${executablePath}`);
        
        return await puppeteer.launch({
            ...launchOptions,
            executablePath
        });
    } else {
        console.log(`🔍 Запускаем браузер (Linux): автоопределение`);
        
        return await puppeteer.launch(launchOptions);
    }
}

/**
 * Создает новую страницу с настройками по умолчанию
 */
async function createPage(browser) {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    return page;
}

module.exports = {
    launchPuppeteer,
    createPage
};

/**
 * Утилиты для работы с Puppeteer
 * Конфигурация для Debian сервера
 */

const puppeteer = require('puppeteer');

/**
 * Функция для запуска Puppeteer на Debian сервере
 * Автоматически находит браузер в системе
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

    // Для Debian позволяем Puppeteer самому найти браузер
    console.log(`🔍 Запускаем браузер (Debian): автоопределение`);
    
    return await puppeteer.launch(launchOptions);
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

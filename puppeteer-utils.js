/**
 * Утилиты для работы с Puppeteer
 * Универсальная конфигурация для Windows и Linux
 */

const puppeteer = require('puppeteer-core');

/**
 * Универсальная функция для запуска Puppeteer
 * Автоматически определяет платформу и пробует разные пути к браузеру
 */
async function launchPuppeteer(options = {}) {
    const defaultOptions = {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--single-process',
            '--no-zygote',
            '--disable-gpu',
            '--disable-background-networking',
            `--user-data-dir=/tmp/chrome-user-data-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
        ]
    };

    // Объединяем опции
    const launchOptions = { ...defaultOptions, ...options };

    // Используем простую логику - только рабочие пути
    const executablePath = process.platform === 'win32' 
        ? (process.env.PUPPETEER_EXECUTABLE_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
        : (process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome');

    console.log(`🔍 Запускаем браузер: ${executablePath}`);
    
    return await puppeteer.launch({
        ...launchOptions,
        executablePath
    });
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

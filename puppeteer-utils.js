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
            '--disable-gpu',
            '--disable-images',
            '--disable-javascript',
            '--user-data-dir=/tmp/chrome-user-data',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding'
        ]
    };

    // Объединяем опции
    const launchOptions = { ...defaultOptions, ...options };

    // Определяем пути к браузеру в зависимости от платформы
    const executablePaths = process.platform === 'win32' 
        ? [
            process.env.PUPPETEER_EXECUTABLE_PATH,
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
          ].filter(Boolean)
        : [
            process.env.PUPPETEER_EXECUTABLE_PATH,
            '/usr/bin/chromium-browser',
            '/usr/bin/chromium',
            '/usr/bin/google-chrome',
            '/snap/bin/chromium',
            '/opt/google/chrome/chrome'
          ].filter(Boolean);

    let browser;
    let lastError;

    // Пробуем запустить браузер с разными путями
    for (const executablePath of executablePaths) {
        try {
            console.log(`🔍 Пробуем запустить браузер: ${executablePath}`);
            browser = await puppeteer.launch({
                ...launchOptions,
                executablePath
            });
            console.log(`✅ Браузер успешно запущен: ${executablePath}`);
            break;
        } catch (error) {
            console.log(`❌ Не удалось запустить ${executablePath}: ${error.message}`);
            lastError = error;
            continue;
        }
    }

    if (!browser) {
        throw new Error(`Не удалось запустить браузер ни с одним из путей: ${executablePaths.join(', ')}. Последняя ошибка: ${lastError.message}`);
    }

    return browser;
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

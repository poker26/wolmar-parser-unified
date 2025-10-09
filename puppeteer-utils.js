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
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--disable-web-security',
            '--disable-features=VizDisplayCompositor',
            '--disable-blink-features=AutomationControlled',
            '--disable-extensions',
            '--disable-plugins',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-ipc-flooding-protection',
            '--disable-hang-monitor',
            '--disable-prompt-on-repost',
            '--disable-sync',
            '--disable-translate',
            '--disable-logging',
            '--disable-permissions-api',
            '--disable-presentation-api',
            '--disable-print-preview',
            '--disable-speech-api',
            '--disable-file-system',
            '--disable-notifications',
            '--disable-geolocation',
            '--disable-media-session-api',
            '--disable-background-networking',
            '--disable-default-apps',
            '--disable-sync-preferences',
            '--disable-component-extensions-with-background-pages',
            '--disable-client-side-phishing-detection',
            '--disable-component-update',
            '--disable-domain-reliability',
            '--disable-features=TranslateUI',
            '--disable-features=BlinkGenPropertyTrees',
            '--disable-features=VizDisplayCompositor',
            '--disable-features=WebRtcHideLocalIpsWithMdns',
            '--disable-features=WebRtcUseMinMaxVEADimensions',
            '--single-process',
            '--no-zygote',
            `--user-data-dir=/tmp/chrome-user-data-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
        ]
    };

    // Объединяем опции
    const launchOptions = { ...defaultOptions, ...options };

    // Для Linux не указываем executablePath - пусть Puppeteer сам найдет браузер
    if (process.platform === 'win32') {
        // На Windows пробуем разные пути
        const executablePaths = [
            process.env.PUPPETEER_EXECUTABLE_PATH,
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
        ].filter(Boolean);

        let browser;
        let lastError;

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
    } else {
        // На Linux используем стандартную конфигурацию без executablePath
        console.log(`🔍 Запускаем браузер для Linux (автопоиск)...`);
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

/**
 * Утилиты для работы с Puppeteer
 * Конфигурация для Debian сервера
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const CHROME_PATHS_LINUX = [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/chrome'
];

function getSystemChromePath() {
    if (process.env.CHROME_PATH) {
        if (fs.existsSync(process.env.CHROME_PATH)) {
            return process.env.CHROME_PATH;
        }
    }
    if (process.platform !== 'win32' && process.platform !== 'darwin') {
        for (const chromePath of CHROME_PATHS_LINUX) {
            if (fs.existsSync(chromePath)) {
                return chromePath;
            }
        }
    }
    return null;
}

/**
 * Функция для запуска Puppeteer на Debian сервере
 * Использует системный Chrome/Chromium на Linux, чтобы не зависеть от кэша Puppeteer
 */
async function launchPuppeteer(options = {}) {
    const defaultOptions = {
        headless: true,
        args: [
            // Безопасность
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-gpu-sandbox',
            '--disable-software-rasterizer',

            // Нет записей на диск: краши, отчёты, логи
            '--disable-breakpad',
            '--disable-crash-reporter',
            '--disable-crashpad',
            '--enable-logging=false',
            '--log-level=0',
            '--disable-logging',
            '--disable-gpu-logging',
            '--disable-metrics',
            '--disable-metrics-reporting',
            '--disable-reporting',
            '--disable-background-mode',
            '--disable-background-timer-throttling',
            '--disable-renderer-backgrounding',
            '--disable-backgrounding-occluded-windows',
            '--disable-background-networking',
            '--disable-background-sync',
            '--disable-component-update',
            '--disable-client-side-phishing-detection',
            '--disable-component-extensions-with-background-pages',
            '--disable-domain-reliability',

            // Нет кэша и снапшотов на диске
            '--disk-cache-size=0',
            '--media-cache-size=0',
            '--aggressive-cache-discard',

            // Отключение лишних функций
            '--disable-features=TranslateUI,BlinkGenPropertyTrees,VizDisplayCompositor,Reporting',
            '--disable-ipc-flooding-protection',
            '--disable-hang-monitor',
            '--disable-prompt-on-repost',
            '--disable-sync',
            '--disable-default-apps',
            '--disable-extensions',
            '--disable-plugins',
            '--disable-images',
            '--disable-javascript',
            '--disable-web-security',
            '--disable-permissions-api',
            '--disable-presentation-api',
            '--disable-print-preview',
            '--disable-speech-api',
            '--disable-file-system',
            '--disable-notifications',
            '--disable-features=AudioServiceOutOfProcess',

            // Браузер
            '--no-first-run',
            '--no-default-browser-check',
            '--no-pings',
            '--password-store=basic',
            '--use-mock-keychain',
            '--disable-blink-features=AutomationControlled',

            // Профиль только в /tmp, один раз на сессию — после закрытия браузера папку удаляет cleanupChromeTempFiles()
            '--user-data-dir=/tmp/chrome-temp-' + Math.random().toString(36).substring(7)
        ]
    };

    const launchOptions = { ...defaultOptions, ...options };

    // На Linux используем системный Chrome/Chromium (не зависим от кэша Puppeteer)
    const systemChrome = getSystemChromePath();
    if (systemChrome && !launchOptions.executablePath) {
        launchOptions.executablePath = systemChrome;
        console.log(`🔍 Запускаем браузер: ${systemChrome}`);
    } else if (launchOptions.executablePath) {
        console.log(`🔍 Запускаем браузер: ${launchOptions.executablePath}`);
    } else {
        console.log(`🔍 Запускаем браузер: автоопределение (кэш Puppeteer)`);
    }

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

/**
 * Очищает все артефакты Chrome после парсинга (логи, кэш, крашдампы, метрики).
 * Вызывать после browser.close() при массовом парсинге, чтобы не забивать диск.
 */
function cleanupChromeTempFiles() {
    const { execSync } = require('child_process');
    const patterns = [
        '/tmp/chrome-temp-*',
        '/tmp/chrome-user-data-*',
        '/tmp/.com.google.Chrome.*',
        '/tmp/.org.chromium.Chromium.*',
        '/tmp/Crashpad',
        '/tmp/.config/google-chrome',
        '/tmp/.config/chromium',
        '/tmp/*.dmp',
        '/tmp/*.log'
    ];
    try {
        for (const p of patterns) {
            try {
                execSync(`rm -rf ${p}`, { stdio: 'ignore' });
            } catch (_) { /* ignore */ }
        }
        try {
            execSync('find /tmp -maxdepth 2 -type d -name "chrome-*" 2>/dev/null | xargs -r rm -rf', { stdio: 'ignore' });
            execSync('find /tmp -maxdepth 2 -type d -name ".org.chromium*" 2>/dev/null | xargs -r rm -rf', { stdio: 'ignore' });
            execSync('find /tmp -name "BrowserMetrics-*.pma" -delete 2>/dev/null', { stdio: 'ignore' });
            execSync('find /tmp -name "*.dmp" -delete 2>/dev/null', { stdio: 'ignore' });
        } catch (_) { /* ignore */ }
        if (process.platform !== 'win32') {
            try {
                execSync('find /root/.config -name "BrowserMetrics-*.pma" -delete 2>/dev/null', { stdio: 'ignore' });
            } catch (_) { /* ignore */ }
        }
    } catch (error) {
        console.warn('⚠️ Очистка артефактов Chrome:', error.message);
    }
}

module.exports = {
    launchPuppeteer,
    createPage,
    cleanupChromeTempFiles
};

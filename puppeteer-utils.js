/**
 * Утилиты для работы с Puppeteer
 * Конфигурация для Debian сервера
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

/**
 * Функция для запуска Puppeteer на Debian сервере
 * Автоматически находит браузер в системе
 */
async function launchPuppeteer(options = {}) {
    const defaultOptions = {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-features=TranslateUI',
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
            '--disable-features=VizDisplayCompositor',
            '--disable-logging',
            '--disable-permissions-api',
            '--disable-presentation-api',
            '--disable-print-preview',
            '--disable-speech-api',
            '--disable-file-system',
            '--disable-notifications',
            '--disable-background-networking',
            '--disable-background-sync',
            '--disable-client-side-phishing-detection',
            '--disable-component-extensions-with-background-pages',
            '--disable-domain-reliability',
            '--disable-features=AudioServiceOutOfProcess',
            '--disable-hang-monitor',
            '--disable-prompt-on-repost',
            '--disable-sync',
            '--metrics-recording-only',
            '--no-first-run',
            '--no-default-browser-check',
            '--no-pings',
            '--password-store=basic',
            '--use-mock-keychain',
            '--disable-blink-features=AutomationControlled',
            '--disable-features=VizDisplayCompositor',
            '--user-data-dir=/tmp/chrome-user-data-' + Math.random().toString(36).substring(7)
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

/**
 * Очищает временные файлы Chrome
 */
function cleanupChromeTempFiles() {
    try {
        // Очищаем временные директории Chrome
        const tempDirs = [
            '/tmp/chrome-user-data-*',
            '/tmp/.com.google.Chrome.*',
            '/tmp/.org.chromium.Chromium.*'
        ];
        
        tempDirs.forEach(pattern => {
            const { exec } = require('child_process');
            exec(`rm -rf ${pattern}`, (error) => {
                if (error && !error.message.includes('No such file')) {
                    console.log(`⚠️ Не удалось очистить ${pattern}: ${error.message}`);
                }
            });
        });
        
        // Очищаем файлы метрик Chrome
        const metricsDir = '/root/.config/google-chrome/BrowserMetrics';
        if (fs.existsSync(metricsDir)) {
            const files = fs.readdirSync(metricsDir);
            files.forEach(file => {
                if (file.startsWith('BrowserMetrics-') && file.endsWith('.pma')) {
                    try {
                        fs.unlinkSync(path.join(metricsDir, file));
                        console.log(`🗑️ Удален файл метрик: ${file}`);
                    } catch (error) {
                        console.log(`⚠️ Не удалось удалить ${file}: ${error.message}`);
                    }
                }
            });
        }
        
        console.log('✅ Очистка временных файлов Chrome завершена');
    } catch (error) {
        console.log(`⚠️ Ошибка при очистке временных файлов: ${error.message}`);
    }
}

module.exports = {
    launchPuppeteer,
    createPage,
    cleanupChromeTempFiles
};

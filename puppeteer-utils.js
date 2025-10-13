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
            // Основные флаги безопасности
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-gpu-sandbox',
            '--disable-software-rasterizer',
            
            // КРИТИЧЕСКИ ВАЖНО: отключаем все метрики и логирование
            '--disable-metrics',
            '--disable-metrics-reporting',
            '--disable-background-mode',
            '--disable-background-timer-throttling',
            '--disable-renderer-backgrounding',
            '--disable-backgrounding-occluded-windows',
            '--disable-logging',
            '--disable-gpu-logging',
            
            // Отключаем ненужные функции
            '--disable-features=TranslateUI,BlinkGenPropertyTrees,VizDisplayCompositor',
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
            '--disable-background-networking',
            '--disable-background-sync',
            '--disable-client-side-phishing-detection',
            '--disable-component-extensions-with-background-pages',
            '--disable-domain-reliability',
            '--disable-features=AudioServiceOutOfProcess',
            
            // Настройки браузера
            '--no-first-run',
            '--no-default-browser-check',
            '--no-pings',
            '--password-store=basic',
            '--use-mock-keychain',
            '--disable-blink-features=AutomationControlled',
            
            // Используем временную директорию в /tmp с уникальным именем
            '--user-data-dir=/tmp/chrome-temp-' + Math.random().toString(36).substring(7)
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
        const { exec } = require('child_process');
        
        // Очищаем временные директории Chrome
        const tempDirs = [
            '/tmp/chrome-temp-*',
            '/tmp/chrome-user-data-*',
            '/tmp/.com.google.Chrome.*',
            '/tmp/.org.chromium.Chromium.*',
            '/tmp/.config/google-chrome',
            '/tmp/.config/chromium'
        ];
        
        tempDirs.forEach(pattern => {
            exec(`rm -rf ${pattern}`, (error) => {
                if (error && !error.message.includes('No such file')) {
                    console.log(`⚠️ Не удалось очистить ${pattern}: ${error.message}`);
                }
            });
        });
        
        // Очищаем файлы метрик Chrome из всех возможных мест
        const metricsDirs = [
            '/root/.config/google-chrome/BrowserMetrics',
            '/root/.config/chromium/BrowserMetrics',
            '/tmp/.config/google-chrome/BrowserMetrics',
            '/tmp/.config/chromium/BrowserMetrics'
        ];
        
        metricsDirs.forEach(metricsDir => {
            if (fs.existsSync(metricsDir)) {
                try {
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
                } catch (error) {
                    console.log(`⚠️ Не удалось прочитать директорию ${metricsDir}: ${error.message}`);
                }
            }
        });
        
        // Агрессивная очистка всех файлов метрик
        exec('find /tmp -name "BrowserMetrics-*.pma" -delete 2>/dev/null', (error) => {
            if (error && !error.message.includes('No such file')) {
                console.log(`⚠️ Ошибка при агрессивной очистке метрик: ${error.message}`);
            }
        });
        
        exec('find /root/.config -name "BrowserMetrics-*.pma" -delete 2>/dev/null', (error) => {
            if (error && !error.message.includes('No such file')) {
                console.log(`⚠️ Ошибка при агрессивной очистке метрик: ${error.message}`);
            }
        });
        
        console.log('✅ Агрессивная очистка временных файлов Chrome завершена');
    } catch (error) {
        console.log(`⚠️ Ошибка при очистке временных файлов: ${error.message}`);
    }
}

module.exports = {
    launchPuppeteer,
    createPage,
    cleanupChromeTempFiles
};

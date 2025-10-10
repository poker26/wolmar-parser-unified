const { cleanupChromeTempFiles } = require('./puppeteer-utils');
const fs = require('fs');
const path = require('path');

/**
 * Скрипт для очистки файлов метрик Chrome
 * Можно запускать периодически через cron
 */

async function cleanupChromeMetrics() {
    console.log('🧹 Начинаем очистку файлов метрик Chrome...');
    
    try {
        // Очищаем временные файлы через puppeteer-utils
        cleanupChromeTempFiles();
        
        // Дополнительная очистка файлов метрик
        const metricsDir = '/root/.config/google-chrome/BrowserMetrics';
        if (fs.existsSync(metricsDir)) {
            const files = fs.readdirSync(metricsDir);
            let deletedCount = 0;
            let totalSize = 0;
            
            files.forEach(file => {
                if (file.startsWith('BrowserMetrics-') && file.endsWith('.pma')) {
                    try {
                        const filePath = path.join(metricsDir, file);
                        const stats = fs.statSync(filePath);
                        totalSize += stats.size;
                        
                        fs.unlinkSync(filePath);
                        deletedCount++;
                        console.log(`🗑️ Удален файл метрик: ${file} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
                    } catch (error) {
                        console.log(`⚠️ Не удалось удалить ${file}: ${error.message}`);
                    }
                }
            });
            
            console.log(`✅ Удалено ${deletedCount} файлов метрик`);
            console.log(`💾 Освобождено места: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
        } else {
            console.log('📁 Директория метрик не найдена');
        }
        
        // Очищаем другие временные файлы Chrome
        const tempDirs = [
            '/tmp/chrome-user-data-*',
            '/tmp/.com.google.Chrome.*',
            '/tmp/.org.chromium.Chromium.*',
            '/tmp/.X11-unix/X*'
        ];
        
        const { exec } = require('child_process');
        
        tempDirs.forEach(pattern => {
            exec(`rm -rf ${pattern}`, (error) => {
                if (error && !error.message.includes('No such file')) {
                    console.log(`⚠️ Не удалось очистить ${pattern}: ${error.message}`);
                } else {
                    console.log(`✅ Очищена директория: ${pattern}`);
                }
            });
        });
        
        console.log('🎉 Очистка завершена!');
        
    } catch (error) {
        console.error('❌ Ошибка при очистке:', error.message);
    }
}

// Запускаем очистку
cleanupChromeMetrics();

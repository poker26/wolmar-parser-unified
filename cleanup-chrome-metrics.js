#!/usr/bin/env node

/**
 * Скрипт для очистки файлов метрик Chrome
 * Запускается периодически для предотвращения переполнения диска
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

function cleanupChromeMetrics() {
    console.log('🧹 Начинаем очистку файлов метрик Chrome...');
    
    try {
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
        
        let deletedFiles = 0;
        let totalSize = 0;
        
        metricsDirs.forEach(metricsDir => {
            if (fs.existsSync(metricsDir)) {
                try {
                    const files = fs.readdirSync(metricsDir);
                    files.forEach(file => {
                        if (file.startsWith('BrowserMetrics-') && file.endsWith('.pma')) {
                            try {
                                const filePath = path.join(metricsDir, file);
                                const stats = fs.statSync(filePath);
                                totalSize += stats.size;
                                fs.unlinkSync(filePath);
                                deletedFiles++;
                                console.log(`🗑️ Удален файл метрик: ${file} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
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
        
        console.log(`✅ Очистка завершена: удалено ${deletedFiles} файлов, освобождено ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
        
        // Проверяем свободное место на диске
        exec('df -h /', (error, stdout) => {
            if (!error) {
                const lines = stdout.split('\n');
                if (lines.length > 1) {
                    const diskInfo = lines[1].split(/\s+/);
                    const used = diskInfo[2];
                    const available = diskInfo[3];
                    const usePercent = diskInfo[4];
                    console.log(`💾 Использование диска: ${used} использовано, ${available} свободно (${usePercent})`);
                }
            }
        });
        
    } catch (error) {
        console.log(`⚠️ Ошибка при очистке временных файлов: ${error.message}`);
    }
}

// Запускаем очистку
cleanupChromeMetrics();

// Если скрипт запущен с аргументом --watch, запускаем периодическую очистку
if (process.argv.includes('--watch')) {
    console.log('🔄 Запускаем периодическую очистку каждые 30 минут...');
    setInterval(cleanupChromeMetrics, 30 * 60 * 1000); // 30 минут
}
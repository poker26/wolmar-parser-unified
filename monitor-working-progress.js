/**
 * Мониторинг прогресса рабочей версии массового обновления
 */

const fs = require('fs');

function monitorProgress() {
    const progressFile = 'working_mass_update_progress.json';
    
    if (!fs.existsSync(progressFile)) {
        console.log('❌ Файл прогресса не найден. Скрипт еще не запущен или не начал работу.');
        return;
    }
    
    try {
        const data = JSON.parse(fs.readFileSync(progressFile, 'utf8'));
        const stats = data.stats;
        const timestamp = new Date(data.timestamp);
        
        console.log('📊 ПРОГРЕСС РАБОЧЕЙ ВЕРСИИ МАССОВОГО ОБНОВЛЕНИЯ:');
        console.log(`⏰ Последнее обновление: ${timestamp.toLocaleString('ru-RU')}`);
        console.log(`📈 Обработано лотов: ${stats.processed}`);
        console.log(`✅ Обновлено: ${stats.updated}`);
        console.log(`⏭️ Пропущено: ${stats.skipped}`);
        console.log(`❌ Ошибок: ${stats.errors}`);
        console.log(`🏆 Аукционов обработано: ${stats.auctionsProcessed}`);
        console.log(`📄 Страниц обработано: ${stats.pagesProcessed}`);
        
        if (stats.startTime) {
            const startTime = new Date(stats.startTime);
            const elapsed = Math.floor((new Date() - startTime) / 1000);
            const rate = stats.processed > 0 ? (stats.processed / elapsed * 60).toFixed(1) : 0;
            
            console.log(`⏱️ Время работы: ${Math.floor(elapsed / 60)}м ${elapsed % 60}с`);
            console.log(`🚀 Скорость: ${rate} лотов/мин`);
            
            // Прогноз завершения
            if (stats.processed > 0 && rate > 0) {
                const estimatedTotal = 20000; // Примерная оценка
                const remaining = estimatedTotal - stats.processed;
                const etaMinutes = Math.floor(remaining / rate);
                const etaHours = Math.floor(etaMinutes / 60);
                const etaMins = etaMinutes % 60;
                
                console.log(`📊 Прогресс: ${((stats.processed / estimatedTotal) * 100).toFixed(1)}%`);
                console.log(`⏳ Осталось: ~${etaHours}ч ${etaMins}м`);
            }
        }
        
    } catch (error) {
        console.error('❌ Ошибка чтения файла прогресса:', error.message);
    }
}

// Запускаем мониторинг
monitorProgress();

// Автоматическое обновление каждые 30 секунд
setInterval(monitorProgress, 30000);

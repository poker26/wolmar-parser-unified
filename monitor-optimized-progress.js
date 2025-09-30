const fs = require('fs');

function monitorProgress() {
    const progressFile = 'optimized_mass_update_progress.json';
    
    if (!fs.existsSync(progressFile)) {
        console.log('❌ Файл прогресса не найден');
        return;
    }
    
    try {
        const data = JSON.parse(fs.readFileSync(progressFile, 'utf8'));
        const stats = data.stats;
        
        console.log('📊 ПРОГРЕСС ОПТИМИЗИРОВАННОГО ОБНОВЛЕНИЯ:');
        console.log('=====================================');
        
        if (stats.startTime) {
            const startTime = new Date(stats.startTime);
            const elapsed = Math.floor((new Date() - startTime) / 1000);
            const rate = stats.processed > 0 ? (stats.processed / elapsed * 60).toFixed(1) : 0;
            
            console.log(`⏱️ Время работы: ${Math.floor(elapsed / 60)}м ${elapsed % 60}с`);
            console.log(`📈 Скорость: ${rate} лотов/мин`);
        }
        
        console.log(`🔢 Обработано лотов: ${stats.processed}`);
        console.log(`✅ Обновлено: ${stats.updated}`);
        console.log(`⏭️ Пропущено: ${stats.skipped}`);
        console.log(`❌ Ошибок: ${stats.errors}`);
        console.log(`🏆 Аукционов обработано: ${stats.auctionsProcessed}`);
        
        if (stats.processed > 0) {
            const updateRate = ((stats.updated / stats.processed) * 100).toFixed(1);
            console.log(`📊 Процент обновлений: ${updateRate}%`);
        }
        
        console.log(`🕐 Последнее обновление: ${new Date(data.timestamp).toLocaleString('ru-RU')}`);
        
    } catch (error) {
        console.error('❌ Ошибка чтения файла прогресса:', error.message);
    }
}

monitorProgress();

const fs = require('fs');

function monitorUltraOptimized() {
    console.log('📊 МОНИТОРИНГ УЛЬТРА-ОПТИМИЗИРОВАННОГО ОБНОВЛЕНИЯ');
    console.log('='.repeat(60));
    
    try {
        if (fs.existsSync('ultra_optimized_analysis.json')) {
            const analysis = JSON.parse(fs.readFileSync('ultra_optimized_analysis.json', 'utf8'));
            console.log(`📋 Всего лотов для обновления: ${analysis.critical}`);
            console.log(`🎯 Экономия времени: ${analysis.savingsPercent}%`);
            console.log(`⏭️ Пропускаем VF/XF/AU: ${analysis.skip} лотов`);
        }
        
        if (fs.existsSync('ultra_optimized_progress.json')) {
            const progress = JSON.parse(fs.readFileSync('ultra_optimized_progress.json', 'utf8'));
            
            const elapsed = Math.round((Date.now() - new Date(progress.timestamp).getTime()) / 1000);
            const rate = progress.processed > 0 ? (progress.processed / elapsed * 60).toFixed(1) : 0;
            
            console.log(`\n📊 ТЕКУЩИЙ ПРОГРЕСС:`);
            console.log(`✅ Обновлено: ${progress.updated}`);
            console.log(`⏭️ Пропущено: ${progress.skipped}`);
            console.log(`❌ Ошибок: ${progress.errors}`);
            console.log(`📊 Обработано: ${progress.processed}`);
            console.log(`🚀 Скорость: ${rate} лотов/мин`);
            console.log(`⏰ Последнее обновление: ${new Date(progress.timestamp).toLocaleString()}`);
            
            if (fs.existsSync('ultra_optimized_analysis.json')) {
                const analysis = JSON.parse(fs.readFileSync('ultra_optimized_analysis.json', 'utf8'));
                const remaining = analysis.critical - progress.processed;
                const eta = remaining > 0 && rate > 0 ? Math.round(remaining / rate) : 0;
                const etaHours = Math.floor(eta / 60);
                const etaMinutes = eta % 60;
                
                console.log(`\n⏳ ОСТАЛОСЬ: ${remaining} лотов`);
                console.log(`🕐 Примерное время завершения: ${etaHours}ч ${etaMinutes}м`);
                
                const progressPercent = (progress.processed / analysis.critical * 100).toFixed(1);
                console.log(`📈 Прогресс: ${progressPercent}%`);
            }
        } else {
            console.log('⚠️ Файл прогресса не найден. Скрипт еще не запущен или не начал работу.');
        }
        
    } catch (error) {
        console.error('❌ Ошибка при чтении файлов:', error.message);
    }
}

monitorUltraOptimized();

const WinnerRatingsService = require('./winner-ratings-service');

async function initializeRatings() {
    console.log('🚀 Инициализация системы рейтингов победителей...');
    
    const ratingsService = new WinnerRatingsService();
    
    try {
        // Создаем таблицу
        console.log('📊 Создание таблицы рейтингов...');
        await ratingsService.createRatingsTable();
        
        // Массовое обновление всех рейтингов
        console.log('🔄 Начинаем массовое обновление рейтингов...');
        const result = await ratingsService.updateAllRatings();
        
        console.log('✅ Инициализация завершена!');
        console.log(`📈 Обновлено: ${result.updated} рейтингов`);
        console.log(`❌ Ошибок: ${result.errors}`);
        console.log(`📊 Всего обработано: ${result.total} победителей`);
        
        // Показываем топ-10
        console.log('\n🏆 Топ-10 победителей по рейтингу:');
        const topWinners = await ratingsService.getTopWinners(10);
        topWinners.forEach((winner, index) => {
            console.log(`${index + 1}. ${winner.winnerLogin} - ${winner.rating} (${winner.category.category})`);
        });
        
    } catch (error) {
        console.error('❌ Ошибка инициализации:', error);
    } finally {
        process.exit(0);
    }
}

// Запуск
if (require.main === module) {
    initializeRatings();
}

module.exports = { initializeRatings };

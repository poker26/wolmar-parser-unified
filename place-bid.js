const WolmarBidPlacer = require('./wolmar-bid-placer');

// Основная функция для постановки ставки
async function placeBid(auctionNumber, lotNumber, bidAmount) {
    const bidPlacer = new WolmarBidPlacer();
    
    try {
        console.log(`🎯 Постановка ставки: аукцион ${auctionNumber}, лот ${lotNumber}, сумма ${bidAmount}₽`);
        
        await bidPlacer.init();
        
        // Авторизуемся
        const loginSuccess = await bidPlacer.login();
        if (!loginSuccess) {
            console.log('❌ Не удалось авторизоваться');
            process.exit(1);
        }

        // Формируем URL лота
        const lotUrl = `https://www.wolmar.ru/auction/${auctionNumber}/${lotNumber}`;
        
        console.log(`🔍 Переходим на лот: ${lotUrl}`);
        
        // Размещаем ставку
        const bidSuccess = await bidPlacer.placeBid(lotUrl, parseInt(bidAmount), false);
        
        if (bidSuccess) {
            console.log('🎉 Ставка размещена успешно!');
            process.exit(0);
        } else {
            console.log('❌ Не удалось разместить ставку');
            process.exit(1);
        }
        
    } catch (error) {
        console.error('❌ Критическая ошибка:', error);
        process.exit(1);
    } finally {
        await bidPlacer.close();
    }
}

// Проверяем аргументы командной строки
if (require.main === module) {
    const args = process.argv.slice(2);
    
    if (args.length !== 3) {
        console.error('❌ Неверное количество аргументов');
        console.error('Использование: node place-bid.js <auctionNumber> <lotNumber> <bidAmount>');
        console.error('Пример: node place-bid.js 2140 7609081 2');
        process.exit(1);
    }
    
    const [auctionNumber, lotNumber, bidAmount] = args;
    
    // Валидация аргументов
    if (!auctionNumber || !lotNumber || !bidAmount) {
        console.error('❌ Все аргументы обязательны');
        process.exit(1);
    }
    
    if (isNaN(bidAmount) || parseInt(bidAmount) < 1) {
        console.error('❌ Сумма ставки должна быть положительным числом');
        process.exit(1);
    }
    
    if (parseInt(bidAmount) > 1000000) {
        console.error('❌ Сумма ставки слишком большая (максимум 1,000,000 рублей)');
        process.exit(1);
    }
    
    // Запускаем постановку ставки
    placeBid(auctionNumber, lotNumber, bidAmount).catch(console.error);
}

module.exports = { placeBid };

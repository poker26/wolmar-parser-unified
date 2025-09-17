const { Client } = require('pg');
const config = require('./config');

async function clearAuction(auctionNumber) {
    const client = new Client(config.dbConfig);
    
    try {
        await client.connect();
        console.log('🔍 Подключение к базе данных...');
        
        // Удаляем лоты аукциона
        const result = await client.query(
            'DELETE FROM auction_lots WHERE auction_number = $1 AND source_site = $2',
            [auctionNumber, 'numismat.ru']
        );
        
        console.log(`✅ Удалено лотов: ${result.rowCount}`);
        
        // Удаляем URL лотов (если таблица существует)
        try {
            const urlResult = await client.query(
                'DELETE FROM auction_lot_urls WHERE auction_number = $1 AND source_site = $2',
                [auctionNumber, 'numismat.ru']
            );
            console.log(`✅ Удалено URL: ${urlResult.rowCount}`);
        } catch (error) {
            console.log('ℹ️ Таблица auction_lot_urls не найдена или не содержит данных');
        }
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    } finally {
        await client.end();
    }
}

// Запуск
if (require.main === module) {
    const args = process.argv.slice(2);
    const auctionNumber = args[0] || '1054';
    
    console.log(`🗑️ Очистка аукциона ${auctionNumber} из базы данных...`);
    clearAuction(auctionNumber);
}

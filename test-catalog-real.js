const CatalogParser = require('./catalog-parser');

async function testRealDatabase() {
    const parser = new CatalogParser();
    
    try {
        console.log('🔌 Подключение к базе данных...');
        await parser.init();
        
        console.log('📊 Получение тестовых лотов...');
        const client = await parser.pool.connect();
        
        // Получаем несколько лотов для тестирования
        const result = await client.query(`
            SELECT id, auction_number, lot_number, coin_description, 
                   avers_image_url, revers_image_url
            FROM auction_lots 
            WHERE coin_description IS NOT NULL 
            AND coin_description != ''
            AND coin_description LIKE '%г.%'
            ORDER BY auction_number DESC, lot_number ASC
            LIMIT 30
        `);
        
        client.release();
        
        console.log(`Найдено ${result.rows.length} лотов для тестирования\n`);
        
        // Тестируем парсинг каждого лота
        for (let i = 0; i < result.rows.length; i++) {
            const lot = result.rows[i];
            console.log(`\n${'='.repeat(80)}`);
            console.log(`Лот ${i + 1}/${result.rows.length}: ${lot.auction_number}-${lot.lot_number}`);
            console.log(`${'='.repeat(80)}`);
            
            console.log('Оригинальное описание:');
            console.log(lot.coin_description);
            console.log('\nРезультат парсинга:');
            
            const parsed = parser.parseLotDescription(lot.coin_description);
            console.log(JSON.stringify(parsed, null, 2));
            
            // Проверяем, есть ли изображения
            if (lot.avers_image_url) {
                console.log(`\nАверс: ${lot.avers_image_url}`);
            }
            if (lot.revers_image_url) {
                console.log(`Реверс: ${lot.revers_image_url}`);
            }
        }
        
        console.log(`\n${'='.repeat(80)}`);
        console.log('✅ Тестирование завершено успешно!');
        console.log(`${'='.repeat(80)}`);
        
    } catch (error) {
        console.error('❌ Ошибка тестирования:', error);
    } finally {
        await parser.close();
    }
}

// Запуск тестирования
testRealDatabase();

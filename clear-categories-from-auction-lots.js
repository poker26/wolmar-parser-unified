const { Client } = require('pg');
const config = require('./config');

async function clearCategoriesFromAuctionLots() {
    const client = new Client(config.dbConfig);
    
    try {
        await client.connect();
        console.log('✅ Подключено к базе данных');
        
        // Проверяем текущее состояние
        const beforeResult = await client.query(`
            SELECT COUNT(*) as total,
                   COUNT(CASE WHEN category IS NOT NULL AND category != '' THEN 1 END) as with_categories
            FROM auction_lots
        `);
        
        console.log('📊 Состояние ДО очистки:');
        console.log(`   Всего лотов: ${beforeResult.rows[0].total}`);
        console.log(`   С категориями: ${beforeResult.rows[0].with_categories}`);
        
        // Очищаем все категории
        console.log('🧹 Очищаем все категории...');
        const updateResult = await client.query(`
            UPDATE auction_lots 
            SET category = NULL 
            WHERE category IS NOT NULL
        `);
        
        console.log(`✅ Обновлено записей: ${updateResult.rowCount}`);
        
        // Проверяем состояние после очистки
        const afterResult = await client.query(`
            SELECT COUNT(*) as total,
                   COUNT(CASE WHEN category IS NOT NULL AND category != '' THEN 1 END) as with_categories
            FROM auction_lots
        `);
        
        console.log('📊 Состояние ПОСЛЕ очистки:');
        console.log(`   Всего лотов: ${afterResult.rows[0].total}`);
        console.log(`   С категориями: ${afterResult.rows[0].with_categories}`);
        
        console.log('🎉 Категории успешно очищены! Теперь можно перезапустить парсер.');
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    } finally {
        await client.end();
    }
}

clearCategoriesFromAuctionLots();

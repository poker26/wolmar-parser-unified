const { Client } = require('pg');
const config = require('./config');

async function clearApiCache() {
    const client = new Client(config.dbConfig);
    
    try {
        await client.connect();
        console.log('✅ Подключено к базе данных');
        
        // Проверяем текущее состояние категорий
        const categoryResult = await client.query(`
            SELECT COUNT(*) as total,
                   COUNT(CASE WHEN category IS NOT NULL AND category != '' THEN 1 END) as with_categories
            FROM auction_lots
        `);
        
        console.log('📊 Текущее состояние:');
        console.log(`   Всего лотов: ${categoryResult.rows[0].total}`);
        console.log(`   С категориями: ${categoryResult.rows[0].with_categories}`);
        
        // Проверяем уникальные категории
        const uniqueCategoriesResult = await client.query(`
            SELECT DISTINCT category, COUNT(*) as count
            FROM auction_lots 
            WHERE category IS NOT NULL AND category != ''
            GROUP BY category 
            ORDER BY count DESC
            LIMIT 10
        `);
        
        if (uniqueCategoriesResult.rows.length > 0) {
            console.log('🏷️ Найденные категории:');
            uniqueCategoriesResult.rows.forEach((row, index) => {
                console.log(`   ${index + 1}. ${row.category}: ${row.count} лотов`);
            });
        } else {
            console.log('⚠️ Категории не найдены в базе данных');
        }
        
        console.log('\n💡 Рекомендации:');
        console.log('1. Перезапустите сервер (если используете PM2: pm2 restart all)');
        console.log('2. Очистите кэш браузера (Ctrl+F5)');
        console.log('3. Проверьте, что парсер продолжает работать');
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    } finally {
        await client.end();
    }
}

clearApiCache();



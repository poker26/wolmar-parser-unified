const { Client } = require('pg');
const config = require('./config');

async function testApiFilters() {
    const client = new Client(config.dbConfig);
    
    try {
        await client.connect();
        console.log('✅ Подключено к базе данных');
        
        // Тестируем тот же запрос, что и в API /api/filters
        const query = `
            SELECT DISTINCT metal, condition, year, category
            FROM auction_lots 
            WHERE metal IS NOT NULL AND metal != ''
        `;
        
        console.log('🔍 Выполняем запрос API /api/filters...');
        const result = await client.query(query);
        console.log(`📊 Найдено записей: ${result.rows.length}`);
        
        // Обрабатываем данные как в API
        const metals = [...new Set(result.rows.map(row => row.metal).filter(Boolean))];
        const conditions = [...new Set(result.rows.map(row => row.condition).filter(Boolean))];
        const years = [...new Set(result.rows.map(row => row.year).filter(Boolean))].sort((a, b) => b - a);
        const categories = [...new Set(result.rows.map(row => row.category).filter(Boolean))];
        
        console.log('📋 Результат обработки:');
        console.log(`   Металлы: ${metals.length} (${metals.slice(0, 5).join(', ')}...)`);
        console.log(`   Состояния: ${conditions.length} (${conditions.slice(0, 5).join(', ')}...)`);
        console.log(`   Годы: ${years.length} (${years.slice(0, 5).join(', ')}...)`);
        console.log(`   Категории: ${categories.length} (${categories.join(', ')})`);
        
        // Проверяем, есть ли записи с категориями
        const categoryRecords = result.rows.filter(row => row.category && row.category.trim() !== '');
        console.log(`\n🔍 Записей с категориями в результате: ${categoryRecords.length}`);
        
        if (categoryRecords.length > 0) {
            console.log('📝 Примеры записей с категориями:');
            categoryRecords.slice(0, 3).forEach((row, index) => {
                console.log(`   ${index + 1}. Металл: ${row.metal}, Категория: ${row.category}`);
            });
        }
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    } finally {
        await client.end();
    }
}

testApiFilters();

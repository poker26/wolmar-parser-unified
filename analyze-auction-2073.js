const { Pool } = require('pg');

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'wolmar_parser',
    password: 'postgres',
    port: 5432,
});

async function analyzeAuction2073() {
    try {
        // Общая статистика по аукциону 2073
        const totalStats = await pool.query('SELECT COUNT(*) as total_lots, COUNT(CASE WHEN category IS NOT NULL AND category != \'\' THEN 1 END) as with_category FROM auction_lots WHERE auction_number = 2073');
        console.log('📊 Общая статистика аукциона 2073:');
        console.log(`  Всего лотов: ${totalStats.rows[0].total_lots}`);
        console.log(`  С категориями: ${totalStats.rows[0].with_category}`);
        
        // Статистика по категориям
        const categoryStats = await pool.query('SELECT category, COUNT(*) as count FROM auction_lots WHERE auction_number = 2073 AND category IS NOT NULL AND category != \'\' GROUP BY category ORDER BY count DESC');
        console.log('\n📋 Категории в аукционе 2073:');
        categoryStats.rows.forEach(row => {
            console.log(`  ${row.category}: ${row.count} лотов`);
        });
        
        // Проверяем метод парсинга
        const parsingMethod = await pool.query('SELECT parsing_method, COUNT(*) as count FROM auction_lots WHERE auction_number = 2073 GROUP BY parsing_method ORDER BY count DESC');
        console.log('\n🔧 Методы парсинга:');
        parsingMethod.rows.forEach(row => {
            console.log(`  ${row.parsing_method || 'NULL'}: ${row.count} лотов`);
        });
        
        // Проверяем source_category
        const sourceCategory = await pool.query('SELECT source_category, COUNT(*) as count FROM auction_lots WHERE auction_number = 2073 AND source_category IS NOT NULL GROUP BY source_category ORDER BY count DESC');
        console.log('\n📂 Источники категорий:');
        sourceCategory.rows.forEach(row => {
            console.log(`  ${row.source_category}: ${row.count} лотов`);
        });
        
        // Проверяем даты парсинга
        const parseDates = await pool.query('SELECT DATE(parsed_at) as parse_date, COUNT(*) as count FROM auction_lots WHERE auction_number = 2073 GROUP BY DATE(parsed_at) ORDER BY parse_date DESC');
        console.log('\n📅 Даты парсинга:');
        parseDates.rows.forEach(row => {
            console.log(`  ${row.parse_date}: ${row.count} лотов`);
        });
        
    } catch (error) {
        console.error('Ошибка:', error);
    } finally {
        await pool.end();
    }
}

analyzeAuction2073();

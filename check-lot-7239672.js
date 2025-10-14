const { Pool } = require('pg');

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'wolmar_parser',
    password: 'postgres',
    port: 5432,
});

async function checkLot7239672() {
    try {
        // Ищем лот по URL или номеру
        const lotQuery = await pool.query(`
            SELECT 
                lot_number,
                coin_description,
                category,
                source_category,
                parsing_method,
                parsed_at,
                source_url
            FROM auction_lots 
            WHERE auction_number = 2073 
            AND (source_url LIKE '%7239672%' OR lot_number = 4911)
            ORDER BY parsed_at DESC
            LIMIT 5
        `);
        
        console.log('🔍 Результаты поиска лота 7239672 (№4911):');
        if (lotQuery.rows.length > 0) {
            lotQuery.rows.forEach((lot, index) => {
                console.log(`\n📋 Лот ${index + 1}:`);
                console.log(`  Номер лота: ${lot.lot_number}`);
                console.log(`  Описание: ${lot.coin_description}`);
                console.log(`  Категория: ${lot.category || 'НЕ УКАЗАНА'}`);
                console.log(`  Источник категории: ${lot.source_category || 'НЕ УКАЗАН'}`);
                console.log(`  Метод парсинга: ${lot.parsing_method || 'НЕ УКАЗАН'}`);
                console.log(`  Дата парсинга: ${lot.parsed_at}`);
                console.log(`  URL: ${lot.source_url}`);
            });
        } else {
            console.log('❌ Лот не найден в базе данных');
        }
        
        // Проверим все категории в аукционе 2073
        const categoriesQuery = await pool.query(`
            SELECT category, COUNT(*) as count 
            FROM auction_lots 
            WHERE auction_number = 2073 
            AND category IS NOT NULL 
            AND category != ''
            GROUP BY category 
            ORDER BY count DESC
        `);
        
        console.log('\n📊 Все категории в аукционе 2073:');
        categoriesQuery.rows.forEach(row => {
            console.log(`  ${row.category}: ${row.count} лотов`);
        });
        
    } catch (error) {
        console.error('Ошибка:', error);
    } finally {
        await pool.end();
    }
}

checkLot7239672();

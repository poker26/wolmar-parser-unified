const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool(config.dbConfig);

async function addParsingNumberField() {
    try {
        console.log('🔧 Добавляем поле parsing_number в таблицу auction_lots...');
        
        // Добавляем поле parsing_number
        const alterTableQuery = `
            ALTER TABLE auction_lots 
            ADD COLUMN IF NOT EXISTS parsing_number INTEGER;
        `;
        
        await pool.query(alterTableQuery);
        console.log('✅ Поле parsing_number добавлено');
        
        // Создаем индекс для быстрого поиска
        await pool.query('CREATE INDEX IF NOT EXISTS idx_auction_lots_parsing_number ON auction_lots(parsing_number)');
        console.log('✅ Индекс создан');
        
        // Обновляем существующие записи: parsing_number = auction_number (временно)
        const updateQuery = `
            UPDATE auction_lots 
            SET parsing_number = auction_number::integer 
            WHERE parsing_number IS NULL;
        `;
        
        const updateResult = await pool.query(updateQuery);
        console.log(`✅ Обновлено ${updateResult.rowCount} записей`);
        
        // Показываем статистику
        const statsQuery = `
            SELECT 
                auction_number,
                parsing_number,
                COUNT(*) as lots_count
            FROM auction_lots 
            WHERE auction_number IS NOT NULL
            GROUP BY auction_number, parsing_number
            ORDER BY auction_number DESC
            LIMIT 10;
        `;
        
        const statsResult = await pool.query(statsQuery);
        console.log('\n📊 Текущие номера аукционов:');
        statsResult.rows.forEach(row => {
            console.log(`  Аукцион ${row.auction_number} (парсинг: ${row.parsing_number}): ${row.lots_count} лотов`);
        });
        
    } catch (error) {
        console.error('❌ Ошибка добавления поля:', error);
    } finally {
        await pool.end();
    }
}

addParsingNumberField();

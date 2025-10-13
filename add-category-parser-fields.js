/**
 * Добавление полей для парсера по категориям
 * 
 * Добавляет поля source_category и parsing_method в таблицу auction_lots
 */

const { Client } = require('pg');
const config = require('./config');

async function addCategoryParserFields() {
    const client = new Client(config.dbConfig);
    
    try {
        await client.connect();
        console.log('✅ Подключение к базе данных установлено');
        
        // Добавляем поле source_category
        console.log('🔧 Добавляем поле source_category...');
        await client.query(`
            ALTER TABLE auction_lots 
            ADD COLUMN IF NOT EXISTS source_category VARCHAR(100)
        `);
        console.log('✅ Поле source_category добавлено');
        
        // Добавляем поле parsing_method
        console.log('🔧 Добавляем поле parsing_method...');
        await client.query(`
            ALTER TABLE auction_lots 
            ADD COLUMN IF NOT EXISTS parsing_method VARCHAR(50) DEFAULT 'auction_parser'
        `);
        console.log('✅ Поле parsing_method добавлено');
        
        // Создаем индекс для source_category
        console.log('🔧 Создаем индекс для source_category...');
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_auction_lots_source_category 
            ON auction_lots(source_category)
        `);
        console.log('✅ Индекс для source_category создан');
        
        // Создаем индекс для parsing_method
        console.log('🔧 Создаем индекс для parsing_method...');
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_auction_lots_parsing_method 
            ON auction_lots(parsing_method)
        `);
        console.log('✅ Индекс для parsing_method создан');
        
        console.log('\n🎉 Все поля для парсера по категориям успешно добавлены!');
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
        throw error;
    } finally {
        await client.end();
    }
}

// Запуск если файл вызван напрямую
if (require.main === module) {
    addCategoryParserFields()
        .then(() => {
            console.log('✅ Скрипт завершен успешно');
            process.exit(0);
        })
        .catch((error) => {
            console.error('❌ Скрипт завершен с ошибкой:', error.message);
            process.exit(1);
        });
}

module.exports = { addCategoryParserFields };


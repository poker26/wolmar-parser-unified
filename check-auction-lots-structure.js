const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool(config.dbConfig);

async function checkAuctionLotsStructure() {
    try {
        // Проверяем структуру таблицы auction_lots
        const tableInfo = await pool.query(`
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns 
            WHERE table_name = 'auction_lots'
            ORDER BY ordinal_position
        `);
        
        console.log('📋 Структура таблицы auction_lots:');
        tableInfo.rows.forEach(row => {
            console.log(`  - ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable})`);
        });
        
        // Проверяем несколько записей для понимания данных
        const sampleResult = await pool.query(`
            SELECT id, lot_number, auction_number, coin_description, metal, condition, weight, year, letters, mint
            FROM auction_lots
            WHERE coin_description IS NOT NULL
            ORDER BY id DESC
            LIMIT 3
        `);
        
        console.log('\n📅 Примеры записей:');
        sampleResult.rows.forEach((row, index) => {
            console.log(`  ${index + 1}. Лот ${row.lot_number}:`, {
                id: row.id,
                description: row.coin_description?.substring(0, 50) + '...',
                metal: row.metal,
                condition: row.condition,
                weight: row.weight,
                year: row.year,
                letters: row.letters,
                mint: row.mint
            });
        });
        
    } catch (error) {
        console.error('❌ Ошибка:', error);
    } finally {
        await pool.end();
    }
}

checkAuctionLotsStructure();

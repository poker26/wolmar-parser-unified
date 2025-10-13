const { Pool } = require('pg');
const config = require('./config');

async function checkAuctionLotsStructure() {
    const pool = new Pool(config.dbConfig);
    
    try {
        console.log('🔍 Проверяем структуру таблицы auction_lots...');
        
        // Получаем структуру таблицы
        const structureQuery = `
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns 
            WHERE table_name = 'auction_lots' 
            ORDER BY ordinal_position
        `;
        
        const structureResult = await pool.query(structureQuery);
        
        console.log('\n📋 Структура таблицы auction_lots:');
        structureResult.rows.forEach(row => {
            console.log(`  ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable})`);
        });
        
        // Получаем пример записи
        const sampleQuery = `
            SELECT * FROM auction_lots 
            WHERE coin_description IS NOT NULL 
            AND coin_description != ''
            LIMIT 1
        `;
        
        const sampleResult = await pool.query(sampleQuery);
        
        if (sampleResult.rows.length > 0) {
            console.log('\n📄 Пример записи:');
            const sample = sampleResult.rows[0];
            Object.entries(sample).forEach(([key, value]) => {
                if (value !== null && value !== '') {
                    console.log(`  ${key}: ${value}`);
                }
            });
        }
        
    } catch (error) {
        console.error('❌ Ошибка при проверке структуры:', error);
    } finally {
        await pool.end();
    }
}

// Запускаем проверку
checkAuctionLotsStructure().catch(console.error);
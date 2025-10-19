const { Pool } = require('pg');
const config = require('./config');

async function testAuctionLotsStructure() {
    const pool = new Pool(config.dbConfig);
    
    try {
        console.log('🔍 Проверяем структуру таблицы auction_lots...');
        
        // Получаем структуру таблицы
        const structureQuery = `
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns 
            WHERE table_name = 'auction_lots'
            ORDER BY ordinal_position
        `;
        
        const structureResult = await pool.query(structureQuery);
        console.log('📊 Структура таблицы auction_lots:');
        structureResult.rows.forEach(row => {
            console.log(`   ${row.column_name}: ${row.data_type} (${row.is_nullable === 'YES' ? 'nullable' : 'not null'})`);
        });
        
        // Проверяем, есть ли поля country, rarity, mint
        const hasCountry = structureResult.rows.some(row => row.column_name === 'country');
        const hasRarity = structureResult.rows.some(row => row.column_name === 'rarity');
        const hasMint = structureResult.rows.some(row => row.column_name === 'mint');
        
        console.log('\n🔍 Проверка полей:');
        console.log(`   country: ${hasCountry ? '✅ Есть' : '❌ Нет'}`);
        console.log(`   rarity: ${hasRarity ? '✅ Есть' : '❌ Нет'}`);
        console.log(`   mint: ${hasMint ? '✅ Есть' : '❌ Нет'}`);
        
        // Если полей нет, проверим таблицу coin_catalog
        if (!hasCountry || !hasRarity || !hasMint) {
            console.log('\n🔍 Проверяем таблицу coin_catalog...');
            const catalogStructureQuery = `
                SELECT column_name, data_type, is_nullable
                FROM information_schema.columns 
                WHERE table_name = 'coin_catalog'
                AND column_name IN ('country', 'rarity', 'mint')
                ORDER BY ordinal_position
            `;
            
            const catalogResult = await pool.query(catalogStructureQuery);
            console.log('📊 Поля в coin_catalog:');
            catalogResult.rows.forEach(row => {
                console.log(`   ${row.column_name}: ${row.data_type} (${row.is_nullable === 'YES' ? 'nullable' : 'not null'})`);
            });
        }
        
        // Проверим несколько записей из auction_lots
        console.log('\n🔍 Примеры записей из auction_lots:');
        const sampleQuery = `
            SELECT lot_number, coin_description, metal, condition, year, letters
            FROM auction_lots 
            WHERE auction_number = (SELECT auction_number FROM auction_lots ORDER BY auction_number DESC LIMIT 1)
            LIMIT 3
        `;
        
        const sampleResult = await pool.query(sampleQuery);
        sampleResult.rows.forEach((row, index) => {
            console.log(`   Лот ${index + 1}: ${row.lot_number} - ${row.coin_description?.substring(0, 50)}...`);
            console.log(`      Металл: ${row.metal}, Состояние: ${row.condition}, Год: ${row.year}, Буквы: ${row.letters}`);
        });
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    } finally {
        await pool.end();
    }
}

testAuctionLotsStructure();

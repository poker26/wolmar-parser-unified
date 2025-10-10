const { Pool } = require('pg');
const config = require('./config');

async function testSnCoins() {
    const pool = new Pool(config.dbConfig);
    
    try {
        console.log('🔍 Ищем все монеты с металлом Sn...');
        
        const query = `
            SELECT 
                id, denomination, coin_name, year, metal, mint, 
                condition, mintage, country,
                original_description
            FROM coin_catalog 
            WHERE metal = 'Sn'
            ORDER BY denomination, coin_name, year
        `;
        
        const result = await pool.query(query);
        
        console.log(`📊 Найдено ${result.rows.length} оловянных монет`);
        console.log('\n📋 Список монет:');
        
        result.rows.forEach((coin, index) => {
            console.log(`${index + 1}. ID: ${coin.id} | ${coin.denomination} ${coin.coin_name} | ${coin.year || 'без года'} | ${coin.mint || 'неизвестный двор'} | ${coin.condition || 'неизвестно'}`);
        });
        
        // Проверим дубликаты
        console.log('\n🔍 Анализ дубликатов...');
        
        const duplicateQuery = `
            SELECT 
                denomination, coin_name, year, mint,
                COUNT(*) as count,
                STRING_AGG(id::text, ', ') as ids
            FROM coin_catalog 
            WHERE metal = 'Sn'
            GROUP BY denomination, coin_name, year, mint
            HAVING COUNT(*) > 1
            ORDER BY count DESC
        `;
        
        const duplicateResult = await pool.query(duplicateQuery);
        
        if (duplicateResult.rows.length > 0) {
            console.log(`\n❌ Найдено ${duplicateResult.rows.length} групп дубликатов:`);
            duplicateResult.rows.forEach((dup, index) => {
                console.log(`${index + 1}. ${dup.denomination} ${dup.coin_name} | ${dup.year || 'без года'} | ${dup.mint || 'неизвестный двор'} - ${dup.count} штук (ID: ${dup.ids})`);
            });
        } else {
            console.log('\n✅ Дубликатов не найдено');
        }
        
        // Проверим монеты без года
        console.log('\n🔍 Монеты без года:');
        const noYearQuery = `
            SELECT 
                id, denomination, coin_name, mint, condition,
                original_description
            FROM coin_catalog 
            WHERE metal = 'Sn' AND year IS NULL
            ORDER BY denomination, coin_name
        `;
        
        const noYearResult = await pool.query(noYearQuery);
        
        if (noYearResult.rows.length > 0) {
            console.log(`\n📋 Найдено ${noYearResult.rows.length} монет без года:`);
            noYearResult.rows.forEach((coin, index) => {
                console.log(`${index + 1}. ID: ${coin.id} | ${coin.denomination} ${coin.coin_name} | ${coin.mint || 'неизвестный двор'} | ${coin.condition || 'неизвестно'}`);
            });
        } else {
            console.log('\n✅ Все монеты имеют год');
        }
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    } finally {
        await pool.end();
    }
}

testSnCoins();

const { Pool } = require('pg');
const config = require('./config');

async function testDeduplicationFix() {
    const pool = new Pool(config.dbConfig);
    
    try {
        console.log('🔍 Тестируем исправленную логику дедупликации...');
        
        // Проверим дубликаты оловянных монет после исправления
        const duplicateQuery = `
            SELECT 
                denomination, coin_name, year, mint, coin_weight,
                COUNT(*) as count,
                STRING_AGG(id::text, ', ') as ids
            FROM coin_catalog 
            WHERE metal = 'Sn'
            GROUP BY denomination, coin_name, year, mint, coin_weight
            HAVING COUNT(*) > 1
            ORDER BY count DESC
        `;
        
        const duplicateResult = await pool.query(duplicateQuery);
        
        if (duplicateResult.rows.length > 0) {
            console.log(`\n❌ Найдено ${duplicateResult.rows.length} групп дубликатов:`);
            duplicateResult.rows.forEach((dup, index) => {
                console.log(`${index + 1}. ${dup.denomination} ${dup.coin_name} | ${dup.year || 'без года'} | ${dup.mint || 'неизвестный двор'} | вес: ${dup.coin_weight || 'неизвестно'} - ${dup.count} штук (ID: ${dup.ids})`);
            });
        } else {
            console.log('\n✅ Дубликатов не найдено - логика дедупликации работает!');
        }
        
        // Проверим конкретно монеты без года
        console.log('\n🔍 Проверяем монеты без года...');
        const noYearQuery = `
            SELECT 
                denomination, coin_name, mint, coin_weight,
                COUNT(*) as count,
                STRING_AGG(id::text, ', ') as ids
            FROM coin_catalog 
            WHERE metal = 'Sn' AND year IS NULL
            GROUP BY denomination, coin_name, mint, coin_weight
            HAVING COUNT(*) > 1
            ORDER BY count DESC
        `;
        
        const noYearResult = await pool.query(noYearQuery);
        
        if (noYearResult.rows.length > 0) {
            console.log(`\n❌ Найдено ${noYearResult.rows.length} групп дубликатов без года:`);
            noYearResult.rows.forEach((dup, index) => {
                console.log(`${index + 1}. ${dup.denomination} ${dup.coin_name} | ${dup.mint || 'неизвестный двор'} | вес: ${dup.coin_weight || 'неизвестно'} - ${dup.count} штук (ID: ${dup.ids})`);
            });
        } else {
            console.log('\n✅ Дубликатов без года не найдено!');
        }
        
        // Покажем все оловянные монеты для сравнения
        console.log('\n📋 Все оловянные монеты в каталоге:');
        const allSnQuery = `
            SELECT 
                id, denomination, coin_name, year, mint, coin_weight, condition
            FROM coin_catalog 
            WHERE metal = 'Sn'
            ORDER BY denomination, coin_name, year, mint
        `;
        
        const allSnResult = await pool.query(allSnQuery);
        allSnResult.rows.forEach((coin, index) => {
            console.log(`${index + 1}. ID: ${coin.id} | ${coin.denomination} ${coin.coin_name} | ${coin.year || 'без года'} | ${coin.mint || 'неизвестный двор'} | вес: ${coin.coin_weight || 'неизвестно'} | ${coin.condition || 'неизвестно'}`);
        });
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    } finally {
        await pool.end();
    }
}

testDeduplicationFix();

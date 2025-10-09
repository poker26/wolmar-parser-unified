const { Pool } = require('pg');
const config = require('./config');

async function cleanDuplicates() {
    const pool = new Pool(config.dbConfig);
    
    try {
        console.log('🧹 Очищаем дубликаты в каталоге монет...');
        
        // Найдем все дубликаты
        const duplicateQuery = `
            SELECT 
                denomination, coin_name, year, mint, coin_weight,
                COUNT(*) as count,
                STRING_AGG(id::text, ', ') as ids,
                MIN(id) as keep_id
            FROM coin_catalog 
            WHERE metal = 'Sn'
            GROUP BY denomination, coin_name, year, mint, coin_weight
            HAVING COUNT(*) > 1
            ORDER BY count DESC
        `;
        
        const duplicateResult = await pool.query(duplicateQuery);
        
        if (duplicateResult.rows.length === 0) {
            console.log('✅ Дубликатов не найдено');
            return;
        }
        
        console.log(`🔍 Найдено ${duplicateResult.rows.length} групп дубликатов:`);
        
        for (const dup of duplicateResult.rows) {
            console.log(`\n📋 Обрабатываем: ${dup.denomination} ${dup.coin_name} | ${dup.year || 'без года'} | ${dup.mint || 'неизвестный двор'} | вес: ${dup.coin_weight || 'неизвестно'} - ${dup.count} штук`);
            
            // Получаем все ID кроме того, который оставляем
            const ids = dup.ids.split(', ').map(id => parseInt(id));
            const idsToDelete = ids.filter(id => id !== dup.keep_id);
            
            console.log(`   Оставляем ID: ${dup.keep_id}`);
            console.log(`   Удаляем ID: ${idsToDelete.join(', ')}`);
            
            // Удаляем дубликаты
            const deleteQuery = `
                DELETE FROM coin_catalog 
                WHERE id = ANY($1)
            `;
            
            const deleteResult = await pool.query(deleteQuery, [idsToDelete]);
            console.log(`   ✅ Удалено ${deleteResult.rowCount} записей`);
        }
        
        // Проверим результат
        console.log('\n🔍 Проверяем результат...');
        const checkQuery = `
            SELECT 
                denomination, coin_name, year, mint, coin_weight,
                COUNT(*) as count
            FROM coin_catalog 
            WHERE metal = 'Sn'
            GROUP BY denomination, coin_name, year, mint, coin_weight
            HAVING COUNT(*) > 1
        `;
        
        const checkResult = await pool.query(checkQuery);
        
        if (checkResult.rows.length === 0) {
            console.log('✅ Все дубликаты успешно удалены!');
        } else {
            console.log(`❌ Осталось ${checkResult.rows.length} групп дубликатов`);
        }
        
        // Покажем финальный список оловянных монет
        console.log('\n📋 Финальный список оловянных монет:');
        const finalQuery = `
            SELECT 
                id, denomination, coin_name, year, mint, coin_weight, condition
            FROM coin_catalog 
            WHERE metal = 'Sn'
            ORDER BY denomination, coin_name, year, mint
        `;
        
        const finalResult = await pool.query(finalQuery);
        finalResult.rows.forEach((coin, index) => {
            console.log(`${index + 1}. ID: ${coin.id} | ${coin.denomination} ${coin.coin_name} | ${coin.year || 'без года'} | ${coin.mint || 'неизвестный двор'} | вес: ${coin.coin_weight || 'неизвестно'} | ${coin.condition || 'неизвестно'}`);
        });
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    } finally {
        await pool.end();
    }
}

cleanDuplicates();

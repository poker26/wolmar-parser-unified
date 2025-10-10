const { Pool } = require('pg');
const config = require('./config');

async function cleanAllDuplicates() {
    const pool = new Pool(config.dbConfig);
    
    try {
        console.log('🧹 Очищаем ВСЕ дубликаты в каталоге монет...');
        
        // Сначала посмотрим общую статистику
        const totalQuery = 'SELECT COUNT(*) as total FROM coin_catalog';
        const totalResult = await pool.query(totalQuery);
        console.log(`📊 Всего записей в каталоге: ${totalResult.rows[0].total}`);
        
        // Найдем все дубликаты по всем металлам
        const duplicateQuery = `
            SELECT 
                denomination, coin_name, year, mint, coin_weight, metal,
                COUNT(*) as count,
                STRING_AGG(id::text, ', ') as ids,
                MIN(id) as keep_id
            FROM coin_catalog 
            GROUP BY denomination, coin_name, year, mint, coin_weight, metal
            HAVING COUNT(*) > 1
            ORDER BY count DESC, metal
        `;
        
        const duplicateResult = await pool.query(duplicateQuery);
        
        if (duplicateResult.rows.length === 0) {
            console.log('✅ Дубликатов не найдено');
            return;
        }
        
        console.log(`🔍 Найдено ${duplicateResult.rows.length} групп дубликатов:`);
        
        let totalDeleted = 0;
        let processedGroups = 0;
        
        // Покажем статистику по металлам
        const metalStats = {};
        duplicateResult.rows.forEach(dup => {
            if (!metalStats[dup.metal]) {
                metalStats[dup.metal] = { groups: 0, total: 0 };
            }
            metalStats[dup.metal].groups++;
            metalStats[dup.metal].total += dup.count - 1; // -1 потому что одну оставляем
        });
        
        console.log('\n📊 Статистика дубликатов по металлам:');
        Object.entries(metalStats).forEach(([metal, stats]) => {
            console.log(`   ${metal}: ${stats.groups} групп, ${stats.total} дубликатов`);
        });
        
        console.log('\n🧹 Начинаем очистку...');
        
        for (const dup of duplicateResult.rows) {
            processedGroups++;
            
            if (processedGroups % 100 === 0) {
                console.log(`   Обработано групп: ${processedGroups}/${duplicateResult.rows.length}`);
            }
            
            // Получаем все ID кроме того, который оставляем
            const ids = dup.ids.split(', ').map(id => parseInt(id));
            const idsToDelete = ids.filter(id => id !== dup.keep_id);
            
            // Удаляем дубликаты
            const deleteQuery = `
                DELETE FROM coin_catalog 
                WHERE id = ANY($1)
            `;
            
            const deleteResult = await pool.query(deleteQuery, [idsToDelete]);
            totalDeleted += deleteResult.rowCount;
            
            if (processedGroups <= 10) { // Показываем детали только для первых 10
                console.log(`   ${dup.metal} | ${dup.denomination} ${dup.coin_name} | ${dup.year || 'без года'} | ${dup.mint || 'неизвестный двор'} | вес: ${dup.coin_weight || 'неизвестно'} - удалено ${deleteResult.rowCount} из ${dup.count}`);
            }
        }
        
        console.log(`\n✅ Очистка завершена!`);
        console.log(`   Обработано групп: ${processedGroups}`);
        console.log(`   Удалено дубликатов: ${totalDeleted}`);
        
        // Проверим результат
        console.log('\n🔍 Проверяем результат...');
        const checkQuery = `
            SELECT 
                denomination, coin_name, year, mint, coin_weight, metal,
                COUNT(*) as count
            FROM coin_catalog 
            GROUP BY denomination, coin_name, year, mint, coin_weight, metal
            HAVING COUNT(*) > 1
        `;
        
        const checkResult = await pool.query(checkQuery);
        
        if (checkResult.rows.length === 0) {
            console.log('✅ Все дубликаты успешно удалены!');
        } else {
            console.log(`❌ Осталось ${checkResult.rows.length} групп дубликатов`);
        }
        
        // Финальная статистика
        const finalTotalQuery = 'SELECT COUNT(*) as total FROM coin_catalog';
        const finalTotalResult = await pool.query(finalTotalQuery);
        console.log(`\n📊 Финальная статистика:`);
        console.log(`   Было записей: ${totalResult.rows[0].total}`);
        console.log(`   Стало записей: ${finalTotalResult.rows[0].total}`);
        console.log(`   Удалено записей: ${totalResult.rows[0].total - finalTotalResult.rows[0].total}`);
        
        // Статистика по металлам после очистки
        const metalStatsQuery = `
            SELECT metal, COUNT(*) as count
            FROM coin_catalog 
            WHERE metal IS NOT NULL
            GROUP BY metal
            ORDER BY count DESC
        `;
        
        const metalStatsResult = await pool.query(metalStatsQuery);
        console.log('\n📊 Количество монет по металлам после очистки:');
        metalStatsResult.rows.forEach((row, index) => {
            console.log(`   ${index + 1}. ${row.metal}: ${row.count} монет`);
        });
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
        console.error('Stack:', error.stack);
    } finally {
        await pool.end();
    }
}

cleanAllDuplicates();

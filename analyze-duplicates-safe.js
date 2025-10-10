const { Pool } = require('pg');
const config = require('./config');

async function analyzeDuplicatesSafe() {
    const pool = new Pool(config.dbConfig);
    
    try {
        console.log('🔍 Анализируем дубликаты БЕЗ удаления...');
        
        // Сначала посмотрим общую статистику
        const totalQuery = 'SELECT COUNT(*) as total FROM coin_catalog';
        const totalResult = await pool.query(totalQuery);
        console.log(`📊 Всего записей в каталоге: ${totalResult.rows[0].total}`);
        
        // Найдем все дубликаты, но ограничим результат
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
            LIMIT 20
        `;
        
        const duplicateResult = await pool.query(duplicateQuery);
        
        if (duplicateResult.rows.length === 0) {
            console.log('✅ Дубликатов не найдено');
            return;
        }
        
        console.log(`🔍 Найдено ${duplicateResult.rows.length} групп дубликатов (показаны первые 20):`);
        
        let totalToDelete = 0;
        
        // Покажем детали каждой группы
        duplicateResult.rows.forEach((dup, index) => {
            const ids = dup.ids.split(', ').map(id => parseInt(id));
            const idsToDelete = ids.filter(id => id !== dup.keep_id);
            totalToDelete += idsToDelete.length;
            
            console.log(`\n${index + 1}. ${dup.metal} | ${dup.denomination} ${dup.coin_name} | ${dup.year || 'без года'} | ${dup.mint || 'неизвестный двор'} | вес: ${dup.coin_weight || 'неизвестно'}`);
            console.log(`   Всего: ${dup.count} штук`);
            console.log(`   Оставим: ID ${dup.keep_id}`);
            console.log(`   Удалим: ID ${idsToDelete.join(', ')} (${idsToDelete.length} штук)`);
        });
        
        console.log(`\n📊 Итого по первым 20 группам:`);
        console.log(`   Записей к удалению: ${totalToDelete}`);
        
        // Статистика по металлам для первых 20 групп
        const metalStats = {};
        duplicateResult.rows.forEach(dup => {
            if (!metalStats[dup.metal]) {
                metalStats[dup.metal] = { groups: 0, toDelete: 0 };
            }
            metalStats[dup.metal].groups++;
            metalStats[dup.metal].toDelete += dup.count - 1;
        });
        
        console.log('\n📊 Статистика по металлам (первые 20 групп):');
        Object.entries(metalStats).forEach(([metal, stats]) => {
            console.log(`   ${metal}: ${stats.groups} групп, ${stats.toDelete} к удалению`);
        });
        
        // Проверим общее количество дубликатов
        const totalDuplicatesQuery = `
            SELECT 
                COUNT(*) as total_groups,
                SUM(count - 1) as total_to_delete
            FROM (
                SELECT 
                    denomination, coin_name, year, mint, coin_weight, metal,
                    COUNT(*) as count
                FROM coin_catalog 
                GROUP BY denomination, coin_name, year, mint, coin_weight, metal
                HAVING COUNT(*) > 1
            ) as duplicates
        `;
        
        const totalDuplicatesResult = await pool.query(totalDuplicatesQuery);
        console.log(`\n📊 Общая статистика дубликатов:`);
        console.log(`   Всего групп дубликатов: ${totalDuplicatesResult.rows[0].total_groups}`);
        console.log(`   Всего записей к удалению: ${totalDuplicatesResult.rows[0].total_to_delete}`);
        
        // Покажем примеры самых проблемных групп
        console.log('\n🔍 Топ-10 самых проблемных групп дубликатов:');
        const topDuplicatesQuery = `
            SELECT 
                denomination, coin_name, year, mint, coin_weight, metal,
                COUNT(*) as count
            FROM coin_catalog 
            GROUP BY denomination, coin_name, year, mint, coin_weight, metal
            HAVING COUNT(*) > 1
            ORDER BY count DESC
            LIMIT 10
        `;
        
        const topDuplicatesResult = await pool.query(topDuplicatesQuery);
        topDuplicatesResult.rows.forEach((dup, index) => {
            console.log(`${index + 1}. ${dup.metal} | ${dup.denomination} ${dup.coin_name} | ${dup.year || 'без года'} | ${dup.mint || 'неизвестный двор'} | вес: ${dup.coin_weight || 'неизвестно'} - ${dup.count} штук`);
        });
        
        console.log('\n⚠️  ВНИМАНИЕ: Это только анализ! Ничего не удалено.');
        console.log('   Для фактического удаления запустите clean-duplicates-execute.js');
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
        console.error('Stack:', error.stack);
    } finally {
        await pool.end();
    }
}

analyzeDuplicatesSafe();

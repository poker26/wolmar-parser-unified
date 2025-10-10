const { Pool } = require('pg');
const config = require('./config');

async function cleanDuplicatesBatch() {
    const pool = new Pool(config.dbConfig);
    
    try {
        console.log('🧹 Удаляем дубликаты пакетами...');
        
        // Сначала проанализируем дубликаты по группам
        console.log('\n📊 Анализируем дубликаты по группам...');
        
        const analyzeQuery = `
            SELECT 
                denomination,
                metal,
                coin_weight,
                year,
                COUNT(*) as count
            FROM coin_catalog 
            WHERE denomination IS NOT NULL
            AND metal IS NOT NULL
            GROUP BY denomination, metal, coin_weight, year
            HAVING COUNT(*) > 1
            ORDER BY count DESC
            LIMIT 50
        `;
        
        const analyzeResult = await pool.query(analyzeQuery);
        
        console.log('\n🔍 Топ-50 групп дубликатов:');
        analyzeResult.rows.forEach((row, index) => {
            console.log(`${index + 1}. "${row.denomination}" ${row.metal} ${row.coin_weight}g ${row.year}г: ${row.count} записей`);
        });
        
        // Подсчитаем общее количество дубликатов
        const totalDuplicatesQuery = `
            SELECT COUNT(*) as total_duplicates
            FROM (
                SELECT denomination, metal, coin_weight, year
                FROM coin_catalog 
                WHERE denomination IS NOT NULL
                AND metal IS NOT NULL
                GROUP BY denomination, metal, coin_weight, year
                HAVING COUNT(*) > 1
            ) as duplicates
        `;
        
        const totalResult = await pool.query(totalDuplicatesQuery);
        const totalDuplicates = totalResult.rows[0].total_duplicates;
        
        console.log(`\n📈 Всего групп дубликатов: ${totalDuplicates}`);
        
        // Подсчитаем общее количество записей для удаления
        const recordsToDeleteQuery = `
            SELECT SUM(count - 1) as records_to_delete
            FROM (
                SELECT COUNT(*) as count
                FROM coin_catalog 
                WHERE denomination IS NOT NULL
                AND metal IS NOT NULL
                GROUP BY denomination, metal, coin_weight, year
                HAVING COUNT(*) > 1
            ) as duplicates
        `;
        
        const deleteResult = await pool.query(recordsToDeleteQuery);
        const recordsToDelete = deleteResult.rows[0].records_to_delete;
        
        console.log(`📉 Записей для удаления: ${recordsToDelete}`);
        
        if (recordsToDelete > 100000) {
            console.log('\n⚠️  Слишком много записей для удаления!');
            console.log('   Рекомендуется удалять дубликаты по группам.');
            
            // Удаляем только самые большие группы дубликатов
            console.log('\n🗑️  Удаляем дубликаты из топ-10 групп...');
            
            const topGroupsQuery = `
                SELECT 
                    denomination,
                    metal,
                    coin_weight,
                    year,
                    COUNT(*) as count
                FROM coin_catalog 
                WHERE denomination IS NOT NULL
                AND metal IS NOT NULL
                GROUP BY denomination, metal, coin_weight, year
                HAVING COUNT(*) > 1
                ORDER BY count DESC
                LIMIT 10
            `;
            
            const topGroupsResult = await pool.query(topGroupsQuery);
            
            let totalDeleted = 0;
            
            for (const group of topGroupsResult.rows) {
                console.log(`\n🗑️  Удаляем дубликаты: "${group.denomination}" ${group.metal} ${group.coin_weight}g ${group.year}г (${group.count} записей)`);
                
                const deleteGroupQuery = `
                    DELETE FROM coin_catalog 
                    WHERE id IN (
                        SELECT id 
                        FROM (
                            SELECT id,
                                   ROW_NUMBER() OVER (
                                       PARTITION BY denomination, metal, coin_weight, year 
                                       ORDER BY id ASC
                                   ) as rn
                            FROM coin_catalog 
                            WHERE denomination = $1
                            AND metal = $2
                            AND (coin_weight = $3 OR (coin_weight IS NULL AND $3 IS NULL))
                            AND (year = $4 OR (year IS NULL AND $4 IS NULL))
                        ) as ranked
                        WHERE rn > 1
                    )
                `;
                
                const deleteGroupResult = await pool.query(deleteGroupQuery, [
                    group.denomination,
                    group.metal,
                    group.coin_weight,
                    group.year
                ]);
                
                totalDeleted += deleteGroupResult.rowCount;
                console.log(`   Удалено: ${deleteGroupResult.rowCount} записей`);
            }
            
            console.log(`\n✅ Всего удалено: ${totalDeleted} записей`);
            
        } else {
            console.log('\n🗑️  Удаляем все дубликаты...');
            
            const deleteQuery = `
                DELETE FROM coin_catalog 
                WHERE id IN (
                    SELECT id 
                    FROM (
                        SELECT id,
                               ROW_NUMBER() OVER (
                                   PARTITION BY denomination, metal, coin_weight, year 
                                   ORDER BY id ASC
                               ) as rn
                        FROM coin_catalog 
                        WHERE denomination IS NOT NULL
                        AND metal IS NOT NULL
                    ) as ranked
                    WHERE rn > 1
                )
            `;
            
            const deleteStartTime = Date.now();
            const deleteResult2 = await pool.query(deleteQuery);
            const deleteEndTime = Date.now();
            
            console.log(`✅ Удаление завершено!`);
            console.log(`   Удалено записей: ${deleteResult2.rowCount}`);
            console.log(`   Время выполнения: ${(deleteEndTime - deleteStartTime) / 1000} сек`);
        }
        
        // Проверяем результат
        console.log('\n🔍 Проверяем результат...');
        
        const finalCheckQuery = `
            SELECT 
                denomination,
                metal,
                coin_weight,
                year,
                COUNT(*) as count
            FROM coin_catalog 
            WHERE denomination IS NOT NULL
            AND metal IS NOT NULL
            GROUP BY denomination, metal, coin_weight, year
            HAVING COUNT(*) > 1
            ORDER BY count DESC
            LIMIT 10
        `;
        
        const finalResult = await pool.query(finalCheckQuery);
        
        if (finalResult.rows.length === 0) {
            console.log('✅ Дубликаты успешно удалены!');
        } else {
            console.log('⚠️  Остались дубликаты:');
            finalResult.rows.forEach((row, index) => {
                console.log(`${index + 1}. "${row.denomination}" ${row.metal} ${row.coin_weight}g ${row.year}г: ${row.count} записей`);
            });
        }
        
        // Финальная статистика
        const finalStatsQuery = `
            SELECT COUNT(*) as total_records
            FROM coin_catalog
        `;
        
        const finalStats = await pool.query(finalStatsQuery);
        console.log(`\n📊 Итого записей в каталоге: ${finalStats.rows[0].total_records}`);
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    } finally {
        await pool.end();
    }
}

cleanDuplicatesBatch();

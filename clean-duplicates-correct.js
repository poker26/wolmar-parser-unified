const { Pool } = require('pg');
const config = require('./config');

async function cleanDuplicatesCorrect() {
    const pool = new Pool(config.dbConfig);
    
    try {
        console.log('🧹 Удаляем дубликаты с правильной логикой дедупликации...');
        
        // Сначала проанализируем дубликаты
        console.log('\n📊 Анализируем дубликаты...');
        
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
            LIMIT 20
        `;
        
        const analyzeResult = await pool.query(analyzeQuery);
        
        console.log('\n🔍 Топ-20 групп дубликатов:');
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
        
        if (recordsToDelete > 50000) {
            console.log('\n⚠️  ВНИМАНИЕ: Слишком много записей для удаления!');
            console.log('   Рекомендуется запустить скрипт пакетно или проверить логику.');
            return;
        }
        
        // Запрашиваем подтверждение
        console.log('\n❓ Продолжить удаление дубликатов? (y/N)');
        console.log('   Это действие необратимо!');
        
        // Для автоматического запуска (в продакшене можно убрать)
        const shouldProceed = process.argv.includes('--force');
        
        if (!shouldProceed) {
            console.log('   Запустите скрипт с флагом --force для подтверждения');
            return;
        }
        
        console.log('\n🗑️  Начинаем удаление дубликатов...');
        
        // Удаляем дубликаты, оставляя только одну запись с минимальным ID
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

cleanDuplicatesCorrect();
const { Pool } = require('pg');
const { getDeduplicationRules, CATEGORIES } = require('./category-classifier');
const isProduction = process.env.NODE_ENV === 'production' || process.env.PORT;
const config = require(isProduction ? './config.production' : './config');

async function removeTrueDuplicates() {
    const pool = new Pool(config.dbConfig);
    const client = await pool.connect();

    try {
        console.log('🗑️ Начинаем удаление истинных дубликатов...\n');

        // Категории с истинными дубликатами (абсолютно одинаковые описания)
        const trueDuplicateCategories = [
            CATEGORIES.MEDAL,    // Медали
            CATEGORIES.BADGE,    // Значки
            CATEGORIES.JEWELRY,  // Ювелирные изделия
            CATEGORIES.WATCH,    // Часы
            CATEGORIES.TABLEWARE, // Столовые приборы
            CATEGORIES.ORDER,    // Ордена
            CATEGORIES.TOKEN     // Жетоны
        ];

        let totalRemoved = 0;

        for (const category of trueDuplicateCategories) {
            console.log(`🏷️ Обрабатываем категорию: ${category}`);
            
            const rules = getDeduplicationRules(category);
            console.log(`   Правила дедупликации: ${rules.description}`);

            // Находим дубликаты для этой категории
            const duplicateQuery = `
                SELECT 
                    original_description,
                    COUNT(*) as count,
                    STRING_AGG(id::text, ', ' ORDER BY id) as ids,
                    MIN(id) as keep_id
                FROM coin_catalog 
                WHERE category = $1
                GROUP BY original_description
                HAVING COUNT(*) > 1
                ORDER BY count DESC
            `;

            const duplicateResult = await client.query(duplicateQuery, [category]);
            
            if (duplicateResult.rows.length === 0) {
                console.log('   ✅ Дубликатов не найдено');
                continue;
            }

            console.log(`   🔍 Найдено ${duplicateResult.rows.length} групп дубликатов`);

            let categoryRemoved = 0;
            let processedGroups = 0;

            for (const group of duplicateResult.rows) {
                const count = parseInt(group.count);
                const toRemove = count - 1; // Оставляем одну запись
                const idsToRemove = group.ids.split(', ').slice(1); // Удаляем все кроме первой

                if (idsToRemove.length > 0) {
                    // Удаляем дубликаты
                    const deleteQuery = `
                        DELETE FROM coin_catalog 
                        WHERE id = ANY($1::int[])
                    `;
                    
                    await client.query(deleteQuery, [idsToRemove]);
                    categoryRemoved += toRemove;
                }

                processedGroups++;
                
                if (processedGroups % 100 === 0) {
                    console.log(`     📈 Обработано групп: ${processedGroups}/${duplicateResult.rows.length}`);
                }
            }

            console.log(`   ✅ Удалено ${categoryRemoved} записей из категории ${category}`);
            totalRemoved += categoryRemoved;
        }

        console.log(`\n🎉 Удаление истинных дубликатов завершено!`);
        console.log(`📊 Всего удалено записей: ${totalRemoved}`);

        // Проверим итоговую статистику
        console.log(`\n📈 Итоговая статистика по категориям:`);
        const statsQuery = `
            SELECT 
                category,
                COUNT(*) as count
            FROM coin_catalog 
            GROUP BY category
            ORDER BY count DESC
        `;
        
        const statsResult = await client.query(statsQuery);
        statsResult.rows.forEach(row => {
            console.log(`   ${row.category}: ${row.count} записей`);
        });

        const totalRemaining = statsResult.rows.reduce((sum, row) => sum + parseInt(row.count), 0);
        console.log(`\n📊 Всего записей в каталоге: ${totalRemaining}`);

    } catch (error) {
        console.error('❌ Ошибка при удалении дубликатов:', error);
    } finally {
        client.release();
        await pool.end();
    }
}

removeTrueDuplicates();

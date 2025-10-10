const { Pool } = require('pg');
const { getDeduplicationRules, CATEGORIES } = require('./category-classifier');
const isProduction = process.env.NODE_ENV === 'production' || process.env.PORT;
const config = require(isProduction ? './config.production' : './config');

async function analyzeDuplicatesByCategory() {
    const pool = new Pool(config.dbConfig);
    const client = await pool.connect();

    try {
        console.log('🔍 Анализируем дубликаты по категориям с правильными критериями...\n');

        // Получаем статистику по категориям
        const categoryStatsQuery = `
            SELECT 
                category,
                COUNT(*) as total_records
            FROM coin_catalog 
            GROUP BY category
            ORDER BY total_records DESC
        `;
        
        const categoryStats = await client.query(categoryStatsQuery);
        console.log('📊 Статистика по категориям:');
        categoryStats.rows.forEach(row => {
            console.log(`   ${row.category}: ${row.total_records} записей`);
        });

        let totalDuplicates = 0;
        let totalToDelete = 0;

        // Анализируем дубликаты для каждой категории
        for (const categoryRow of categoryStats.rows) {
            const category = categoryRow.category;
            const totalRecords = categoryRow.total_records;
            
            console.log(`\n🏷️ Категория: ${category} (${totalRecords} записей)`);
            
            const rules = getDeduplicationRules(category);
            console.log(`   Правила дедупликации: ${rules.description}`);
            
            // Строим SQL запрос для поиска дубликатов
            const fields = rules.fields;
            const groupByClause = fields.join(', ');
            const havingClause = fields.map(field => {
                if (field === 'coin_weight') {
                    return `(coin_weight = $${fields.indexOf(field) + 1} OR (coin_weight IS NULL AND $${fields.indexOf(field) + 1} IS NULL))`;
                }
                return `${field} = $${fields.indexOf(field) + 1}`;
            }).join(' AND ');

            const duplicateQuery = `
                SELECT 
                    ${groupByClause},
                    COUNT(*) as count,
                    STRING_AGG(id::text, ', ' ORDER BY id) as ids,
                    MIN(id) as keep_id
                FROM coin_catalog 
                WHERE category = $1
                GROUP BY ${groupByClause}
                HAVING COUNT(*) > 1
                ORDER BY count DESC
                LIMIT 10
            `;

            const duplicateResult = await client.query(duplicateQuery, [category]);
            
            if (duplicateResult.rows.length === 0) {
                console.log('   ✅ Дубликатов не найдено');
                continue;
            }

            console.log(`   🔍 Найдено ${duplicateResult.rows.length} групп дубликатов (показаны первые 10):`);
            
            let categoryDuplicates = 0;
            let categoryToDelete = 0;

            duplicateResult.rows.forEach((row, index) => {
                const count = parseInt(row.count);
                const toDelete = count - 1; // Оставляем одну запись
                
                categoryDuplicates += count;
                categoryToDelete += toDelete;
                
                console.log(`\n   ${index + 1}. Группа дубликатов:`);
                fields.forEach(field => {
                    console.log(`      ${field}: ${row[field]}`);
                });
                console.log(`      Количество: ${count} записей`);
                console.log(`      К удалению: ${toDelete} записей`);
                console.log(`      ID: ${row.ids.substring(0, 100)}...`);
            });

            // Подсчитываем общее количество дубликатов для категории
            const totalDuplicatesQuery = `
                SELECT COUNT(*) as total_duplicates
                FROM (
                    SELECT ${groupByClause}
                    FROM coin_catalog 
                    WHERE category = $1
                    GROUP BY ${groupByClause}
                    HAVING COUNT(*) > 1
                ) as duplicates
            `;
            
            const totalDuplicatesResult = await client.query(totalDuplicatesQuery, [category]);
            const totalGroups = parseInt(totalDuplicatesResult.rows[0].total_duplicates);
            
            // Подсчитываем общее количество записей к удалению
            const totalToDeleteQuery = `
                SELECT SUM(count - 1) as total_to_delete
                FROM (
                    SELECT COUNT(*) as count
                    FROM coin_catalog 
                    WHERE category = $1
                    GROUP BY ${groupByClause}
                    HAVING COUNT(*) > 1
                ) as duplicates
            `;
            
            const totalToDeleteResult = await client.query(totalToDeleteQuery, [category]);
            const totalCategoryToDelete = parseInt(totalToDeleteResult.rows[0].total_to_delete || 0);
            
            console.log(`\n   📈 Итого для категории ${category}:`);
            console.log(`      Групп дубликатов: ${totalGroups}`);
            console.log(`      Записей к удалению: ${totalCategoryToDelete}`);
            console.log(`      Процент к удалению: ${((totalCategoryToDelete / totalRecords) * 100).toFixed(1)}%`);

            totalDuplicates += totalGroups;
            totalToDelete += totalCategoryToDelete;
        }

        console.log(`\n📊 ОБЩАЯ СТАТИСТИКА:`);
        console.log(`   Всего групп дубликатов: ${totalDuplicates}`);
        console.log(`   Всего записей к удалению: ${totalToDelete}`);
        console.log(`   Процент записей к удалению: ${((totalToDelete / 129144) * 100).toFixed(1)}%`);

        // Проверим самые проблемные категории
        console.log(`\n⚠️  САМЫЕ ПРОБЛЕМНЫЕ КАТЕГОРИИ:`);
        for (const categoryRow of categoryStats.rows.slice(0, 5)) {
            const category = categoryRow.category;
            const rules = getDeduplicationRules(category);
            const fields = rules.fields;
            const groupByClause = fields.join(', ');
            
            const totalToDeleteQuery = `
                SELECT SUM(count - 1) as total_to_delete
                FROM (
                    SELECT COUNT(*) as count
                    FROM coin_catalog 
                    WHERE category = $1
                    GROUP BY ${groupByClause}
                    HAVING COUNT(*) > 1
                ) as duplicates
            `;
            
            const totalToDeleteResult = await client.query(totalToDeleteQuery, [category]);
            const totalCategoryToDelete = parseInt(totalToDeleteResult.rows[0].total_to_delete || 0);
            const percentage = ((totalCategoryToDelete / categoryRow.total_records) * 100).toFixed(1);
            
            console.log(`   ${category}: ${totalCategoryToDelete} записей к удалению (${percentage}%)`);
        }

    } catch (error) {
        console.error('❌ Ошибка при анализе дубликатов по категориям:', error);
    } finally {
        client.release();
        await pool.end();
    }
}

analyzeDuplicatesByCategory();

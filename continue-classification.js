const { Pool } = require('pg');
const config = require('./config');
const { classifyItem, CATEGORIES } = require('./category-classifier');

async function continueClassification() {
    const pool = new Pool(config.dbConfig);
    
    try {
        console.log('🏷️ Продолжаем классификацию предметов в каталоге...');
        
        // Получаем общее количество записей
        const totalQuery = `SELECT COUNT(*) as total FROM coin_catalog`;
        const totalResult = await pool.query(totalQuery);
        const total = parseInt(totalResult.rows[0].total);
        console.log(`📊 Всего записей в каталоге: ${total}`);
        
        // Находим ID последней классифицированной записи
        const lastClassifiedQuery = `
            SELECT MAX(id) as max_id 
            FROM coin_catalog 
            WHERE category IS NOT NULL AND category != 'other'
        `;
        
        const lastClassifiedResult = await pool.query(lastClassifiedQuery);
        const lastClassifiedId = lastClassifiedResult.rows[0].max_id || 0;
        console.log(`📊 Продолжаем с ID: ${lastClassifiedId + 1}`);
        
        // Классифицируем пакетами по 1000 записей, начиная с последнего ID
        const batchSize = 1000;
        let processed = 0;
        let updated = 0;
        
        const categoryStats = {};
        
        // Получаем количество оставшихся записей
        const remainingQuery = `
            SELECT COUNT(*) as count 
            FROM coin_catalog 
            WHERE id > $1 AND (category = 'other' OR category IS NULL)
        `;
        
        const remainingResult = await pool.query(remainingQuery, [lastClassifiedId]);
        const remaining = parseInt(remainingResult.rows[0].count);
        console.log(`📊 Осталось классифицировать: ${remaining} записей`);
        
        for (let offset = lastClassifiedId; offset < total; offset += batchSize) {
            console.log(`\n🔄 Обрабатываем записи ${offset + 1}-${Math.min(offset + batchSize, total)}...`);
            
            // Получаем пакет записей, начиная с offset
            const batchQuery = `
                SELECT 
                    id,
                    denomination,
                    metal,
                    coin_weight,
                    original_description
                FROM coin_catalog 
                WHERE id > $1 AND (category = 'other' OR category IS NULL)
                ORDER BY id
                LIMIT $2
            `;
            
            const batchResult = await pool.query(batchQuery, [offset, batchSize]);
            
            if (batchResult.rows.length === 0) {
                console.log('✅ Все записи классифицированы!');
                break;
            }
            
            // Классифицируем каждую запись
            for (const row of batchResult.rows) {
                const category = classifyItem(
                    row.original_description,
                    row.denomination,
                    row.metal,
                    row.coin_weight
                );
                
                // Обновляем категорию в БД
                const updateQuery = `
                    UPDATE coin_catalog 
                    SET category = $1 
                    WHERE id = $2
                `;
                
                await pool.query(updateQuery, [category, row.id]);
                updated++;
                
                // Собираем статистику
                categoryStats[category] = (categoryStats[category] || 0) + 1;
                
                processed++;
                
                // Показываем прогресс каждые 100 записей
                if (processed % 100 === 0) {
                    const progress = ((processed / remaining) * 100).toFixed(1);
                    console.log(`  📈 Прогресс: ${processed}/${remaining} (${progress}%)`);
                }
            }
        }
        
        console.log('\n✅ Классификация завершена!');
        console.log(`📊 Обработано записей: ${processed}`);
        console.log(`📊 Обновлено записей: ${updated}`);
        
        // Выводим статистику по категориям
        console.log('\n📊 Статистика по категориям:');
        Object.entries(categoryStats)
            .sort(([,a], [,b]) => b - a)
            .forEach(([category, count]) => {
                const percentage = ((count / total) * 100).toFixed(2);
                console.log(`  ${category}: ${count} записей (${percentage}%)`);
            });
        
        // Проверяем финальный результат
        console.log('\n🔍 Проверяем финальный результат...');
        const verifyQuery = `
            SELECT 
                category,
                COUNT(*) as count
            FROM coin_catalog 
            GROUP BY category
            ORDER BY count DESC
        `;
        
        const verifyResult = await pool.query(verifyQuery);
        console.log('\n📊 Финальная статистика:');
        verifyResult.rows.forEach(row => {
            const percentage = ((row.count / total) * 100).toFixed(2);
            console.log(`  ${row.category}: ${row.count} записей (${percentage}%)`);
        });
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    } finally {
        await pool.end();
    }
}

continueClassification();

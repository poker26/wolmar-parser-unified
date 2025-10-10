const { Pool } = require('pg');
const config = require('./config');
const { classifyItem, CATEGORIES } = require('./category-classifier');

async function classifyAllItems() {
    const pool = new Pool(config.dbConfig);
    
    try {
        console.log('🏷️ Начинаем классификацию всех предметов в каталоге...');
        
        // Получаем общее количество записей
        const totalQuery = `SELECT COUNT(*) as total FROM coin_catalog`;
        const totalResult = await pool.query(totalQuery);
        const total = parseInt(totalResult.rows[0].total);
        console.log(`📊 Всего записей для классификации: ${total}`);
        
        // Классифицируем пакетами по 1000 записей
        const batchSize = 1000;
        let processed = 0;
        let updated = 0;
        
        const categoryStats = {};
        
        for (let offset = 0; offset < total; offset += batchSize) {
            console.log(`\n🔄 Обрабатываем записи ${offset + 1}-${Math.min(offset + batchSize, total)}...`);
            
            // Получаем пакет записей
            const batchQuery = `
                SELECT 
                    id,
                    denomination,
                    metal,
                    coin_weight,
                    original_description
                FROM coin_catalog 
                ORDER BY id
                LIMIT $1 OFFSET $2
            `;
            
            const batchResult = await pool.query(batchQuery, [batchSize, offset]);
            
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
                    const progress = ((processed / total) * 100).toFixed(1);
                    console.log(`  📈 Прогресс: ${processed}/${total} (${progress}%)`);
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
        
        // Проверяем результат
        console.log('\n🔍 Проверяем результат...');
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

classifyAllItems();

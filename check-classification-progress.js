const { Pool } = require('pg');
const config = require('./config');

async function checkClassificationProgress() {
    const pool = new Pool(config.dbConfig);
    
    try {
        console.log('🔍 Проверяем прогресс классификации...');
        
        // Проверяем общее количество записей
        const totalQuery = `SELECT COUNT(*) as total FROM coin_catalog`;
        const totalResult = await pool.query(totalQuery);
        const total = parseInt(totalResult.rows[0].total);
        console.log(`📊 Всего записей в каталоге: ${total}`);
        
        // Проверяем количество уже классифицированных записей
        const classifiedQuery = `
            SELECT 
                category,
                COUNT(*) as count
            FROM coin_catalog 
            WHERE category IS NOT NULL AND category != 'other'
            GROUP BY category
            ORDER BY count DESC
        `;
        
        const classifiedResult = await pool.query(classifiedQuery);
        const classifiedCount = classifiedResult.rows.reduce((sum, row) => sum + parseInt(row.count), 0);
        
        console.log(`📊 Уже классифицировано: ${classifiedCount} записей (${((classifiedCount / total) * 100).toFixed(1)}%)`);
        
        if (classifiedResult.rows.length > 0) {
            console.log('\n📊 Статистика по категориям:');
            classifiedResult.rows.forEach(row => {
                const percentage = ((row.count / total) * 100).toFixed(2);
                console.log(`  ${row.category}: ${row.count} записей (${percentage}%)`);
            });
        }
        
        // Проверяем количество записей с category = 'other' (не классифицированных)
        const otherQuery = `SELECT COUNT(*) as count FROM coin_catalog WHERE category = 'other' OR category IS NULL`;
        const otherResult = await pool.query(otherQuery);
        const otherCount = parseInt(otherResult.rows[0].count);
        
        console.log(`📊 Не классифицировано (other/null): ${otherCount} записей (${((otherCount / total) * 100).toFixed(1)}%)`);
        
        // Находим ID последней классифицированной записи
        const lastClassifiedQuery = `
            SELECT MAX(id) as max_id 
            FROM coin_catalog 
            WHERE category IS NOT NULL AND category != 'other'
        `;
        
        const lastClassifiedResult = await pool.query(lastClassifiedQuery);
        const lastClassifiedId = lastClassifiedResult.rows[0].max_id;
        
        if (lastClassifiedId) {
            console.log(`📊 Последний классифицированный ID: ${lastClassifiedId}`);
        }
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    } finally {
        await pool.end();
    }
}

checkClassificationProgress();

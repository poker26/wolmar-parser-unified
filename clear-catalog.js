const { Pool } = require('pg');
const config = require('./config');

async function clearCatalog() {
    const pool = new Pool(config.dbConfig);
    
    try {
        console.log('🧹 Очистка каталога монет...\n');
        
        // Проверяем текущее количество записей
        const countResult = await pool.query('SELECT COUNT(*) FROM coin_catalog');
        const currentCount = parseInt(countResult.rows[0].count);
        console.log(`📊 Текущее количество записей в каталоге: ${currentCount}`);
        
        if (currentCount === 0) {
            console.log('✅ Каталог уже пуст');
            return;
        }
        
        // Очищаем каталог
        console.log('🗑️ Удаляем все записи из каталога...');
        const deleteResult = await pool.query('DELETE FROM coin_catalog');
        console.log(`✅ Удалено записей: ${deleteResult.rowCount}`);
        
        // Проверяем результат
        const finalCountResult = await pool.query('SELECT COUNT(*) FROM coin_catalog');
        const finalCount = parseInt(finalCountResult.rows[0].count);
        console.log(`📊 Количество записей после очистки: ${finalCount}`);
        
        if (finalCount === 0) {
            console.log('\n🎉 Каталог успешно очищен!');
            console.log('💡 Теперь можно запустить парсер с новой логикой проверки дубликатов');
        } else {
            console.log('\n❌ Ошибка: каталог не полностью очищен');
        }
        
    } catch (error) {
        console.error('❌ Ошибка при очистке каталога:', error);
    } finally {
        await pool.end();
    }
}

// Запускаем очистку
clearCatalog();





const { Pool } = require('pg');
const config = require('./config');

async function checkCoinImages() {
    const pool = new Pool(config.dbConfig);
    
    try {
        console.log('🔍 Проверка изображений монет в БД...\n');
        
        // Проверяем общее количество записей
        const totalResult = await pool.query('SELECT COUNT(*) FROM coin_catalog');
        console.log(`📊 Всего записей в каталоге: ${totalResult.rows[0].count}`);
        
        // Проверяем записи с изображениями
        const imagesResult = await pool.query(`
            SELECT COUNT(*) 
            FROM coin_catalog 
            WHERE avers_image IS NOT NULL OR revers_image IS NOT NULL
        `);
        console.log(`🖼️ Записей с изображениями: ${imagesResult.rows[0].count}`);
        
        // Проверяем записи с аверсом
        const aversResult = await pool.query(`
            SELECT COUNT(*) 
            FROM coin_catalog 
            WHERE avers_image IS NOT NULL
        `);
        console.log(`🖼️ Записей с аверсом: ${aversResult.rows[0].count}`);
        
        // Проверяем записи с реверсом
        const reversResult = await pool.query(`
            SELECT COUNT(*) 
            FROM coin_catalog 
            WHERE revers_image IS NOT NULL
        `);
        console.log(`🖼️ Записей с реверсом: ${reversResult.rows[0].count}`);
        
        // Показываем примеры записей с изображениями
        console.log('\n📋 Примеры записей с изображениями:');
        const examplesResult = await pool.query(`
            SELECT id, coin_name, avers_image, revers_image
            FROM coin_catalog 
            WHERE avers_image IS NOT NULL OR revers_image IS NOT NULL
            LIMIT 5
        `);
        
        examplesResult.rows.forEach((row, index) => {
            console.log(`\n${index + 1}. ID: ${row.id}`);
            console.log(`   Название: ${row.coin_name}`);
            console.log(`   Аверс: ${row.avers_image ? '✅' : '❌'}`);
            console.log(`   Реверс: ${row.revers_image ? '✅' : '❌'}`);
            if (row.avers_image) {
                console.log(`   URL аверса: ${row.avers_image}`);
            }
            if (row.revers_image) {
                console.log(`   URL реверса: ${row.revers_image}`);
            }
        });
        
        // Проверяем записи без изображений
        const noImagesResult = await pool.query(`
            SELECT COUNT(*) 
            FROM coin_catalog 
            WHERE avers_image IS NULL AND revers_image IS NULL
        `);
        console.log(`\n❌ Записей без изображений: ${noImagesResult.rows[0].count}`);
        
        // Проверяем структуру таблицы
        console.log('\n🔍 Структура таблицы coin_catalog:');
        const columnsResult = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'coin_catalog' 
            AND column_name LIKE '%image%'
            ORDER BY ordinal_position
        `);
        
        if (columnsResult.rows.length > 0) {
            columnsResult.rows.forEach(row => {
                console.log(`   - ${row.column_name}: ${row.data_type}`);
            });
        } else {
            console.log('   ❌ Поля для изображений не найдены!');
        }
        
    } catch (error) {
        console.error('❌ Ошибка при проверке изображений:', error.message);
    } finally {
        await pool.end();
    }
}

checkCoinImages();



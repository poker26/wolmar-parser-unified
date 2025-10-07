const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool(config.dbConfig);

async function checkImagesInDb() {
    const client = await pool.connect();
    try {
        console.log('🔍 Проверка изображений в БД...\n');

        // Проверяем общее количество записей
        const totalResult = await client.query('SELECT COUNT(*) FROM coin_catalog');
        console.log(`📊 Всего записей в каталоге: ${totalResult.rows[0].count}`);

        // Проверяем записи с изображениями
        const imagesResult = await client.query(`
            SELECT COUNT(*) 
            FROM coin_catalog 
            WHERE avers_image_data IS NOT NULL OR revers_image_data IS NOT NULL
        `);
        console.log(`🖼️ Записей с изображениями: ${imagesResult.rows[0].count}`);

        // Проверяем записи с аверсом
        const aversResult = await client.query(`
            SELECT COUNT(*) 
            FROM coin_catalog 
            WHERE avers_image_data IS NOT NULL
        `);
        console.log(`🖼️ Записей с аверсом: ${aversResult.rows[0].count}`);

        // Проверяем записи с реверсом
        const reversResult = await client.query(`
            SELECT COUNT(*) 
            FROM coin_catalog 
            WHERE revers_image_data IS NOT NULL
        `);
        console.log(`🖼️ Записей с реверсом: ${reversResult.rows[0].count}`);

        // Показываем примеры записей с изображениями
        console.log('\n📋 Примеры записей с изображениями:');
        const examplesResult = await client.query(`
            SELECT id, coin_name, 
                   CASE WHEN avers_image_data IS NOT NULL THEN 'Есть' ELSE 'Нет' END as has_avers,
                   CASE WHEN revers_image_data IS NOT NULL THEN 'Есть' ELSE 'Нет' END as has_revers,
                   LENGTH(avers_image_data) as avers_size,
                   LENGTH(revers_image_data) as revers_size
            FROM coin_catalog 
            WHERE avers_image_data IS NOT NULL OR revers_image_data IS NOT NULL
            LIMIT 5
        `);
        
        examplesResult.rows.forEach((row, index) => {
            console.log(`\n${index + 1}. ID: ${row.id}`);
            console.log(`   Название: ${row.coin_name}`);
            console.log(`   Аверс: ${row.has_avers} (${row.avers_size} байт)`);
            console.log(`   Реверс: ${row.has_revers} (${row.revers_size} байт)`);
        });

        // Проверяем записи без изображений
        const noImagesResult = await client.query(`
            SELECT COUNT(*) 
            FROM coin_catalog 
            WHERE avers_image_data IS NULL AND revers_image_data IS NULL
        `);
        console.log(`\n❌ Записей без изображений: ${noImagesResult.rows[0].count}`);

    } catch (error) {
        console.error('❌ Ошибка при проверке изображений:', error);
    } finally {
        client.release();
        await pool.end();
    }
}

checkImagesInDb();







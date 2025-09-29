const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool(config.dbConfig);

async function clearCatalogDb() {
    const client = await pool.connect();
    try {
        console.log('🗑️ Полная очистка БД каталога...');

        // Удаляем все записи из таблицы coin_catalog
        const deleteResult = await client.query('DELETE FROM coin_catalog');
        console.log(`✅ Удалено записей: ${deleteResult.rowCount}`);

        // Сбрасываем счетчик ID, чтобы новые записи начинались с 1
        await client.query('ALTER SEQUENCE coin_catalog_id_seq RESTART WITH 1');
        console.log('✅ Счетчик ID сброшен');

        // Проверяем количество записей после очистки
        const countResult = await client.query('SELECT COUNT(*) FROM coin_catalog');
        console.log(`📊 Записей в каталоге: ${countResult.rows[0].count}`);

        console.log('\n🎉 БД каталога полностью очищена!');
    } catch (error) {
        console.error('❌ Ошибка при очистке БД:', error);
    } finally {
        client.release();
        await pool.end();
    }
}

clearCatalogDb();

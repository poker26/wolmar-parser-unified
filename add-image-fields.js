const { Pool } = require('pg');
const config = require('./config');

async function addImageFields() {
    const pool = new Pool(config.dbConfig);
    
    try {
        console.log('🔧 Добавление полей для изображений в таблицу coin_catalog...\n');
        
        // Добавляем поле для изображения аверса
        await pool.query(`
            ALTER TABLE coin_catalog
            ADD COLUMN IF NOT EXISTS avers_image TEXT
        `);
        console.log('✅ Добавлено поле avers_image (изображение аверса)');
        
        // Добавляем поле для изображения реверса
        await pool.query(`
            ALTER TABLE coin_catalog
            ADD COLUMN IF NOT EXISTS revers_image TEXT
        `);
        console.log('✅ Добавлено поле revers_image (изображение реверса)');
        
        // Создаем индексы для быстрого поиска
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_catalog_avers_image ON coin_catalog(avers_image)
        `);
        console.log('✅ Создан индекс для поиска по аверсу');
        
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_catalog_revers_image ON coin_catalog(revers_image)
        `);
        console.log('✅ Создан индекс для поиска по реверсу');
        
        console.log('\n🎉 Поля для изображений успешно добавлены!');
        
        // Проверяем структуру таблицы
        const result = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'coin_catalog' 
            AND column_name IN ('avers_image', 'revers_image')
            ORDER BY ordinal_position
        `);
        
        console.log('\n📋 Добавленные поля:');
        result.rows.forEach(row => {
            console.log(`- ${row.column_name}: ${row.data_type}`);
        });
        
        // Проверяем количество записей
        const countResult = await pool.query('SELECT COUNT(*) FROM coin_catalog');
        console.log(`\n📊 Всего записей в каталоге: ${countResult.rows[0].count}`);
        
    } catch (error) {
        console.error('❌ Ошибка при добавлении полей:', error.message);
    } finally {
        await pool.end();
    }
}

addImageFields();



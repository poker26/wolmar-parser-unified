const { Pool } = require('pg');
const config = require('./config');
const fs = require('fs');

async function checkImages() {
    const pool = new Pool(config.dbConfig);
    const client = await pool.connect();
    
    try {
        const result = await client.query('SELECT COUNT(*) as count FROM coin_catalog WHERE avers_image_path IS NOT NULL');
        console.log('📊 Записей с путями к изображениям аверса:', result.rows[0].count);
        
        const result2 = await client.query('SELECT COUNT(*) as count FROM coin_catalog WHERE revers_image_path IS NOT NULL');
        console.log('📊 Записей с путями к изображениям реверса:', result.rows[0].count);
        
        const result3 = await client.query('SELECT avers_image_path, revers_image_path FROM coin_catalog WHERE avers_image_path IS NOT NULL LIMIT 5');
        console.log('\n🔍 Примеры путей к изображениям:');
        result3.rows.forEach((row, index) => {
            console.log(`${index + 1}. Аверс: ${row.avers_image_path}`);
            console.log(`   Реверс: ${row.revers_image_path}`);
        });
        
        // Проверим, существуют ли файлы
        console.log('\n📁 Проверка существования файлов:');
        const result4 = await client.query('SELECT avers_image_path FROM coin_catalog WHERE avers_image_path IS NOT NULL LIMIT 3');
        for (const row of result4.rows) {
            const exists = fs.existsSync(row.avers_image_path);
            console.log(`${row.avers_image_path}: ${exists ? '✅ существует' : '❌ не найден'}`);
        }
        
    } finally {
        client.release();
        await pool.end();
    }
}

checkImages().catch(console.error);

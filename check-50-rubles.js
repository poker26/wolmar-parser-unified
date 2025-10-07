const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool(config.dbConfig);

async function check50Rubles() {
    const client = await pool.connect();
    try {
        console.log('🔍 Поиск монет "50 рублей" с информацией о весе...\n');

        // Ищем монеты с "50 рублей" в названии
        const result = await client.query(`
            SELECT id, coin_name, metal, coin_weight, fineness, pure_metal_weight, weight_oz, original_description
            FROM coin_catalog 
            WHERE coin_name ILIKE '%50 рублей%'
            ORDER BY id
            LIMIT 10
        `);
        
        console.log(`📊 Найдено монет "50 рублей": ${result.rows.length}\n`);
        
        result.rows.forEach((row, index) => {
            console.log(`${index + 1}. ID: ${row.id}`);
            console.log(`   Название: ${row.coin_name}`);
            console.log(`   Металл: ${row.metal || 'не указан'}`);
            console.log(`   Вес монеты: ${row.coin_weight || 'не указан'}г`);
            console.log(`   Проба: ${row.fineness || 'не указана'}`);
            console.log(`   Чистый металл: ${row.pure_metal_weight || 'не указан'}г`);
            console.log(`   Вес в унциях: ${row.weight_oz || 'не указан'}oz`);
            console.log(`   Описание: ${row.original_description.substring(0, 150)}...`);
            console.log('');
        });

        // Проверяем, есть ли в описаниях упоминания веса
        const weightMentions = await client.query(`
            SELECT COUNT(*) 
            FROM coin_catalog 
            WHERE coin_name ILIKE '%50 рублей%' 
            AND (original_description ILIKE '%гр%' OR original_description ILIKE '%oz%' OR original_description ILIKE '%Au %' OR original_description ILIKE '%Ag %' OR original_description ILIKE '%Pt %')
        `);
        
        console.log(`📊 Монет "50 рублей" с упоминанием веса в описании: ${weightMentions.rows[0].count}`);

    } catch (error) {
        console.error('❌ Ошибка при поиске монет "50 рублей":', error);
    } finally {
        client.release();
        await pool.end();
    }
}

check50Rubles();







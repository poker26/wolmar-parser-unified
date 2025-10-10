const { Pool } = require('pg');
const isProduction = process.env.NODE_ENV === 'production' || process.env.PORT;
const config = require(isProduction ? './config.production' : './config');

async function checkNullExamples() {
    const pool = new Pool(config.dbConfig);
    const client = await pool.connect();

    try {
        console.log('🔍 Проверяем записи с NULL значениями...\n');

        // Посмотрим на записи с номиналом "1" и NULL значениями
        console.log('1️⃣ Записи с номиналом "1" и NULL значениями:');
        const nullQuery = `
            SELECT id, denomination, coin_name, year, mint, coin_weight, metal, 
                   original_description, category
            FROM coin_catalog 
            WHERE denomination = '1' 
            AND year IS NULL 
            AND coin_weight IS NULL
            ORDER BY id
            LIMIT 10
        `;
        
        const nullResults = await client.query(nullQuery);
        nullResults.rows.forEach((row, index) => {
            console.log(`\n   Запись ${index + 1} (ID: ${row.id}):`);
            console.log(`     Номинал: "${row.denomination}"`);
            console.log(`     Название: "${row.coin_name}"`);
            console.log(`     Год: ${row.year}`);
            console.log(`     Монетный двор: "${row.mint}"`);
            console.log(`     Вес: ${row.coin_weight}`);
            console.log(`     Металл: ${row.metal}`);
            console.log(`     Категория: ${row.category}`);
            console.log(`     Описание: "${row.original_description?.substring(0, 200)}..."`);
        });

        // Посмотрим на записи с серебром и NULL значениями
        console.log('\n2️⃣ Записи с серебром (Ag) и NULL значениями:');
        const silverNullQuery = `
            SELECT id, denomination, coin_name, year, mint, coin_weight, metal, 
                   original_description, category
            FROM coin_catalog 
            WHERE denomination = '1' 
            AND metal = 'Ag'
            AND year IS NULL 
            AND coin_weight IS NULL
            ORDER BY id
            LIMIT 5
        `;
        
        const silverNullResults = await client.query(silverNullQuery);
        silverNullResults.rows.forEach((row, index) => {
            console.log(`\n   Запись ${index + 1} (ID: ${row.id}):`);
            console.log(`     Описание: "${row.original_description?.substring(0, 200)}..."`);
        });

        // Проверим, действительно ли это разные монеты
        console.log('\n3️⃣ Проверка уникальности описаний:');
        const uniqueDescriptionsQuery = `
            SELECT 
                COUNT(*) as total_records,
                COUNT(DISTINCT original_description) as unique_descriptions
            FROM coin_catalog 
            WHERE denomination = '1' 
            AND year IS NULL 
            AND coin_weight IS NULL
        `;
        
        const uniqueStats = await client.query(uniqueDescriptionsQuery);
        const stats = uniqueStats.rows[0];
        console.log(`   Всего записей с номиналом "1" и NULL: ${stats.total_records}`);
        console.log(`   Уникальных описаний: ${stats.unique_descriptions}`);
        console.log(`   Процент уникальности: ${((stats.unique_descriptions / stats.total_records) * 100).toFixed(1)}%`);

        // Посмотрим на несколько уникальных описаний
        console.log('\n4️⃣ Примеры уникальных описаний:');
        const uniqueDescQuery = `
            SELECT DISTINCT original_description
            FROM coin_catalog 
            WHERE denomination = '1' 
            AND year IS NULL 
            AND coin_weight IS NULL
            ORDER BY original_description
            LIMIT 10
        `;
        
        const uniqueDescResults = await client.query(uniqueDescQuery);
        uniqueDescResults.rows.forEach((row, index) => {
            console.log(`   ${index + 1}. "${row.original_description}"`);
        });

        // Проверим, есть ли записи с одинаковыми описаниями
        console.log('\n5️⃣ Проверка записей с одинаковыми описаниями:');
        const sameDescQuery = `
            SELECT 
                original_description,
                COUNT(*) as count,
                STRING_AGG(id::text, ', ' ORDER BY id) as ids
            FROM coin_catalog 
            WHERE denomination = '1' 
            AND year IS NULL 
            AND coin_weight IS NULL
            GROUP BY original_description
            HAVING COUNT(*) > 1
            ORDER BY count DESC
            LIMIT 5
        `;
        
        const sameDescResults = await client.query(sameDescQuery);
        sameDescResults.rows.forEach((row, index) => {
            console.log(`\n   ${index + 1}. Описание: "${row.original_description}"`);
            console.log(`      Количество: ${row.count} записей`);
            console.log(`      ID: ${row.ids.substring(0, 100)}...`);
        });

    } catch (error) {
        console.error('❌ Ошибка при проверке NULL записей:', error);
    } finally {
        client.release();
        await pool.end();
    }
}

checkNullExamples();

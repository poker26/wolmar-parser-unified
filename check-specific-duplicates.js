const { Pool } = require('pg');
const isProduction = process.env.NODE_ENV === 'production' || process.env.PORT;
const config = require(isProduction ? './config.production' : './config');

async function checkSpecificDuplicates() {
    const pool = new Pool(config.dbConfig);
    const client = await pool.connect();

    try {
        console.log('🔍 Проверяем конкретные примеры дубликатов...\n');

        // Проверим группу с серебряными монетами номиналом "1"
        console.log('1️⃣ Группа: номинал "1", металл Ag, вес NULL, год NULL (6,527 записей):');
        const silverQuery = `
            SELECT id, denomination, coin_name, year, mint, coin_weight, metal, 
                   original_description, category
            FROM coin_catalog 
            WHERE denomination = '1' 
            AND metal = 'Ag'
            AND coin_weight IS NULL 
            AND year IS NULL
            ORDER BY id
            LIMIT 5
        `;
        
        const silverResults = await client.query(silverQuery);
        silverResults.rows.forEach((row, index) => {
            console.log(`\n   Запись ${index + 1} (ID: ${row.id}):`);
            console.log(`     Описание: "${row.original_description?.substring(0, 200)}..."`);
        });

        // Проверим группу с медными монетами номиналом "1"
        console.log('\n2️⃣ Группа: номинал "1", металл Cu, вес NULL, год NULL (1,985 записей):');
        const copperQuery = `
            SELECT id, denomination, coin_name, year, mint, coin_weight, metal, 
                   original_description, category
            FROM coin_catalog 
            WHERE denomination = '1' 
            AND metal = 'Cu'
            AND coin_weight IS NULL 
            AND year IS NULL
            ORDER BY id
            LIMIT 5
        `;
        
        const copperResults = await client.query(copperQuery);
        copperResults.rows.forEach((row, index) => {
            console.log(`\n   Запись ${index + 1} (ID: ${row.id}):`);
            console.log(`     Описание: "${row.original_description?.substring(0, 200)}..."`);
        });

        // Проверим группу с медалями
        console.log('\n3️⃣ Группа медалей: "Медаль памятная Борис Громов. Россия Ag." (106 записей):');
        const medalQuery = `
            SELECT id, denomination, coin_name, year, mint, coin_weight, metal, 
                   original_description, category
            FROM coin_catalog 
            WHERE original_description = 'Медаль памятная Борис Громов. Россия Ag.'
            ORDER BY id
            LIMIT 5
        `;
        
        const medalResults = await client.query(medalQuery);
        medalResults.rows.forEach((row, index) => {
            console.log(`\n   Запись ${index + 1} (ID: ${row.id}):`);
            console.log(`     Описание: "${row.original_description}"`);
        });

        // Проверим группу с ювелирными изделиями
        console.log('\n4️⃣ Группа ювелирных изделий: "Серьги с танзанитами и бриллиантами Au." (41 запись):');
        const jewelryQuery = `
            SELECT id, denomination, coin_name, year, mint, coin_weight, metal, 
                   original_description, category
            FROM coin_catalog 
            WHERE original_description = 'Серьги с танзанитами и бриллиантами Au. | Серьги с танзанитами и бриллиантами. Золото 585 пробы. Вес - 1,98 гр., высота - 1 см.'
            ORDER BY id
            LIMIT 5
        `;
        
        const jewelryResults = await client.query(jewelryQuery);
        jewelryResults.rows.forEach((row, index) => {
            console.log(`\n   Запись ${index + 1} (ID: ${row.id}):`);
            console.log(`     Описание: "${row.original_description}"`);
        });

        // Проверим, есть ли различия в описаниях внутри групп
        console.log('\n5️⃣ Проверка уникальности описаний в группе серебряных монет:');
        const uniqueDescQuery = `
            SELECT 
                COUNT(*) as total_records,
                COUNT(DISTINCT original_description) as unique_descriptions
            FROM coin_catalog 
            WHERE denomination = '1' 
            AND metal = 'Ag'
            AND coin_weight IS NULL 
            AND year IS NULL
        `;
        
        const uniqueDescResult = await client.query(uniqueDescQuery);
        const stats = uniqueDescResult.rows[0];
        console.log(`   Всего записей: ${stats.total_records}`);
        console.log(`   Уникальных описаний: ${stats.unique_descriptions}`);
        console.log(`   Процент уникальности: ${((stats.unique_descriptions / stats.total_records) * 100).toFixed(1)}%`);

        // Посмотрим на несколько уникальных описаний
        console.log('\n6️⃣ Примеры уникальных описаний в группе серебряных монет:');
        const uniqueExamplesQuery = `
            SELECT DISTINCT original_description
            FROM coin_catalog 
            WHERE denomination = '1' 
            AND metal = 'Ag'
            AND coin_weight IS NULL 
            AND year IS NULL
            ORDER BY original_description
            LIMIT 10
        `;
        
        const uniqueExamplesResult = await client.query(uniqueExamplesQuery);
        uniqueExamplesResult.rows.forEach((row, index) => {
            console.log(`   ${index + 1}. "${row.original_description}"`);
        });

    } catch (error) {
        console.error('❌ Ошибка при проверке конкретных дубликатов:', error);
    } finally {
        client.release();
        await pool.end();
    }
}

checkSpecificDuplicates();

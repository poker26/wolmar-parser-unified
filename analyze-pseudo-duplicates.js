const { Pool } = require('pg');
const isProduction = process.env.NODE_ENV === 'production' || process.env.PORT;
const config = require(isProduction ? './config.production' : './config');

async function analyzePseudoDuplicates() {
    const pool = new Pool(config.dbConfig);
    const client = await pool.connect();

    try {
        console.log('🔍 Анализируем псевдо-дубликаты в категориях coin, other, banknote...\n');

        // 1. Анализ монет
        console.log('1️⃣ Анализ монет: "Монета. Османская империя Au 0,76. | Отверстие." (408 записей)');
        const coinQuery = `
            SELECT id, original_description, denomination, coin_name, year, mint, coin_weight, metal, category
            FROM coin_catalog 
            WHERE original_description = 'Монета. Османская империя Au 0,76. | Отверстие.'
            ORDER BY id
            LIMIT 5
        `;
        
        const coinResults = await client.query(coinQuery);
        coinResults.rows.forEach((row, index) => {
            console.log(`   Запись ${index + 1} (ID: ${row.id}):`);
            console.log(`     Описание: "${row.original_description}"`);
            console.log(`     Номинал: "${row.denomination}"`);
            console.log(`     Название: "${row.coin_name}"`);
            console.log(`     Год: ${row.year}`);
            console.log(`     Монетный двор: "${row.mint}"`);
            console.log(`     Вес: ${row.coin_weight}`);
            console.log(`     Металл: "${row.metal}"`);
            console.log('');
        });

        // 2. Анализ категории "other"
        console.log('2️⃣ Анализ категории "other": "Обол. Боспорское царство Cu." (260 записей)');
        const otherQuery = `
            SELECT id, original_description, denomination, coin_name, year, mint, coin_weight, metal, category
            FROM coin_catalog 
            WHERE original_description = 'Обол. Боспорское царство Cu.'
            ORDER BY id
            LIMIT 5
        `;
        
        const otherResults = await client.query(otherQuery);
        otherResults.rows.forEach((row, index) => {
            console.log(`   Запись ${index + 1} (ID: ${row.id}):`);
            console.log(`     Описание: "${row.original_description}"`);
            console.log(`     Номинал: "${row.denomination}"`);
            console.log(`     Название: "${row.coin_name}"`);
            console.log(`     Год: ${row.year}`);
            console.log(`     Монетный двор: "${row.mint}"`);
            console.log(`     Вес: ${row.coin_weight}`);
            console.log(`     Металл: "${row.metal}"`);
            console.log('');
        });

        // 3. Анализ банкнот
        console.log('3️⃣ Анализ банкнот: "Подборка почтовых марок, 100 шт Бумага." (207 записей)');
        const banknoteQuery = `
            SELECT id, original_description, denomination, coin_name, year, mint, coin_weight, metal, category
            FROM coin_catalog 
            WHERE original_description = 'Подборка почтовых марок, 100 шт Бумага.'
            ORDER BY id
            LIMIT 5
        `;
        
        const banknoteResults = await client.query(banknoteQuery);
        banknoteResults.rows.forEach((row, index) => {
            console.log(`   Запись ${index + 1} (ID: ${row.id}):`);
            console.log(`     Описание: "${row.original_description}"`);
            console.log(`     Номинал: "${row.denomination}"`);
            console.log(`     Название: "${row.coin_name}"`);
            console.log(`     Год: ${row.year}`);
            console.log(`     Монетный двор: "${row.mint}"`);
            console.log(`     Вес: ${row.coin_weight}`);
            console.log(`     Металл: "${row.metal}"`);
            console.log('');
        });

        // 4. Проверим, есть ли различия в других полях
        console.log('4️⃣ Проверка различий в полях у "дубликатов" монет:');
        const differencesQuery = `
            SELECT 
                COUNT(*) as total_records,
                COUNT(DISTINCT denomination) as unique_denominations,
                COUNT(DISTINCT coin_name) as unique_coin_names,
                COUNT(DISTINCT year) as unique_years,
                COUNT(DISTINCT mint) as unique_mints,
                COUNT(DISTINCT coin_weight) as unique_weights,
                COUNT(DISTINCT metal) as unique_metals
            FROM coin_catalog 
            WHERE original_description = 'Монета. Османская империя Au 0,76. | Отверстие.'
        `;
        
        const differencesResult = await client.query(differencesQuery);
        const stats = differencesResult.rows[0];
        console.log(`   Всего записей: ${stats.total_records}`);
        console.log(`   Уникальных номиналов: ${stats.unique_denominations}`);
        console.log(`   Уникальных названий: ${stats.unique_coin_names}`);
        console.log(`   Уникальных годов: ${stats.unique_years}`);
        console.log(`   Уникальных монетных дворов: ${stats.unique_mints}`);
        console.log(`   Уникальных весов: ${stats.unique_weights}`);
        console.log(`   Уникальных металлов: ${stats.unique_metals}`);

        // 5. Проверим, действительно ли это разные предметы
        console.log('\n5️⃣ Проверка: действительно ли это разные предметы?');
        console.log('   Если у всех записей одинаковые извлеченные поля (номинал, название, год, монетный двор, вес, металл),');
        console.log('   но разные ID, то это означает, что парсер не смог правильно извлечь информацию из описания.');
        console.log('   В таком случае это НЕ дубликаты, а разные предметы с плохо извлеченными полями.');

        // 6. Проверим несколько примеров с разными описаниями
        console.log('\n6️⃣ Примеры разных описаний монет с одинаковыми извлеченными полями:');
        const differentDescriptionsQuery = `
            SELECT DISTINCT original_description
            FROM coin_catalog 
            WHERE denomination = '1' 
            AND metal = 'Ag'
            AND coin_weight IS NULL 
            AND year IS NULL
            AND category = 'coin'
            ORDER BY original_description
            LIMIT 10
        `;
        
        const differentDescriptionsResult = await client.query(differentDescriptionsQuery);
        differentDescriptionsResult.rows.forEach((row, index) => {
            console.log(`   ${index + 1}. "${row.original_description}"`);
        });

    } catch (error) {
        console.error('❌ Ошибка при анализе псевдо-дубликатов:', error);
    } finally {
        client.release();
        await pool.end();
    }
}

analyzePseudoDuplicates();

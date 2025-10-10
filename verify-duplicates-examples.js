const { Pool } = require('pg');
const isProduction = process.env.NODE_ENV === 'production' || process.env.PORT;
const config = require(isProduction ? './config.production' : './config');

async function verifyDuplicatesExamples() {
    const pool = new Pool(config.dbConfig);
    const client = await pool.connect();

    try {
        console.log('🔍 Проверяем конкретные примеры дубликатов...\n');

        // 1. Проверим медали - должны быть абсолютно одинаковые
        console.log('1️⃣ Медали: "Медаль памятная Борис Громов. Россия Ag." (106 записей)');
        const medalQuery = `
            SELECT id, original_description, denomination, coin_name, year, mint, coin_weight, metal, category
            FROM coin_catalog 
            WHERE original_description = 'Медаль памятная Борис Громов. Россия Ag.'
            ORDER BY id
            LIMIT 3
        `;
        
        const medalResults = await client.query(medalQuery);
        medalResults.rows.forEach((row, index) => {
            console.log(`   Запись ${index + 1} (ID: ${row.id}):`);
            console.log(`     Описание: "${row.original_description}"`);
            console.log(`     Номинал: "${row.denomination}"`);
            console.log(`     Название: "${row.coin_name}"`);
            console.log(`     Год: ${row.year}`);
            console.log(`     Монетный двор: "${row.mint}"`);
            console.log(`     Вес: ${row.coin_weight}`);
            console.log(`     Металл: "${row.metal}"`);
            console.log(`     Категория: "${row.category}"`);
            console.log('');
        });

        // 2. Проверим ювелирные изделия - должны быть абсолютно одинаковые
        console.log('2️⃣ Ювелирные изделия: "Серьги с танзанитами и бриллиантами Au." (41 запись)');
        const jewelryQuery = `
            SELECT id, original_description, denomination, coin_name, year, mint, coin_weight, metal, category
            FROM coin_catalog 
            WHERE original_description = 'Серьги с танзанитами и бриллиантами Au. | Серьги с танзанитами и бриллиантами. Золото 585 пробы. Вес - 1,98 гр., высота - 1 см.'
            ORDER BY id
            LIMIT 3
        `;
        
        const jewelryResults = await client.query(jewelryQuery);
        jewelryResults.rows.forEach((row, index) => {
            console.log(`   Запись ${index + 1} (ID: ${row.id}):`);
            console.log(`     Описание: "${row.original_description}"`);
            console.log(`     Номинал: "${row.denomination}"`);
            console.log(`     Название: "${row.coin_name}"`);
            console.log(`     Год: ${row.year}`);
            console.log(`     Монетный двор: "${row.mint}"`);
            console.log(`     Вес: ${row.coin_weight}`);
            console.log(`     Металл: "${row.metal}"`);
            console.log(`     Категория: "${row.category}"`);
            console.log('');
        });

        // 3. Проверим монеты - могут быть разные, но с одинаковыми ключевыми полями
        console.log('3️⃣ Монеты: "Монета. Османская империя Au 0,76. | Отверстие." (408 записей)');
        const coinQuery = `
            SELECT id, original_description, denomination, coin_name, year, mint, coin_weight, metal, category
            FROM coin_catalog 
            WHERE original_description = 'Монета. Османская империя Au 0,76. | Отверстие.'
            ORDER BY id
            LIMIT 3
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
            console.log(`     Категория: "${row.category}"`);
            console.log('');
        });

        // 4. Проверим часы - должны быть абсолютно одинаковые
        console.log('4️⃣ Часы: "Золотые карманные часы Au." (19 записей)');
        const watchQuery = `
            SELECT id, original_description, denomination, coin_name, year, mint, coin_weight, metal, category
            FROM coin_catalog 
            WHERE original_description = 'Золотые карманные часы Au. | Золотые карманные часы. Золото 585 пробы, внутренняя крышка - металл. Общий вес - 27,91 гр., диаметр - 33 мм. Швйцария, начало ХХ в.'
            ORDER BY id
            LIMIT 3
        `;
        
        const watchResults = await client.query(watchQuery);
        watchResults.rows.forEach((row, index) => {
            console.log(`   Запись ${index + 1} (ID: ${row.id}):`);
            console.log(`     Описание: "${row.original_description}"`);
            console.log(`     Номинал: "${row.denomination}"`);
            console.log(`     Название: "${row.coin_name}"`);
            console.log(`     Год: ${row.year}`);
            console.log(`     Монетный двор: "${row.mint}"`);
            console.log(`     Вес: ${row.coin_weight}`);
            console.log(`     Металл: "${row.metal}"`);
            console.log(`     Категория: "${row.category}"`);
            console.log('');
        });

        // 5. Проверим, есть ли различия в других полях у "дубликатов"
        console.log('5️⃣ Проверка различий в полях у "дубликатов" медалей:');
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
            WHERE original_description = 'Медаль памятная Борис Громов. Россия Ag.'
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

    } catch (error) {
        console.error('❌ Ошибка при проверке примеров дубликатов:', error);
    } finally {
        client.release();
        await pool.end();
    }
}

verifyDuplicatesExamples();

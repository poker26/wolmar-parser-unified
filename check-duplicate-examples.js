const { Pool } = require('pg');
const isProduction = process.env.NODE_ENV === 'production' || process.env.PORT;
const config = require(isProduction ? './config.production' : './config');

async function checkDuplicateExamples() {
    const pool = new Pool(config.dbConfig);
    const client = await pool.connect();

    try {
        console.log('🔍 Проверяем примеры "дубликатов" для понимания логики...\n');

        // Проверим самую большую группу дубликатов
        console.log('1️⃣ Самая большая группа дубликатов:');
        const biggestGroupQuery = `
            SELECT 
                denomination, coin_name, year, mint, coin_weight, metal,
                COUNT(*) as count,
                STRING_AGG(id::text, ', ' ORDER BY id) as ids
            FROM coin_catalog 
            GROUP BY denomination, coin_name, year, mint, coin_weight, metal
            HAVING COUNT(*) > 1
            ORDER BY count DESC
            LIMIT 1
        `;
        
        const biggestGroup = await client.query(biggestGroupQuery);
        if (biggestGroup.rows.length > 0) {
            const group = biggestGroup.rows[0];
            console.log(`   Группа: "${group.denomination}" ${group.coin_name} ${group.year}г ${group.mint} ${group.coin_weight}g ${group.metal}`);
            console.log(`   Количество: ${group.count} записей`);
            console.log(`   ID записей: ${group.ids.substring(0, 200)}...`);
        }

        // Посмотрим на несколько конкретных записей из этой группы
        console.log('\n2️⃣ Детали первых 5 записей из этой группы:');
        const detailsQuery = `
            SELECT id, denomination, coin_name, year, mint, coin_weight, metal, 
                   original_description, category
            FROM coin_catalog 
            WHERE denomination = $1 AND coin_name = $2 AND year = $3 AND mint = $4 AND coin_weight = $5 AND metal = $6
            ORDER BY id
            LIMIT 5
        `;
        
        if (biggestGroup.rows.length > 0) {
            const group = biggestGroup.rows[0];
            const details = await client.query(detailsQuery, [
                group.denomination, group.coin_name, group.year, group.mint, group.coin_weight, group.metal
            ]);
            
            details.rows.forEach((row, index) => {
                console.log(`\n   Запись ${index + 1} (ID: ${row.id}):`);
                console.log(`     Номинал: "${row.denomination}"`);
                console.log(`     Название: "${row.coin_name}"`);
                console.log(`     Год: ${row.year}`);
                console.log(`     Монетный двор: "${row.mint}"`);
                console.log(`     Вес: ${row.coin_weight}g`);
                console.log(`     Металл: ${row.metal}`);
                console.log(`     Категория: ${row.category}`);
                console.log(`     Описание: "${row.original_description?.substring(0, 100)}..."`);
            });
        }

        // Проверим другую группу - с серебром
        console.log('\n3️⃣ Группа с серебром (Ag):');
        const silverGroupQuery = `
            SELECT 
                denomination, coin_name, year, mint, coin_weight, metal,
                COUNT(*) as count
            FROM coin_catalog 
            WHERE metal = 'Ag'
            GROUP BY denomination, coin_name, year, mint, coin_weight, metal
            HAVING COUNT(*) > 1
            ORDER BY count DESC
            LIMIT 1
        `;
        
        const silverGroup = await client.query(silverGroupQuery);
        if (silverGroup.rows.length > 0) {
            const group = silverGroup.rows[0];
            console.log(`   Группа: "${group.denomination}" ${group.coin_name} ${group.year}г ${group.mint} ${group.coin_weight}g ${group.metal}`);
            console.log(`   Количество: ${group.count} записей`);
            
            // Посмотрим на детали
            const silverDetails = await client.query(detailsQuery, [
                group.denomination, group.coin_name, group.year, group.mint, group.coin_weight, group.metal
            ]);
            
            console.log('\n   Детали первых 3 записей:');
            silverDetails.rows.slice(0, 3).forEach((row, index) => {
                console.log(`\n   Запись ${index + 1} (ID: ${row.id}):`);
                console.log(`     Описание: "${row.original_description?.substring(0, 150)}..."`);
            });
        }

        // Проверим общую статистику по полям
        console.log('\n4️⃣ Статистика по полям:');
        const statsQuery = `
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN denomination IS NULL THEN 1 END) as null_denomination,
                COUNT(CASE WHEN coin_name IS NULL THEN 1 END) as null_coin_name,
                COUNT(CASE WHEN year IS NULL THEN 1 END) as null_year,
                COUNT(CASE WHEN mint IS NULL THEN 1 END) as null_mint,
                COUNT(CASE WHEN coin_weight IS NULL THEN 1 END) as null_weight,
                COUNT(CASE WHEN metal IS NULL THEN 1 END) as null_metal
            FROM coin_catalog
        `;
        
        const stats = await client.query(statsQuery);
        const stat = stats.rows[0];
        console.log(`   Всего записей: ${stat.total}`);
        console.log(`   NULL номинал: ${stat.null_denomination}`);
        console.log(`   NULL название: ${stat.null_coin_name}`);
        console.log(`   NULL год: ${stat.null_year}`);
        console.log(`   NULL монетный двор: ${stat.null_mint}`);
        console.log(`   NULL вес: ${stat.null_weight}`);
        console.log(`   NULL металл: ${stat.null_metal}`);

        // Проверим, сколько записей имеют одинаковые значения во всех ключевых полях
        console.log('\n5️⃣ Проверка записей с одинаковыми значениями:');
        const sameValuesQuery = `
            SELECT 
                denomination, coin_name, year, mint, coin_weight, metal,
                COUNT(*) as count
            FROM coin_catalog 
            WHERE denomination IS NOT NULL 
            AND coin_name IS NOT NULL 
            AND year IS NOT NULL 
            AND mint IS NOT NULL 
            AND coin_weight IS NOT NULL 
            AND metal IS NOT NULL
            GROUP BY denomination, coin_name, year, mint, coin_weight, metal
            HAVING COUNT(*) > 1
            ORDER BY count DESC
            LIMIT 5
        `;
        
        const sameValues = await client.query(sameValuesQuery);
        console.log('   Записи с полностью заполненными полями:');
        sameValues.rows.forEach((row, index) => {
            console.log(`   ${index + 1}. "${row.denomination}" ${row.coin_name} ${row.year}г ${row.mint} ${row.coin_weight}g ${row.metal} - ${row.count} записей`);
        });

    } catch (error) {
        console.error('❌ Ошибка при проверке дубликатов:', error);
    } finally {
        client.release();
        await pool.end();
    }
}

checkDuplicateExamples();

const { Client } = require('pg');

const dbConfig = {
    user: 'postgres.xkwgspqwebfeteoblayu',        
    host: 'aws-0-eu-north-1.pooler.supabase.com',
    database: 'postgres',   
    password: 'Gopapopa326+',    
    port: 6543,
    ssl: {
        rejectUnauthorized: false
    }
};

async function findRecordsToUpdate() {
    const client = new Client(dbConfig);
    
    try {
        await client.connect();
        console.log('✅ Подключение к базе данных успешно');
        
        // Ищем записи с пробелами между состоянием и градацией
        console.log('\n🔍 Ищем записи с пробелами между состоянием и градацией...');
        const spaceQuery = `
            SELECT id, lot_number, auction_number, condition, metal
            FROM auction_lots 
            WHERE condition ~ '[A-Z]{2,3}\\s+[0-9]{2,3}'
            ORDER BY id;
        `;
        const spaceResult = await client.query(spaceQuery);
        console.log(`📋 Найдено ${spaceResult.rows.length} записей с пробелами`);
        
        if (spaceResult.rows.length > 0) {
            console.log('\n📝 Примеры записей для обновления:');
            console.table(spaceResult.rows.slice(0, 10));
        }
        
        // Ищем записи с градациями в конце (например "MS61", "XF45")
        console.log('\n🔍 Ищем записи с градациями без пробелов...');
        const noSpaceQuery = `
            SELECT id, lot_number, auction_number, condition, metal
            FROM auction_lots 
            WHERE condition ~ '^[A-Z]{2,3}[0-9]{2,3}$'
            ORDER BY id;
        `;
        const noSpaceResult = await client.query(noSpaceQuery);
        console.log(`📋 Найдено ${noSpaceResult.rows.length} записей с градациями без пробелов`);
        
        if (noSpaceResult.rows.length > 0) {
            console.log('\n📝 Примеры записей с градациями:');
            console.table(noSpaceResult.rows.slice(0, 10));
        }
        
        // Ищем записи с только цифрами (градации без состояния)
        console.log('\n🔍 Ищем записи с только градациями...');
        const gradeOnlyQuery = `
            SELECT id, lot_number, auction_number, condition, metal
            FROM auction_lots 
            WHERE condition ~ '^[0-9]{2,3}$'
            ORDER BY id;
        `;
        const gradeOnlyResult = await client.query(gradeOnlyQuery);
        console.log(`📋 Найдено ${gradeOnlyResult.rows.length} записей с только градациями`);
        
        if (gradeOnlyResult.rows.length > 0) {
            console.log('\n📝 Примеры записей с только градациями:');
            console.table(gradeOnlyResult.rows.slice(0, 10));
        }
        
        // Общая статистика
        console.log('\n📊 Общая статистика:');
        console.log(`📋 Записей с пробелами (нужно обновить): ${spaceResult.rows.length}`);
        console.log(`📋 Записей с градациями без пробелов: ${noSpaceResult.rows.length}`);
        console.log(`📋 Записей с только градациями: ${gradeOnlyResult.rows.length}`);
        
    } catch (error) {
        console.error('❌ Ошибка при поиске записей:', error);
    } finally {
        await client.end();
        console.log('\n✅ Поиск завершен');
    }
}

findRecordsToUpdate();

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

async function checkParsedAuctions() {
    const client = new Client(dbConfig);
    
    try {
        await client.connect();
        console.log('✅ Подключение к базе данных успешно');
        
        // Проверяем все распарсенные аукционы
        console.log('\n📊 Все распарсенные аукционы:');
        const auctionsQuery = `
            SELECT auction_number, COUNT(*) as lots_count, 
                   MIN(parsed_at) as first_parsed, 
                   MAX(parsed_at) as last_parsed
            FROM auction_lots 
            GROUP BY auction_number 
            ORDER BY auction_number DESC;
        `;
        const auctionsResult = await client.query(auctionsQuery);
        console.table(auctionsResult.rows);
        
        // Проверяем, есть ли записи с пробелами в состоянии в уже распарсенных аукционах
        console.log('\n🔍 Ищем записи с пробелами в состоянии во всех аукционах...');
        const spaceQuery = `
            SELECT auction_number, lot_number, condition, metal
            FROM auction_lots 
            WHERE condition ~ '\\s+'
            ORDER BY auction_number, lot_number;
        `;
        const spaceResult = await client.query(spaceQuery);
        console.log(`📋 Найдено ${spaceResult.rows.length} записей с пробелами в состоянии:`);
        if (spaceResult.rows.length > 0) {
            console.table(spaceResult.rows);
        }
        
        // Проверяем записи с градациями в уже распарсенных аукционах
        console.log('\n🔍 Ищем записи с градациями во всех аукционах...');
        const gradeQuery = `
            SELECT auction_number, lot_number, condition, metal
            FROM auction_lots 
            WHERE condition ~ '[0-9]{2,3}'
            ORDER BY auction_number, lot_number;
        `;
        const gradeResult = await client.query(gradeQuery);
        console.log(`📋 Найдено ${gradeResult.rows.length} записей с градациями:`);
        if (gradeResult.rows.length > 0) {
            console.table(gradeResult.rows);
        }
        
        // Проверяем, есть ли записи с форматом "MS 64", "XF 45" и т.д.
        console.log('\n🔍 Ищем записи с форматом "состояние пробел градация"...');
        const formatQuery = `
            SELECT auction_number, lot_number, condition, metal
            FROM auction_lots 
            WHERE condition ~ '^[A-Z]{2,3}\\s+[0-9]{2,3}$'
            ORDER BY auction_number, lot_number;
        `;
        const formatResult = await client.query(formatQuery);
        console.log(`📋 Найдено ${formatResult.rows.length} записей с форматом "состояние пробел градация":`);
        if (formatResult.rows.length > 0) {
            console.table(formatResult.rows);
        }
        
    } catch (error) {
        console.error('❌ Ошибка при проверке аукционов:', error);
    } finally {
        await client.end();
        console.log('\n✅ Проверка завершена');
    }
}

checkParsedAuctions();

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

async function findTestLots() {
    const client = new Client(dbConfig);
    
    try {
        await client.connect();
        console.log('✅ Подключение к базе данных успешно');
        
        // Ищем золотые монеты 15 рублей 1897 года
        console.log('\n🔍 Ищем золотые монеты 15 рублей 1897 года...');
        const goldQuery = `
            SELECT id, lot_number, auction_number, condition, metal, year, coin_description, source_url
            FROM auction_lots 
            WHERE metal = 'Au' 
            AND year = 1897
            AND coin_description ILIKE '%15 рублей%'
            ORDER BY auction_number DESC, lot_number
            LIMIT 10;
        `;
        const goldResult = await client.query(goldQuery);
        console.log(`📋 Найдено ${goldResult.rows.length} золотых монет 15 рублей 1897 года:`);
        if (goldResult.rows.length > 0) {
            console.table(goldResult.rows);
        }
        
        // Если не нашли по точному описанию, попробуем более широкий поиск
        if (goldResult.rows.length === 0) {
            console.log('\n🔍 Расширенный поиск: ищем все золотые монеты 1897 года...');
            const broaderQuery = `
                SELECT id, lot_number, auction_number, condition, metal, year, coin_description, source_url
                FROM auction_lots 
                WHERE metal = 'Au' 
                AND year = 1897
                ORDER BY auction_number DESC, lot_number
                LIMIT 10;
            `;
            const broaderResult = await client.query(broaderQuery);
            console.log(`📋 Найдено ${broaderResult.rows.length} золотых монет 1897 года:`);
            if (broaderResult.rows.length > 0) {
                console.table(broaderResult.rows);
            }
        }
        
        // Ищем монеты с градациями среди найденных
        console.log('\n🔍 Ищем монеты с градациями среди золотых монет 1897 года...');
        const gradeQuery = `
            SELECT id, lot_number, auction_number, condition, metal, year, coin_description, source_url
            FROM auction_lots 
            WHERE metal = 'Au' 
            AND year = 1897
            AND condition ~ '[0-9]{2,3}'
            ORDER BY auction_number DESC, lot_number
            LIMIT 10;
        `;
        const gradeResult = await client.query(gradeQuery);
        console.log(`📋 Найдено ${gradeResult.rows.length} золотых монет 1897 года с градациями:`);
        if (gradeResult.rows.length > 0) {
            console.table(gradeResult.rows);
        }
        
        // Ищем монеты с пробелами в состоянии
        console.log('\n🔍 Ищем монеты с пробелами в состоянии среди золотых монет 1897 года...');
        const spaceQuery = `
            SELECT id, lot_number, auction_number, condition, metal, year, coin_description, source_url
            FROM auction_lots 
            WHERE metal = 'Au' 
            AND year = 1897
            AND condition ~ '\\s+'
            ORDER BY auction_number DESC, lot_number
            LIMIT 10;
        `;
        const spaceResult = await client.query(spaceQuery);
        console.log(`📋 Найдено ${spaceResult.rows.length} золотых монет 1897 года с пробелами в состоянии:`);
        if (spaceResult.rows.length > 0) {
            console.table(spaceResult.rows);
        }
        
    } catch (error) {
        console.error('❌ Ошибка при поиске тестовых лотов:', error);
    } finally {
        await client.end();
        console.log('\n✅ Поиск завершен');
    }
}

findTestLots();

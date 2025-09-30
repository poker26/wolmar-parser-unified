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

async function detailedCheckLot() {
    const client = new Client(dbConfig);
    
    try {
        await client.connect();
        console.log('✅ Подключение к базе данных успешно');
        
        // Проверяем лот 7525679 из аукциона 2126 разными способами
        console.log('\n🔍 Ищем лот 7525679 из аукциона 2126...');
        
        // 1. Точный поиск по номеру лота и аукциона
        const exactQuery = `
            SELECT id, lot_number, auction_number, condition, metal, coin_description, source_url
            FROM auction_lots 
            WHERE lot_number = '7525679' AND auction_number = '2126';
        `;
        const exactResult = await client.query(exactQuery);
        console.log(`📋 Точный поиск: найдено ${exactResult.rows.length} записей`);
        if (exactResult.rows.length > 0) {
            console.table(exactResult.rows);
        }
        
        // 2. Поиск только по номеру лота
        const lotOnlyQuery = `
            SELECT id, lot_number, auction_number, condition, metal, coin_description, source_url
            FROM auction_lots 
            WHERE lot_number = '7525679';
        `;
        const lotOnlyResult = await client.query(lotOnlyQuery);
        console.log(`📋 Поиск только по номеру лота: найдено ${lotOnlyResult.rows.length} записей`);
        if (lotOnlyResult.rows.length > 0) {
            console.table(lotOnlyResult.rows);
        }
        
        // 3. Поиск только по номеру аукциона
        const auctionOnlyQuery = `
            SELECT COUNT(*) as total_lots
            FROM auction_lots 
            WHERE auction_number = '2126';
        `;
        const auctionOnlyResult = await client.query(auctionOnlyQuery);
        console.log(`📋 Поиск только по номеру аукциона: найдено ${auctionOnlyResult.rows[0].total_lots} лотов`);
        
        // 4. Поиск с LIKE (на случай если есть пробелы или другие символы)
        const likeQuery = `
            SELECT id, lot_number, auction_number, condition, metal, coin_description, source_url
            FROM auction_lots 
            WHERE lot_number LIKE '%7525679%' OR auction_number LIKE '%2126%';
        `;
        const likeResult = await client.query(likeQuery);
        console.log(`📋 Поиск с LIKE: найдено ${likeResult.rows.length} записей`);
        if (likeResult.rows.length > 0) {
            console.table(likeResult.rows);
        }
        
        // 5. Проверим все аукционы, которые содержат "2126"
        const similarAuctionsQuery = `
            SELECT DISTINCT auction_number, COUNT(*) as lots_count
            FROM auction_lots 
            WHERE auction_number LIKE '%2126%'
            GROUP BY auction_number
            ORDER BY auction_number;
        `;
        const similarAuctionsResult = await client.query(similarAuctionsQuery);
        console.log(`📋 Аукционы, содержащие "2126": найдено ${similarAuctionsResult.rows.length} аукционов`);
        if (similarAuctionsResult.rows.length > 0) {
            console.table(similarAuctionsResult.rows);
        }
        
        // 6. Проверим все лоты, которые содержат "7525679"
        const similarLotsQuery = `
            SELECT id, lot_number, auction_number, condition, metal, coin_description, source_url
            FROM auction_lots 
            WHERE lot_number LIKE '%7525679%'
            ORDER BY auction_number;
        `;
        const similarLotsResult = await client.query(similarLotsQuery);
        console.log(`📋 Лоты, содержащие "7525679": найдено ${similarLotsResult.rows.length} лотов`);
        if (similarLotsResult.rows.length > 0) {
            console.table(similarLotsResult.rows);
        }
        
        // 7. Проверим последние добавленные лоты (возможно, лот недавно добавлен)
        console.log('\n🔍 Последние 20 добавленных лотов...');
        const recentQuery = `
            SELECT id, lot_number, auction_number, condition, metal, parsed_at
            FROM auction_lots 
            ORDER BY parsed_at DESC
            LIMIT 20;
        `;
        const recentResult = await client.query(recentQuery);
        console.table(recentResult.rows);
        
    } catch (error) {
        console.error('❌ Ошибка при проверке лота:', error);
    } finally {
        await client.end();
        console.log('\n✅ Проверка завершена');
    }
}

detailedCheckLot();

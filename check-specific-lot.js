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

async function checkSpecificLot() {
    const client = new Client(dbConfig);
    
    try {
        await client.connect();
        console.log('✅ Подключение к базе данных успешно');
        
        // Ищем лот 7555840 из аукциона 2130
        console.log('\n🔍 Ищем лот 7555840 из аукциона 2130...');
        const lotQuery = `
            SELECT id, lot_number, auction_number, condition, metal, coin_description, source_url
            FROM auction_lots 
            WHERE lot_number = '7555840' AND auction_number = '2130';
        `;
        const lotResult = await client.query(lotQuery);
        
        if (lotResult.rows.length > 0) {
            console.log('📋 Найден лот:');
            console.table(lotResult.rows);
        } else {
            console.log('❌ Лот 7555840 из аукциона 2130 не найден в базе');
        }
        
        // Ищем все лоты из аукциона 2130
        console.log('\n🔍 Ищем все лоты из аукциона 2130...');
        const auctionQuery = `
            SELECT COUNT(*) as total_lots
            FROM auction_lots 
            WHERE auction_number = '2130';
        `;
        const auctionResult = await client.query(auctionQuery);
        console.log(`📊 Всего лотов в аукционе 2130: ${auctionResult.rows[0].total_lots}`);
        
        // Ищем лоты с градациями из аукциона 2130
        console.log('\n🔍 Ищем лоты с градациями из аукциона 2130...');
        const gradeQuery = `
            SELECT lot_number, condition, metal
            FROM auction_lots 
            WHERE auction_number = '2130' 
            AND condition ~ '[0-9]{2,3}'
            ORDER BY lot_number;
        `;
        const gradeResult = await client.query(gradeQuery);
        console.log(`📋 Найдено ${gradeResult.rows.length} лотов с градациями в аукционе 2130:`);
        if (gradeResult.rows.length > 0) {
            console.table(gradeResult.rows);
        }
        
        // Ищем лоты с пробелами в состоянии из аукциона 2130
        console.log('\n🔍 Ищем лоты с пробелами в состоянии из аукциона 2130...');
        const spaceQuery = `
            SELECT lot_number, condition, metal
            FROM auction_lots 
            WHERE auction_number = '2130' 
            AND condition ~ '\\s+'
            ORDER BY lot_number;
        `;
        const spaceResult = await client.query(spaceQuery);
        console.log(`📋 Найдено ${spaceResult.rows.length} лотов с пробелами в состоянии:`);
        if (spaceResult.rows.length > 0) {
            console.table(spaceResult.rows);
        }
        
        // Проверим последние добавленные лоты из аукциона 2130
        console.log('\n🔍 Последние 10 лотов из аукциона 2130...');
        const recentQuery = `
            SELECT lot_number, condition, metal, parsed_at
            FROM auction_lots 
            WHERE auction_number = '2130' 
            ORDER BY parsed_at DESC
            LIMIT 10;
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

checkSpecificLot();

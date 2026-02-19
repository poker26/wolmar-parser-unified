const { Client } = require('pg');

const dbConfig = {
    user: 'postgres.xkwgspqwebfeteoblayu',        
    host: 'sup.begemot26.ru',
    database: 'postgres',   
    password: 'Gopapopa326+',    
    port: 6543,
    ssl: {
        rejectUnauthorized: false
    }
};

async function checkLot2121() {
    const client = new Client(dbConfig);
    
    try {
        await client.connect();
        console.log('✅ Подключение к базе данных успешно');
        
        // Ищем лот 7501805 из аукциона 2121
        console.log('\n🔍 Ищем лот 7501805 из аукциона 2121...');
        const lotQuery = `
            SELECT id, lot_number, auction_number, condition, metal, coin_description, source_url
            FROM auction_lots 
            WHERE lot_number = '7501805' AND auction_number = '2121';
        `;
        const lotResult = await client.query(lotQuery);
        
        if (lotResult.rows.length > 0) {
            console.log('📋 Найден лот:');
            console.table(lotResult.rows);
        } else {
            console.log('❌ Лот 7501805 из аукциона 2121 не найден в базе');
        }
        
        // Ищем все лоты из аукциона 2121
        console.log('\n🔍 Ищем все лоты из аукциона 2121...');
        const auctionQuery = `
            SELECT COUNT(*) as total_lots
            FROM auction_lots 
            WHERE auction_number = '2121';
        `;
        const auctionResult = await client.query(auctionQuery);
        console.log(`📊 Всего лотов в аукционе 2121: ${auctionResult.rows[0].total_lots}`);
        
        // Ищем лоты с градациями из аукциона 2121
        console.log('\n🔍 Ищем лоты с градациями из аукциона 2121...');
        const gradeQuery = `
            SELECT lot_number, condition, metal
            FROM auction_lots 
            WHERE auction_number = '2121' 
            AND condition ~ '[0-9]{2,3}'
            ORDER BY lot_number;
        `;
        const gradeResult = await client.query(gradeQuery);
        console.log(`📋 Найдено ${gradeResult.rows.length} лотов с градациями в аукционе 2121:`);
        if (gradeResult.rows.length > 0) {
            console.table(gradeResult.rows);
        }
        
        // Ищем лоты с пробелами в состоянии из аукциона 2121
        console.log('\n🔍 Ищем лоты с пробелами в состоянии из аукциона 2121...');
        const spaceQuery = `
            SELECT lot_number, condition, metal
            FROM auction_lots 
            WHERE auction_number = '2121' 
            AND condition ~ '\\s+'
            ORDER BY lot_number;
        `;
        const spaceResult = await client.query(spaceQuery);
        console.log(`📋 Найдено ${spaceResult.rows.length} лотов с пробелами в состоянии:`);
        if (spaceResult.rows.length > 0) {
            console.table(spaceResult.rows);
        }
        
        // Проверим последние добавленные лоты из аукциона 2121
        console.log('\n🔍 Последние 10 лотов из аукциона 2121...');
        const recentQuery = `
            SELECT lot_number, condition, metal, parsed_at
            FROM auction_lots 
            WHERE auction_number = '2121' 
            ORDER BY parsed_at DESC
            LIMIT 10;
        `;
        const recentResult = await client.query(recentQuery);
        if (recentResult.rows.length > 0) {
            console.table(recentResult.rows);
        } else {
            console.log('❌ Нет лотов из аукциона 2121');
        }
        
    } catch (error) {
        console.error('❌ Ошибка при проверке лота:', error);
    } finally {
        await client.end();
        console.log('\n✅ Проверка завершена');
    }
}

checkLot2121();

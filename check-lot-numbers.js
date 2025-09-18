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

async function checkLotNumbers() {
    const client = new Client(dbConfig);
    
    try {
        await client.connect();
        console.log('✅ Подключение к базе данных успешно');
        
        // Проверяем номера лотов для аукциона 967
        const query = `
            SELECT lot_number, source_url, condition
            FROM auction_lots 
            WHERE auction_number = '967'
            ORDER BY lot_number
            LIMIT 20;
        `;
        
        const result = await client.query(query);
        
        console.log(`\n📊 Первые 20 лотов аукциона 967 в базе данных:`);
        result.rows.forEach((row, index) => {
            console.log(`${index + 1}. Лот ${row.lot_number}: ${row.condition} (${row.source_url})`);
        });
        
        // Проверяем общее количество лотов
        const countQuery = `
            SELECT COUNT(*) as total
            FROM auction_lots 
            WHERE auction_number = '967';
        `;
        
        const countResult = await client.query(countQuery);
        console.log(`\n📊 Всего лотов аукциона 967 в базе: ${countResult.rows[0].total}`);
        
        // Проверяем диапазон номеров лотов
        const rangeQuery = `
            SELECT MIN(lot_number) as min_lot, MAX(lot_number) as max_lot
            FROM auction_lots 
            WHERE auction_number = '967';
        `;
        
        const rangeResult = await client.query(rangeQuery);
        console.log(`📊 Диапазон номеров лотов: ${rangeResult.rows[0].min_lot} - ${rangeResult.rows[0].max_lot}`);
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    } finally {
        await client.end();
    }
}

checkLotNumbers();

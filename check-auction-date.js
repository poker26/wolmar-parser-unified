const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool(config.dbConfig);

async function checkAuctionDate() {
    try {
        console.log('🔍 Проверяем формат даты аукциона...');
        
        const query = `
            SELECT id, lot_number, auction_number, auction_end_date,
                   EXTRACT(YEAR FROM auction_end_date) as year,
                   EXTRACT(MONTH FROM auction_end_date) as month,
                   EXTRACT(DAY FROM auction_end_date) as day,
                   TO_CHAR(auction_end_date, 'YYYY-MM-DD') as formatted_date
            FROM auction_lots 
            WHERE id = 29823
        `;
        
        const result = await pool.query(query);
        
        if (result.rows.length > 0) {
            const lot = result.rows[0];
            console.log('📋 Данные лота 29823:');
            console.log(`   ID: ${lot.id}`);
            console.log(`   Номер лота: ${lot.lot_number}`);
            console.log(`   Аукцион: ${lot.auction_number}`);
            console.log(`   Дата аукциона (raw): ${lot.auction_end_date}`);
            console.log(`   Год: ${lot.year}`);
            console.log(`   Месяц: ${lot.month}`);
            console.log(`   День: ${lot.day}`);
            console.log(`   Форматированная дата: ${lot.formatted_date}`);
        }
        
        // Проверим, есть ли данные в metals_prices на эту дату
        const metalsQuery = `
            SELECT date, TO_CHAR(date, 'YYYY-MM-DD') as formatted_date, gold_price
            FROM metals_prices 
            WHERE date = '2025-09-04'::date
        `;
        
        const metalsResult = await pool.query(metalsQuery);
        console.log('\n📊 Данные в metals_prices на 2025-09-04:');
        console.log(`   Найдено записей: ${metalsResult.rows.length}`);
        if (metalsResult.rows.length > 0) {
            console.log(`   Дата: ${metalsResult.rows[0].date}`);
            console.log(`   Форматированная дата: ${metalsResult.rows[0].formatted_date}`);
            console.log(`   Цена золота: ${metalsResult.rows[0].gold_price}`);
        }
        
    } catch (error) {
        console.error('❌ Ошибка:', error);
    } finally {
        await pool.end();
    }
}

checkAuctionDate();

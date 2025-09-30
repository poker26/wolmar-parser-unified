const { Pool } = require('pg');

const pool = new Pool({
    user: 'postgres.xkwgspqwebfeteoblayu',        
    host: 'aws-0-eu-north-1.pooler.supabase.com',
    database: 'postgres',   
    password: 'Gopapopa326+',    
    port: 6543,
    ssl: {
        rejectUnauthorized: false
    },
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    max: 10,
    allowExitOnIdle: true
});

async function check2020CoinsCondition() {
    try {
        console.log('🔍 Проверяем монеты 2020 года в базе данных...');
        
        // Ищем все монеты 2020 года
        const result = await pool.query(`
            SELECT 
                lot_number,
                auction_number,
                coin_description,
                year,
                letters,
                metal,
                condition,
                winning_bid
            FROM auction_lots 
            WHERE year = 2020 
            AND winning_bid IS NOT NULL 
            AND winning_bid > 0
            ORDER BY winning_bid DESC
            LIMIT 20
        `);
        
        console.log(`📊 Найдено ${result.rows.length} монет 2020 года:`);
        console.log('');
        
        result.rows.forEach((row, index) => {
            console.log(`${index + 1}. Лот ${row.lot_number}, Аукцион ${row.auction_number}`);
            console.log(`   Описание: ${row.coin_description}`);
            console.log(`   Состояние: ${row.condition}`);
            console.log(`   Металл: ${row.metal}`);
            console.log(`   Цена: ${row.winning_bid}₽`);
            console.log('');
        });
        
        // Теперь проверим конкретно монеты "50 рублей. Комплекс Храма Воскресения Христова" 2020 года
        console.log('🔍 Ищем монеты "50 рублей. Комплекс Храма Воскресения Христова" 2020 года...');
        const templeCoinsResult = await pool.query(`
            SELECT 
                lot_number,
                auction_number,
                coin_description,
                condition,
                metal,
                winning_bid
            FROM auction_lots 
            WHERE year = 2020 
            AND coin_description ILIKE '%храм%воскресения%'
            AND winning_bid IS NOT NULL 
            AND winning_bid > 0
            ORDER BY winning_bid DESC
        `);
        
        console.log(`📊 Найдено ${templeCoinsResult.rows.length} монет "50 рублей. Комплекс Храма Воскресения Христова" 2020 года:`);
        console.log('');
        
        templeCoinsResult.rows.forEach((row, index) => {
            console.log(`${index + 1}. Лот ${row.lot_number}, Аукцион ${row.auction_number}`);
            console.log(`   Описание: ${row.coin_description}`);
            console.log(`   Состояние: ${row.condition}`);
            console.log(`   Металл: ${row.metal}`);
            console.log(`   Цена: ${row.winning_bid}₽`);
            console.log('');
        });
        
    } catch (error) {
        console.error('❌ Ошибка:', error);
    } finally {
        await pool.end();
    }
}

check2020CoinsCondition();
const { Pool } = require('pg');
const config = require('./config');

async function checkAuctionMapping() {
    console.log('🔍 ПРОВЕРКА СООТВЕТСТВИЯ WOLMAR ID И НОМЕРОВ АУКЦИОНОВ');
    console.log('====================================================');
    
    const pool = new Pool(config.dbConfig);
    
    try {
        console.log('\n1️⃣ Подключаемся к базе данных...');
        
        console.log('\n2️⃣ Проверяем соответствие parsing_number и auction_number...');
        const mappingResult = await pool.query(`
            SELECT DISTINCT auction_number, parsing_number, COUNT(*) as lot_count
            FROM auction_lots 
            WHERE parsing_number IS NOT NULL
            GROUP BY auction_number, parsing_number
            ORDER BY parsing_number, auction_number
        `);
        console.log('📊 Соответствие parsing_number и auction_number:');
        mappingResult.rows.forEach(row => {
            console.log(`   Parsing: ${row.parsing_number} → Auction: ${row.auction_number} (${row.lot_count} лотов)`);
        });
        
        console.log('\n3️⃣ Проверяем конкретно parsing_number = 2070...');
        const result2070 = await pool.query(`
            SELECT DISTINCT auction_number, COUNT(*) as lot_count
            FROM auction_lots 
            WHERE parsing_number = '2070'
            GROUP BY auction_number
        `);
        console.log('📊 Для parsing_number = 2070:');
        result2070.rows.forEach(row => {
            console.log(`   Auction: ${row.auction_number} (${row.lot_count} лотов)`);
        });
        
        console.log('\n4️⃣ Проверяем auction_number = 914...');
        const result914 = await pool.query(`
            SELECT DISTINCT parsing_number, COUNT(*) as lot_count
            FROM auction_lots 
            WHERE auction_number = '914'
            GROUP BY parsing_number
        `);
        console.log('📊 Для auction_number = 914:');
        result914.rows.forEach(row => {
            console.log(`   Parsing: ${row.parsing_number} (${row.lot_count} лотов)`);
        });
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
        console.error('❌ Стек ошибки:', error.stack);
    } finally {
        await pool.end();
    }
}

if (require.main === module) {
    checkAuctionMapping();
}

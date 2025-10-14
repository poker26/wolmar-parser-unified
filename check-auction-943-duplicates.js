const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool(config.dbConfig);

async function checkAuction943Duplicates() {
    try {
        console.log('🔍 Проверяем дубликаты для аукциона 943...');
        
        // Проверяем все записи для аукциона 943
        const query = `
            SELECT 
                auction_number,
                parsing_number,
                COUNT(*) as records_count,
                MIN(auction_end_date) as earliest_date,
                MAX(auction_end_date) as latest_date
            FROM auction_lots 
            WHERE auction_number = '943'
            GROUP BY auction_number, parsing_number
            ORDER BY parsing_number;
        `;
        
        const result = await pool.query(query);
        
        console.log(`📊 Найдено ${result.rows.length} групп записей для аукциона 943:`);
        result.rows.forEach((row, index) => {
            console.log(`  ${index + 1}. Аукцион ${row.auction_number}, parsing_number: ${row.parsing_number}`);
            console.log(`     Записей: ${row.records_count}`);
            console.log(`     Период: ${row.earliest_date} - ${row.latest_date}`);
        });
        
        // Проверяем, какие parsing_number есть для других аукционов
        console.log('\n🔍 Проверяем parsing_number для всех аукционов:');
        const allQuery = `
            SELECT 
                auction_number,
                parsing_number,
                COUNT(*) as records_count
            FROM auction_lots 
            WHERE auction_number IS NOT NULL
            GROUP BY auction_number, parsing_number
            HAVING COUNT(*) > 0
            ORDER BY auction_number, parsing_number;
        `;
        
        const allResult = await pool.query(allQuery);
        
        // Группируем по auction_number
        const auctionGroups = {};
        allResult.rows.forEach(row => {
            if (!auctionGroups[row.auction_number]) {
                auctionGroups[row.auction_number] = [];
            }
            auctionGroups[row.auction_number].push({
                parsing_number: row.parsing_number,
                records_count: row.records_count
            });
        });
        
        // Показываем аукционы с разными parsing_number
        console.log('\n📋 Аукционы с разными parsing_number:');
        Object.keys(auctionGroups).forEach(auctionNumber => {
            const groups = auctionGroups[auctionNumber];
            if (groups.length > 1) {
                console.log(`\n🔄 Аукцион ${auctionNumber}:`);
                groups.forEach(group => {
                    console.log(`  - parsing_number: ${group.parsing_number} (${group.records_count} записей)`);
                });
            }
        });
        
        // Показываем аукционы с одинаковыми parsing_number
        console.log('\n✅ Аукционы с одинаковыми parsing_number:');
        Object.keys(auctionGroups).forEach(auctionNumber => {
            const groups = auctionGroups[auctionNumber];
            if (groups.length === 1) {
                console.log(`  Аукцион ${auctionNumber}: parsing_number = ${groups[0].parsing_number} (${groups[0].records_count} записей)`);
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка проверки дубликатов:', error);
    } finally {
        await pool.end();
    }
}

checkAuction943Duplicates();

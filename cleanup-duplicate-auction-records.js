const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool(config.dbConfig);

async function cleanupDuplicateAuctionRecords() {
    try {
        console.log('🧹 Очистка дублированных записей аукционов...');
        
        // Сначала показываем, что будем удалять
        const checkQuery = `
            SELECT 
                auction_number,
                parsing_number,
                COUNT(*) as records_count,
                MIN(auction_end_date) as earliest_date,
                MAX(auction_end_date) as latest_date
            FROM auction_lots 
            WHERE auction_number IS NOT NULL
            GROUP BY auction_number, parsing_number
            HAVING COUNT(*) > 0
            ORDER BY auction_number, parsing_number;
        `;
        
        const checkResult = await pool.query(checkQuery);
        
        // Группируем по auction_number
        const auctionGroups = {};
        checkResult.rows.forEach(row => {
            if (!auctionGroups[row.auction_number]) {
                auctionGroups[row.auction_number] = [];
            }
            auctionGroups[row.auction_number].push({
                parsing_number: row.parsing_number,
                records_count: row.records_count,
                earliest_date: row.earliest_date,
                latest_date: row.latest_date
            });
        });
        
        // Находим аукционы с дубликатами
        const duplicatesToClean = [];
        Object.keys(auctionGroups).forEach(auctionNumber => {
            const groups = auctionGroups[auctionNumber];
            if (groups.length > 1) {
                console.log(`\n🔄 Аукцион ${auctionNumber} имеет ${groups.length} разных parsing_number:`);
                
                // Сортируем по количеству записей (больше записей = более вероятно правильный)
                groups.sort((a, b) => b.records_count - a.records_count);
                
                groups.forEach((group, index) => {
                    const status = index === 0 ? '✅ ОСТАВИТЬ' : '❌ УДАЛИТЬ';
                    console.log(`  ${status} parsing_number: ${group.parsing_number} (${group.records_count} записей, ${group.earliest_date} - ${group.latest_date})`);
                    
                    if (index > 0) {
                        duplicatesToClean.push({
                            auction_number: auctionNumber,
                            parsing_number: group.parsing_number,
                            records_count: group.records_count
                        });
                    }
                });
            }
        });
        
        if (duplicatesToClean.length === 0) {
            console.log('\n✅ Дубликатов не найдено!');
            return;
        }
        
        console.log(`\n🗑️ Будет удалено ${duplicatesToClean.length} групп дублированных записей:`);
        duplicatesToClean.forEach(dup => {
            console.log(`  - Аукцион ${dup.auction_number}, parsing_number: ${dup.parsing_number} (${dup.records_count} записей)`);
        });
        
        // Подтверждение удаления
        console.log('\n⚠️ ВНИМАНИЕ: Это действие необратимо!');
        console.log('Для продолжения раскомментируйте код удаления в скрипте.');
        
        // Раскомментируйте следующие строки для фактического удаления:
        /*
        for (const dup of duplicatesToClean) {
            const deleteQuery = `
                DELETE FROM auction_lots 
                WHERE auction_number = $1 AND parsing_number = $2;
            `;
            
            const deleteResult = await pool.query(deleteQuery, [dup.auction_number, dup.parsing_number]);
            console.log(`✅ Удалено ${deleteResult.rowCount} записей для аукциона ${dup.auction_number}, parsing_number: ${dup.parsing_number}`);
        }
        
        console.log('\n🎉 Очистка завершена!');
        */
        
    } catch (error) {
        console.error('❌ Ошибка очистки дубликатов:', error);
    } finally {
        await pool.end();
    }
}

cleanupDuplicateAuctionRecords();

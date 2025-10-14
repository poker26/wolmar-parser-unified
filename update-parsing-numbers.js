const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool(config.dbConfig);

// Маппинг известных аукционов: auction_number -> parsing_number
const auctionMapping = {
    // Примеры из вашего сообщения
    971: 2139,  // Аукцион 971 -> URL /auction/2139
    
    // Добавьте другие известные маппинги здесь
    // 943: 2077,  // если есть другие примеры
};

async function updateParsingNumbers() {
    try {
        console.log('🔧 Обновляем номера парсинга...');
        
        for (const [auctionNumber, parsingNumber] of Object.entries(auctionMapping)) {
            const updateQuery = `
                UPDATE auction_lots 
                SET parsing_number = $1 
                WHERE auction_number = $2;
            `;
            
            const result = await pool.query(updateQuery, [parsingNumber, auctionNumber]);
            console.log(`✅ Аукцион ${auctionNumber}: обновлено ${result.rowCount} лотов (парсинг: ${parsingNumber})`);
        }
        
        // Показываем итоговую статистику
        const statsQuery = `
            SELECT 
                auction_number,
                parsing_number,
                COUNT(*) as lots_count
            FROM auction_lots 
            WHERE auction_number IS NOT NULL
            GROUP BY auction_number, parsing_number
            ORDER BY auction_number DESC
            LIMIT 10;
        `;
        
        const statsResult = await pool.query(statsQuery);
        console.log('\n📊 Обновленные номера аукционов:');
        statsResult.rows.forEach(row => {
            const isDifferent = row.auction_number !== row.parsing_number;
            const status = isDifferent ? '🔄' : '✅';
            console.log(`  ${status} Аукцион ${row.auction_number} (парсинг: ${row.parsing_number}): ${row.lots_count} лотов`);
        });
        
    } catch (error) {
        console.error('❌ Ошибка обновления номеров парсинга:', error);
    } finally {
        await pool.end();
    }
}

updateParsingNumbers();

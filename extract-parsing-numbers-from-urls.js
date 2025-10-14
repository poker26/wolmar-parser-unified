const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool(config.dbConfig);

async function extractParsingNumbersFromUrls() {
    try {
        console.log('🔍 Извлекаем номера парсинга из URL лотов...');
        
        // Получаем все уникальные URL лотов
        const urlQuery = `
            SELECT DISTINCT source_url, auction_number
            FROM auction_lots 
            WHERE source_url IS NOT NULL 
            AND source_url LIKE '%/auction/%'
            ORDER BY auction_number DESC;
        `;
        
        const urlResult = await pool.query(urlQuery);
        console.log(`📋 Найдено ${urlResult.rows.length} уникальных URL лотов`);
        
        // Извлекаем номера парсинга из URL
        const parsingNumbers = new Map();
        
        urlResult.rows.forEach(row => {
            const url = row.source_url;
            const auctionNumber = row.auction_number;
            
            // Извлекаем номер из URL вида: https://www.wolmar.ru/auction/2139/lot/123
            const match = url.match(/\/auction\/(\d+)\//);
            if (match) {
                const parsingNumber = parseInt(match[1]);
                parsingNumbers.set(auctionNumber, parsingNumber);
                console.log(`  📌 Аукцион ${auctionNumber} -> Парсинг: ${parsingNumber} (из URL: ${url})`);
            }
        });
        
        console.log(`\n🎯 Найдено ${parsingNumbers.size} соответствий аукционов:`);
        
        // Обновляем номера парсинга в базе данных
        let totalUpdated = 0;
        for (const [auctionNumber, parsingNumber] of parsingNumbers) {
            const updateQuery = `
                UPDATE auction_lots 
                SET parsing_number = $1 
                WHERE auction_number = $2;
            `;
            
            const result = await pool.query(updateQuery, [parsingNumber, auctionNumber]);
            totalUpdated += result.rowCount;
            console.log(`  ✅ Аукцион ${auctionNumber}: обновлено ${result.rowCount} лотов (парсинг: ${parsingNumber})`);
        }
        
        console.log(`\n📊 Итого обновлено: ${totalUpdated} лотов`);
        
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
            LIMIT 15;
        `;
        
        const statsResult = await pool.query(statsQuery);
        console.log('\n📈 Итоговая статистика по аукционам:');
        statsResult.rows.forEach(row => {
            const isDifferent = row.auction_number !== row.parsing_number;
            const status = isDifferent ? '🔄' : '✅';
            console.log(`  ${status} Аукцион ${row.auction_number} (парсинг: ${row.parsing_number}): ${row.lots_count} лотов`);
        });
        
        // Показываем аукционы, где номера отличаются
        const differentNumbers = statsResult.rows.filter(row => row.auction_number !== row.parsing_number);
        if (differentNumbers.length > 0) {
            console.log(`\n🎯 Аукционы с разными номерами (${differentNumbers.length}):`);
            differentNumbers.forEach(row => {
                console.log(`  🔄 Аукцион ${row.auction_number} -> URL /auction/${row.parsing_number}`);
            });
        }
        
    } catch (error) {
        console.error('❌ Ошибка извлечения номеров парсинга:', error);
    } finally {
        await pool.end();
    }
}

extractParsingNumbersFromUrls();

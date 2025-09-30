const { Pool } = require('pg');
const config = require('./config.js');

const pool = new Pool(config.dbConfig);

async function checkPredictions(auctionNumber) {
    try {
        const query = `
            SELECT 
                al.lot_number,
                lpp.predicted_price,
                lpp.confidence_score,
                lpp.sample_size
            FROM auction_lots al
            LEFT JOIN lot_price_predictions lpp ON al.id = lpp.lot_id
            WHERE al.auction_number = $1
            ORDER BY al.lot_number::int ASC
        `;
        const result = await pool.query(query, [auctionNumber]);

        console.log(`\n📊 Проверка прогнозов для аукциона ${auctionNumber}:`);
        console.log(`Всего лотов: ${result.rows.length}`);
        
        const withPredictions = result.rows.filter(row => row.predicted_price !== null).length;
        const withoutPredictions = result.rows.length - withPredictions;
        
        console.log(`С прогнозами: ${withPredictions}`);
        console.log(`Без прогнозов: ${withoutPredictions}`);
        
        if (withPredictions > 0) {
            console.log('\n📈 Примеры прогнозов:');
            result.rows.filter(row => row.predicted_price !== null).slice(0, 5).forEach(row => {
                const price = (row.predicted_price && typeof row.predicted_price === 'number') ? row.predicted_price.toFixed(2) : 'N/A';
                const confidence = (row.confidence_score && typeof row.confidence_score === 'number') ? row.confidence_score.toFixed(2) : 'N/A';
                console.log(`Лот ${row.lot_number}: ${price}₽ (уверенность: ${confidence}%, выборка: ${row.sample_size})`);
            });
        }

    } catch (error) {
        console.error('Ошибка при проверке прогнозов:', error);
    } finally {
        await pool.end();
    }
}

const auctionNumber = process.argv[2] || '968';
checkPredictions(auctionNumber);

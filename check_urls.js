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

async function checkUrls() {
    const client = new Client(dbConfig);
    
    try {
        await client.connect();
        console.log('✅ Подключено к базе данных');
        
        // Ищем лот с номером 7519535
        const targetLot = '7519535';
        console.log(`🔍 Ищем лот ${targetLot}...`);
        
        const result = await client.query(
            'SELECT lot_url, url_index FROM auction_lot_urls WHERE auction_number = $1', 
            ['2125']
        );
        
        let found = false;
        for (const row of result.rows) {
            const urlMatch = row.lot_url.match(/\/auction\/\d+\/(\d+)/);
            if (urlMatch && urlMatch[1] === targetLot) {
                console.log(`✅ Найден лот ${targetLot} на позиции ${row.url_index + 1}`);
                console.log(`   URL: ${row.lot_url}`);
                found = true;
                break;
            }
        }
        
        if (!found) {
            console.log(`❌ Лот ${targetLot} не найден`);
            console.log('Доступные номера лотов (первые 10):');
            result.rows.slice(0, 10).forEach((row, index) => {
                const urlMatch = row.lot_url.match(/\/auction\/\d+\/(\d+)/);
                if (urlMatch) {
                    console.log(`${index + 1}. ${urlMatch[1]} (позиция ${row.url_index + 1})`);
                }
            });
        }
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    } finally {
        await client.end();
    }
}

checkUrls();

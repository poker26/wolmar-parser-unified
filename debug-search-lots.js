const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool(config.dbConfig);

async function debugSearchLots() {
    try {
        console.log('🔍 Ищем лоты с золотом и словом "комплекс"...');
        
        const query = `
            SELECT id, lot_number, auction_number, coin_description, 
                   winning_bid, auction_end_date, metal, weight
            FROM auction_lots 
            WHERE metal = 'Au' 
              AND coin_description ILIKE '%комплекс%'
              AND weight IS NOT NULL
            ORDER BY winning_bid DESC
            LIMIT 10
        `;
        
        const result = await pool.query(query);
        
        console.log(`📋 Найдено лотов: ${result.rows.length}`);
        
        result.rows.forEach((lot, index) => {
            console.log(`\n${index + 1}. Лот ID: ${lot.id}`);
            console.log(`   Номер лота: ${lot.lot_number}`);
            console.log(`   Аукцион: ${lot.auction_number}`);
            console.log(`   Металл: ${lot.metal}`);
            console.log(`   Вес: ${lot.weight} г`);
            console.log(`   Цена: ${lot.winning_bid} ₽`);
            console.log(`   Дата аукциона: ${lot.auction_end_date}`);
            
            // Проверяем, есть ли все необходимые данные для расчета
            const hasAllData = lot.winning_bid && lot.metal && lot.weight && lot.auction_end_date;
            console.log(`   ✅ Все данные для расчета: ${hasAllData ? 'ДА' : 'НЕТ'}`);
            
            if (!hasAllData) {
                console.log(`   ❌ Отсутствующие данные:`);
                if (!lot.winning_bid) console.log(`      - winning_bid`);
                if (!lot.metal) console.log(`      - metal`);
                if (!lot.weight) console.log(`      - weight`);
                if (!lot.auction_end_date) console.log(`      - auction_end_date`);
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка:', error);
    } finally {
        await pool.end();
    }
}

debugSearchLots();

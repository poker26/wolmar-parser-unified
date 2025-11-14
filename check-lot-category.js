const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool(config.dbConfig);

async function checkLotCategory(lotNumber, auctionNumber) {
    try {
        console.log(`\n🔍 Проверяем категорию лота: ${lotNumber}, аукцион: ${auctionNumber}\n`);
        
        const query = `
            SELECT 
                id,
                lot_number,
                auction_number,
                category,
                source_category,
                coin_description,
                parsing_method,
                parsing_number,
                created_at,
                updated_at
            FROM auction_lots
            WHERE lot_number = $1 AND auction_number = $2
        `;
        
        const result = await pool.query(query, [lotNumber, auctionNumber]);
        
        if (result.rows.length === 0) {
            console.log('❌ Лот не найден в БД');
            return;
        }
        
        const lot = result.rows[0];
        console.log('📊 Информация о лоте:');
        console.log(`   ID: ${lot.id}`);
        console.log(`   lot_number: ${lot.lot_number}`);
        console.log(`   auction_number: ${lot.auction_number}`);
        console.log(`   category: ${lot.category || '(пусто)'}`);
        console.log(`   source_category: ${lot.source_category || '(пусто)'}`);
        console.log(`   parsing_method: ${lot.parsing_method || '(пусто)'}`);
        console.log(`   parsing_number: ${lot.parsing_number || '(пусто)'}`);
        console.log(`   created_at: ${lot.created_at ? new Date(lot.created_at).toLocaleString('ru-RU') : '(пусто)'}`);
        console.log(`   updated_at: ${lot.updated_at ? new Date(lot.updated_at).toLocaleString('ru-RU') : '(пусто)'}`);
        console.log(`   Описание: ${lot.coin_description ? lot.coin_description.substring(0, 100) + '...' : '(пусто)'}`);
        console.log('');
        
        // Проверяем историю изменений категории (если есть логи или история)
        console.log('🔍 Проверяем возможные причины изменения категории:');
        
        if (lot.category === 'Боны России' && lot.source_category === 'Боны') {
            console.log('   ⚠️  Обнаружено несоответствие: category="Боны России", source_category="Боны"');
            console.log('   Возможные причины:');
            console.log('   1. Лот был ранее сохранен из категории "Боны России"');
            console.log('   2. Логика ON CONFLICT сохранила существующую категорию "Боны России"');
            console.log('   3. Есть триггер или другая логика в БД, которая изменяет категорию');
        }
        
        // Проверяем, есть ли другие лоты с таким же lot_number в других аукционах
        const similarQuery = `
            SELECT 
                auction_number,
                category,
                source_category,
                parsing_method
            FROM auction_lots
            WHERE lot_number = $1
            ORDER BY auction_number
        `;
        
        const similarResult = await pool.query(similarQuery, [lotNumber]);
        
        if (similarResult.rows.length > 1) {
            console.log(`\n📋 Найдено ${similarResult.rows.length} лотов с таким же lot_number в разных аукционах:`);
            similarResult.rows.forEach(l => {
                console.log(`   Аукцион ${l.auction_number}: category=${l.category || '(пусто)'}, source_category=${l.source_category || '(пусто)'}, method=${l.parsing_method || '(пусто)'}`);
            });
        }
        
    } catch (error) {
        console.error('❌ Ошибка:', error);
    } finally {
        await pool.end();
    }
}

// Запускаем проверку
const lotNumber = process.argv[2] || '4571';
const auctionNumber = process.argv[3] || '976';
checkLotCategory(lotNumber, auctionNumber);


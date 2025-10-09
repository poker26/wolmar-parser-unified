const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool(config.dbConfig);

async function testSqlQuery() {
    try {
        // Тестируем SQL запрос из recalculateLotPredictions
        const lotIds = [90224, 63217, 63219]; // Примеры ID лотов из избранного
        
        console.log('🔍 Тестируем SQL запрос для лотов:', lotIds);
        
        const lotsResult = await pool.query(`
            SELECT 
                al.id,
                al.lot_number,
                al.auction_number,
                al.coin_description,
                al.metal,
                al.condition,
                al.weight,
                al.year,
                al.letters,
                al.winning_bid
            FROM auction_lots al
            WHERE al.id = ANY($1)
            ORDER BY al.id
        `, [lotIds]);
        
        console.log('✅ SQL запрос выполнен успешно');
        console.log(`📊 Найдено лотов: ${lotsResult.rows.length}`);
        
        // Показываем данные каждого лота
        lotsResult.rows.forEach((lot, index) => {
            console.log(`\n📋 Лот ${index + 1}:`);
            console.log(`  - ID: ${lot.id}`);
            console.log(`  - Номер лота: ${lot.lot_number}`);
            console.log(`  - Аукцион: ${lot.auction_number}`);
            console.log(`  - Металл: ${lot.metal}`);
            console.log(`  - Состояние: ${lot.condition}`);
            console.log(`  - Вес: ${lot.weight}`);
            console.log(`  - Год: ${lot.year}`);
            console.log(`  - Буквы: ${lot.letters}`);
            console.log(`  - Ставка: ${lot.winning_bid}`);
            console.log(`  - Описание: ${lot.coin_description ? lot.coin_description.substring(0, 100) + '...' : 'Нет'}`);
        });
        
        // Тестируем адаптацию данных
        console.log('\n🔧 Тестируем адаптацию данных:');
        
        function adaptLotDataForPrediction(lot) {
            // Извлекаем номинал из описания монеты
            let denomination = 'Не указан';
            if (lot.coin_description) {
                // Ищем номинал в описании (например, "1 рубль", "50 копеек", "5 рублей")
                const denominationMatch = lot.coin_description.match(/(\d+(?:[.,]\d+)?)\s*(руб|коп|копеек?|рубл)/i);
                if (denominationMatch) {
                    denomination = `${denominationMatch[1]} ${denominationMatch[2]}`;
                }
            }
            
            // Извлекаем монетный двор из описания или letters
            let mint = lot.letters || 'Не указан';
            if (lot.coin_description) {
                // Ищем упоминания монетных дворов
                const mintMatch = lot.coin_description.match(/(СПБ|СПМ|ЕМ|АМ|ВМ|КМ|ТМ|НМД|ММД|ЛМД|СПМД)/i);
                if (mintMatch) {
                    mint = mintMatch[1];
                }
            }
            
            return {
                coin_name: lot.coin_description || 'Неизвестная монета',
                denomination: denomination,
                metal: lot.metal,
                condition: lot.condition,
                year: lot.year,
                coin_weight: lot.weight,
                pure_metal_weight: lot.weight,
                mint: mint,
                original_description: lot.coin_description
            };
        }
        
        lotsResult.rows.forEach((lot, index) => {
            const adaptedData = adaptLotDataForPrediction(lot);
            console.log(`\n📋 Адаптированные данные лота ${index + 1}:`);
            console.log(`  - Название: ${adaptedData.coin_name.substring(0, 50)}...`);
            console.log(`  - Номинал: ${adaptedData.denomination}`);
            console.log(`  - Металл: ${adaptedData.metal}`);
            console.log(`  - Состояние: ${adaptedData.condition}`);
            console.log(`  - Год: ${adaptedData.year}`);
            console.log(`  - Вес: ${adaptedData.coin_weight}`);
            console.log(`  - Монетный двор: ${adaptedData.mint}`);
        });
        
    } catch (error) {
        console.error('❌ Ошибка выполнения SQL запроса:', error);
    } finally {
        await pool.end();
    }
}

testSqlQuery();

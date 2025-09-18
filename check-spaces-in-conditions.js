/**
 * Проверяем, есть ли в БД лоты с пробелами в состояниях
 */

const { Client } = require('pg');
const config = require('./config');

async function checkSpacesInConditions() {
    const client = new Client(config.dbConfig);
    
    try {
        await client.connect();
        console.log('🔗 Подключение к базе данных установлено');
        
        // Ищем лоты с пробелами в состояниях
        console.log('\n🔍 Ищем лоты с пробелами в состояниях:');
        
        const lotsWithSpaces = await client.query(`
            SELECT id, lot_number, auction_number, condition, source_url
            FROM auction_lots 
            WHERE condition LIKE '% %'
            ORDER BY auction_number DESC, lot_number
            LIMIT 20;
        `);
        
        console.log(`📊 Найдено ${lotsWithSpaces.rows.length} лотов с пробелами в состояниях:`);
        lotsWithSpaces.rows.forEach((lot, index) => {
            console.log(`  ${index + 1}. Лот ${lot.lot_number} (Аукцион ${lot.auction_number}): "${lot.condition}"`);
        });
        
        // Проверяем конкретный аукцион 967
        console.log('\n🔍 Проверяем аукцион 967:');
        
        const auction967 = await client.query(`
            SELECT id, lot_number, condition, source_url
            FROM auction_lots 
            WHERE auction_number = '967'
            ORDER BY lot_number
            LIMIT 10;
        `);
        
        console.log(`📊 Лоты аукциона 967:`);
        auction967.rows.forEach((lot, index) => {
            const hasSpaces = lot.condition.includes(' ');
            console.log(`  ${index + 1}. Лот ${lot.lot_number}: "${lot.condition}" ${hasSpaces ? '⚠️ ЕСТЬ ПРОБЕЛЫ' : '✅ БЕЗ ПРОБЕЛОВ'}`);
        });
        
        // Статистика по пробелам
        console.log('\n📊 Статистика по пробелам в состояниях:');
        
        const stats = await client.query(`
            SELECT 
                COUNT(*) as total_lots,
                COUNT(CASE WHEN condition LIKE '% %' THEN 1 END) as lots_with_spaces,
                COUNT(CASE WHEN condition NOT LIKE '% %' THEN 1 END) as lots_without_spaces
            FROM auction_lots 
            WHERE condition IS NOT NULL;
        `);
        
        const stat = stats.rows[0];
        console.log(`  Всего лотов: ${stat.total_lots}`);
        console.log(`  С пробелами: ${stat.lots_with_spaces}`);
        console.log(`  Без пробелов: ${stat.lots_without_spaces}`);
        console.log(`  Процент с пробелами: ${((stat.lots_with_spaces / stat.total_lots) * 100).toFixed(1)}%`);
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    } finally {
        await client.end();
    }
}

checkSpacesInConditions();

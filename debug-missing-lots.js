const { Client } = require('pg');
const config = require('./config');

async function debugMissingLots() {
    const client = new Client(config.dbConfig);
    
    try {
        await client.connect();
        console.log('🔗 Подключение к базе данных установлено');
        
        // Проверяем конкретный лот из примера
        console.log('\n🔍 Проверяем лот 7478027 из аукциона 2117:');
        const specificLot = await client.query(`
            SELECT id, lot_number, auction_number, condition, source_url
            FROM auction_lots 
            WHERE source_url LIKE '%7478027%' OR lot_number = '7478027';
        `);
        
        if (specificLot.rows.length > 0) {
            specificLot.rows.forEach(row => {
                console.log(`  Найден: Лот ${row.lot_number} (Аукцион ${row.auction_number})`);
                console.log(`    Состояние: "${row.condition}"`);
                console.log(`    URL: ${row.source_url}`);
            });
        } else {
            console.log('  ❌ Лот 7478027 не найден в базе данных');
        }
        
        // Проверяем аукцион 2117 в целом
        console.log('\n📊 Проверяем аукцион 2117:');
        const auction2117 = await client.query(`
            SELECT COUNT(*) as total_lots,
                   COUNT(CASE WHEN condition LIKE '%MS%' THEN 1 END) as ms_lots,
                   COUNT(CASE WHEN condition LIKE '%PF%' THEN 1 END) as pf_lots,
                   COUNT(CASE WHEN condition LIKE '%65%' THEN 1 END) as grade_65_lots,
                   COUNT(CASE WHEN condition LIKE '%70%' THEN 1 END) as grade_70_lots
            FROM auction_lots 
            WHERE auction_number = '2117';
        `);
        
        console.log(`  Всего лотов: ${auction2117.rows[0].total_lots}`);
        console.log(`  MS лотов: ${auction2117.rows[0].ms_lots}`);
        console.log(`  PF лотов: ${auction2117.rows[0].pf_lots}`);
        console.log(`  С градацией 65: ${auction2117.rows[0].grade_65_lots}`);
        console.log(`  С градацией 70: ${auction2117.rows[0].grade_70_lots}`);
        
        // Проверяем, есть ли лоты с URL содержащим 2117
        console.log('\n🔗 Проверяем лоты с URL содержащим 2117:');
        const url2117 = await client.query(`
            SELECT COUNT(*) as count
            FROM auction_lots 
            WHERE source_url LIKE '%2117%';
        `);
        console.log(`  Лотов с URL содержащим 2117: ${url2117.rows[0].count}`);
        
        // Проверяем примеры состояний в аукционе 2117
        console.log('\n📋 Примеры состояний в аукционе 2117:');
        const conditions2117 = await client.query(`
            SELECT condition, COUNT(*) as count
            FROM auction_lots 
            WHERE auction_number = '2117'
            GROUP BY condition
            ORDER BY count DESC
            LIMIT 10;
        `);
        
        conditions2117.rows.forEach(row => {
            console.log(`  "${row.condition}": ${row.count} лотов`);
        });
        
        // Проверяем, есть ли лоты с PF70ULTRACAMEO
        console.log('\n🔍 Поиск PF70ULTRACAMEO:');
        const pf70 = await client.query(`
            SELECT id, lot_number, auction_number, condition, source_url
            FROM auction_lots 
            WHERE condition LIKE '%PF70%' OR condition LIKE '%70%';
        `);
        
        if (pf70.rows.length > 0) {
            console.log(`  Найдено ${pf70.rows.length} лотов с PF70:`);
            pf70.rows.slice(0, 5).forEach(row => {
                console.log(`    Лот ${row.lot_number} (Аукцион ${row.auction_number}): "${row.condition}"`);
            });
        } else {
            console.log('  ❌ Лоты с PF70 не найдены');
        }
        
        // Проверяем, какие аукционы были обработаны оптимизированным скриптом
        console.log('\n📊 Проверяем, какие аукционы есть в базе:');
        const allAuctions = await client.query(`
            SELECT auction_number, COUNT(*) as lots_count
            FROM auction_lots 
            WHERE source_url IS NOT NULL
            GROUP BY auction_number
            ORDER BY auction_number DESC
            LIMIT 15;
        `);
        
        allAuctions.rows.forEach(row => {
            console.log(`  Аукцион ${row.auction_number}: ${row.lots_count} лотов`);
        });
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    } finally {
        await client.end();
    }
}

debugMissingLots();

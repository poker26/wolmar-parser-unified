/**
 * Проверяем новые лоты, которые не найдены в БД
 */

const { Client } = require('pg');
const config = require('./config');

async function checkNewLots() {
    const client = new Client(config.dbConfig);
    
    try {
        await client.connect();
        console.log('🔗 Подключение к базе данных установлено');
        
        // Проверяем диапазон номеров лотов
        console.log('\n🔍 Анализируем диапазоны номеров лотов в аукционе 967:');
        
        const lotRanges = await client.query(`
            SELECT 
                MIN(CAST(SUBSTRING(source_url FROM '/auction/\\d+/(\\d+)') AS INTEGER)) as min_lot_number,
                MAX(CAST(SUBSTRING(source_url FROM '/auction/\\d+/(\\d+)') AS INTEGER)) as max_lot_number,
                COUNT(*) as total_lots
            FROM auction_lots 
            WHERE auction_number = '967' AND source_url LIKE '%2130%';
        `);
        
        if (lotRanges.rows.length > 0) {
            const range = lotRanges.rows[0];
            console.log(`📊 Диапазон лотов в БД (аукцион 967):`);
            console.log(`  Минимальный номер: ${range.min_lot_number}`);
            console.log(`  Максимальный номер: ${range.max_lot_number}`);
            console.log(`  Всего лотов: ${range.total_lots}`);
        }
        
        // Проверяем конкретные новые номера
        console.log('\n🔍 Проверяем новые номера лотов:');
        const newLotNumbers = ['7556287', '7556288', '7556289', '7556290', '7556291'];
        
        for (const lotNumber of newLotNumbers) {
            const lotUrl = `https://www.wolmar.ru/auction/2130/${lotNumber}`;
            
            const lotExists = await client.query(`
                SELECT id, lot_number, auction_number, condition, source_url
                FROM auction_lots 
                WHERE source_url = $1;
            `, [lotUrl]);
            
            if (lotExists.rows.length > 0) {
                const lot = lotExists.rows[0];
                console.log(`✅ Лот ${lotNumber}: НАЙДЕН в БД`);
                console.log(`  Лот ${lot.lot_number} (Аукцион ${lot.auction_number}): "${lot.condition}"`);
            } else {
                console.log(`❌ Лот ${lotNumber}: НЕ НАЙДЕН в БД`);
            }
        }
        
        // Проверяем, есть ли лоты с похожими номерами
        console.log('\n🔍 Ищем лоты с похожими номерами:');
        
        const similarLots = await client.query(`
            SELECT lot_number, auction_number, condition, source_url
            FROM auction_lots 
            WHERE auction_number = '967' 
            AND source_url LIKE '%2130%'
            AND CAST(SUBSTRING(source_url FROM '/auction/\\d+/(\\d+)') AS INTEGER) BETWEEN 7556200 AND 7556400
            ORDER BY CAST(SUBSTRING(source_url FROM '/auction/\\d+/(\\d+)') AS INTEGER)
            LIMIT 10;
        `);
        
        if (similarLots.rows.length > 0) {
            console.log(`📋 Найдены лоты в диапазоне 7556200-7556400:`);
            similarLots.rows.forEach((lot, index) => {
                const lotNumber = lot.source_url.match(/\/auction\/\d+\/(\d+)/)[1];
                console.log(`  ${index + 1}. Лот ${lotNumber} (Аукцион ${lot.auction_number}): "${lot.condition}"`);
            });
        } else {
            console.log(`❌ Лоты в диапазоне 7556200-7556400 не найдены`);
        }
        
        // Проверяем последние добавленные лоты
        console.log('\n🔍 Последние добавленные лоты в аукционе 967:');
        
        const lastLots = await client.query(`
            SELECT lot_number, auction_number, condition, source_url, parsed_at
            FROM auction_lots 
            WHERE auction_number = '967' 
            AND source_url LIKE '%2130%'
            ORDER BY parsed_at DESC
            LIMIT 10;
        `);
        
        console.log(`📋 Последние 10 лотов:`);
        lastLots.rows.forEach((lot, index) => {
            const lotNumber = lot.source_url.match(/\/auction\/\d+\/(\d+)/)[1];
            console.log(`  ${index + 1}. Лот ${lotNumber}: "${lot.condition}" (${lot.parsed_at})`);
        });
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    } finally {
        await client.end();
    }
}

checkNewLots();

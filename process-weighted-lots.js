const CatalogParser = require('./catalog-parser.js');
const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool(config.dbConfig);

async function processWeightedLots() {
    const parser = new CatalogParser();
    const client = await pool.connect();
    
    try {
        await parser.init();
        
        console.log('🔍 Поиск лотов с драгоценными металлами и явным указанием веса...\n');

        // Ищем лоты с драгоценными металлами и весом
        const query = `
            SELECT id, coin_description, auction_number, lot_number
            FROM auction_lots 
            WHERE (coin_description ILIKE '%Au%' OR coin_description ILIKE '%Ag%' OR coin_description ILIKE '%Pt%' OR coin_description ILIKE '%Pd%')
            AND (coin_description ILIKE '%гр%' OR coin_description ILIKE '%oz%' OR coin_description ILIKE '%вес%')
            ORDER BY id DESC
            LIMIT 10
        `;
        
        const result = await client.query(query);
        
        console.log(`📊 Найдено лотов с драгоценными металлами и весом: ${result.rows.length}\n`);
        
        for (const [index, row] of result.rows.entries()) {
            console.log(`\n--- Обработка лота ${index + 1} ---`);
            console.log(`ID: ${row.id}, Аукцион: ${row.auction_number}, Лот: ${row.lot_number}`);
            console.log(`Описание: ${row.coin_description.substring(0, 100)}...`);
            
            // Парсим описание
            const parsedData = parser.parseLotDescription(row.coin_description);
            
            console.log(`\n📋 Результат парсинга:`);
            console.log(`  - Металл: ${parsedData.metal || 'не найден'}`);
            console.log(`  - Вес монеты: ${parsedData.coin_weight || 'не найден'}г`);
            console.log(`  - Проба: ${parsedData.fineness || 'не найдена'}`);
            console.log(`  - Чистый металл: ${parsedData.pure_metal_weight || 'не найден'}г`);
            
            // Проверяем, есть ли вес
            if (parsedData.coin_weight) {
                console.log(`✅ Найден вес: ${parsedData.coin_weight}г`);
            } else {
                console.log(`❌ Вес не найден`);
            }
        }

    } catch (error) {
        console.error('❌ Ошибка при обработке лотов:', error);
    } finally {
        client.release();
        await pool.end();
        await parser.close();
    }
}

processWeightedLots();



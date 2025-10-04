const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool(config.dbConfig);

async function debugParserDescriptions() {
    const client = await pool.connect();
    
    try {
        console.log('🔍 Анализ описаний, которые обрабатывает парсер...\n');
        
        // Получаем несколько описаний с драгоценными металлами
        const query = `
            SELECT id, coin_description, auction_number, lot_number
            FROM auction_lots
            WHERE (coin_description ILIKE '%Au%' OR coin_description ILIKE '%Ag%' OR coin_description ILIKE '%Pt%' OR coin_description ILIKE '%Pd%')
            AND coin_description IS NOT NULL 
            AND coin_description != ''
            ORDER BY id
            LIMIT 10;
        `;
        
        const result = await client.query(query);
        
        console.log(`📊 Найдено лотов с драгоценными металлами: ${result.rows.length}\n`);
        
        for (const [index, lot] of result.rows.entries()) {
            console.log(`--- Лот ${index + 1} ---`);
            console.log(`ID: ${lot.id}, Аукцион: ${lot.auction_number}, Лот: ${lot.lot_number}`);
            console.log(`Описание: ${lot.coin_description}`);
            
            // Проверяем, есть ли в описании явное указание веса
            const hasWeight = lot.coin_description.match(/\b(вес|гр|oz|Au\s+\d+|Ag\s+\d+|Pt\s+\d+|Pd\s+\d+)\b/i);
            console.log(`Есть ли вес: ${hasWeight ? 'ДА' : 'НЕТ'}`);
            if (hasWeight) {
                console.log(`Найденные упоминания веса: ${hasWeight[0]}`);
            }
            console.log('');
        }
        
    } catch (error) {
        console.error('❌ Ошибка при анализе описаний:', error);
    } finally {
        client.release();
        await pool.end();
    }
}

debugParserDescriptions();





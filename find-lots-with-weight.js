const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool(config.dbConfig);

async function findLotsWithWeight() {
    const client = await pool.connect();
    
    try {
        console.log('🔍 Поиск лотов с явным указанием веса...\n');
        
        // Ищем лоты с драгоценными металлами И явным указанием веса
        const query = `
            SELECT id, coin_description, auction_number, lot_number
            FROM auction_lots
            WHERE (coin_description ILIKE '%Au%' OR coin_description ILIKE '%Ag%' OR coin_description ILIKE '%Pt%' OR coin_description ILIKE '%Pd%')
            AND (
                coin_description ILIKE '%вес%' OR 
                coin_description ILIKE '%гр%' OR 
                coin_description ILIKE '%oz%' OR
                coin_description ~* '(Au|Ag|Pt|Pd)\\s+\\d+(?:,\\d+)?' OR
                coin_description ~* '\\d+\\s*проб[аы]'
            )
            AND coin_description IS NOT NULL 
            AND coin_description != ''
            ORDER BY id
            LIMIT 20;
        `;
        
        const result = await client.query(query);
        
        console.log(`📊 Найдено лотов с драгоценными металлами И весом: ${result.rows.length}\n`);
        
        for (const [index, lot] of result.rows.entries()) {
            console.log(`--- Лот ${index + 1} ---`);
            console.log(`ID: ${lot.id}, Аукцион: ${lot.auction_number}, Лот: ${lot.lot_number}`);
            console.log(`Описание: ${lot.coin_description}`);
            
            // Выделяем упоминания веса
            const weightMentions = lot.coin_description.match(/\b(вес|гр|oz|Au\s+\d+|Ag\s+\d+|Pt\s+\d+|Pd\s+\d+|\d+\s*проб[аы])\b/gi);
            if (weightMentions) {
                console.log(`🎯 Найденные упоминания веса: ${weightMentions.join(', ')}`);
            }
            console.log('');
        }
        
    } catch (error) {
        console.error('❌ Ошибка при поиске лотов с весом:', error);
    } finally {
        client.release();
        await pool.end();
    }
}

findLotsWithWeight();
